const pool = require('../db/pool');

// O miolo da importação das saídas do extrato bancário, usado pela tela (arquivo
// ou API) e pela busca automática diária. Antes vivia no controlador; saiu daqui
// para que as duas portas de entrada gravem do mesmo jeito.

const ACOES = ['lancar', 'ignorar'];
const TIPOS = ['fornecedor', 'ceasa', 'fixa', 'imposto', 'operacional', 'despesa'];

// Junta as saídas por chave e pendura o que já se sabe de cada uma.
async function montarGrupos(saidas, bancoId) {
  const chaves = [...new Set(saidas.map((s) => s.chave))];
  const impressoes = saidas.map((s) => s.impressao);

  const { rows: regras } = chaves.length
    ? await pool.query(
        `SELECT r.*, f.nome AS fornecedor_nome
           FROM regras_extrato r
           LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
          WHERE r.chave = ANY($1::text[]) AND COALESCE(r.banco_id, 0) = $2`,
        [chaves, bancoId || 0]
      )
    : { rows: [] };
  const porChave = new Map(regras.map((r) => [r.chave, r]));

  // O que já foi importado antes fica marcado: reimportar o mesmo período é
  // comum (o extrato do mês seguinte pega o fim do anterior) e a pessoa precisa
  // ver que aquilo já está lá, não descobrir depois.
  const { rows: jaLancadas } = impressoes.length
    ? await pool.query('SELECT legado_id FROM contas WHERE legado_id = ANY($1::text[])', [impressoes])
    : { rows: [] };
  const jaExiste = new Set(jaLancadas.map((c) => c.legado_id));

  const grupos = new Map();
  for (const s of saidas) {
    if (!grupos.has(s.chave)) {
      const regra = porChave.get(s.chave) || null;
      grupos.set(s.chave, {
        chave: s.chave,
        exemplo: s.detalhes || s.lancamento,
        lancamento: s.lancamento,
        forma: s.forma,
        quantidade: 0,
        total: 0,
        ja_importadas: 0,
        regra: regra
          ? {
              acao: regra.acao,
              tipo: regra.tipo,
              fornecedor_id: regra.fornecedor_id,
              fornecedor_nome: regra.fornecedor_nome,
              categoria: regra.categoria,
              vezes: regra.vezes,
            }
          : null,
        linhas: [],
      });
    }
    const g = grupos.get(s.chave);
    g.quantidade += 1;
    g.total += s.valor;
    if (jaExiste.has(s.impressao)) g.ja_importadas += 1;
    g.linhas.push({
      data: s.data,
      valor: s.valor,
      detalhes: s.detalhes,
      documento: s.documento,
      impressao: s.impressao,
      ja_importada: jaExiste.has(s.impressao),
    });
  }

  return [...grupos.values()].sort((a, b) => b.total - a.total);
}

// O extrato agrupado junta os Pix enviados do dia numa linha só, sem número de
// documento. A mesma saída, então, tem uma identidade quando vem detalhada e
// outra quando vem agrupada — e o sistema não tem como saber que são a mesma.
//
// A saída não é adivinhar: é não deixar misturar. Se o período já foi importado
// de um jeito, o outro é recusado, com o aviso do que fazer.
async function conflitoDeModo(lido, banco) {
  if (!lido.saidas.length) return null;
  const datas = lido.saidas.map((s) => s.data).sort();
  // Só olha o que veio DESTA conta: junho do Banco do Brasil e junho do
  // PagSeguro são o mesmo período e dinheiro diferente.
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE observacoes ILIKE '%agrupad%')::int AS agrupadas,
            count(*) FILTER (WHERE observacoes NOT ILIKE '%agrupad%')::int AS detalhadas
       FROM contas
      WHERE legado_id LIKE 'banco:%'
        AND observacoes ILIKE $3
        AND vencimento BETWEEN $1 AND $2`,
    [datas[0], datas[datas.length - 1], `%[${banco.nome}]%`]
  );
  const { agrupadas, detalhadas } = rows[0];
  if (!agrupadas && !detalhadas) return null;

  const jaImportado = agrupadas > 0 ? 'agrupado' : 'detalhado';
  if (jaImportado === lido.modo) return null;

  const deOnde = lido.origem === 'api' ? 'a busca no banco traz os lançamentos SEM AGRUPAR' : `este arquivo está ${lido.modo === 'agrupado' ? 'AGRUPADO' : 'SEM AGRUPAR'}`;
  return {
    modo_do_arquivo: lido.modo,
    modo_ja_importado: jaImportado,
    de: datas[0],
    ate: datas[datas.length - 1],
    mensagem:
      `Este período já foi importado com o extrato ${jaImportado === 'agrupado' ? 'AGRUPADO' : 'SEM AGRUPAR'}, ` +
      `e ${deOnde}. ` +
      'No agrupado o banco junta os Pix enviados do dia numa linha só, sem número de documento — ' +
      'então o mesmo pagamento não é reconhecido entre os dois formatos e entraria em dobro. ' +
      'Use sempre o mesmo formato, ou apague o que já foi importado deste período antes de trocar.',
  };
}

function validarRegra(r) {
  if (!r || !r.chave) return 'Regra sem chave.';
  if (!ACOES.includes(r.acao)) return `Ação inválida: use ${ACOES.join(' ou ')}.`;
  if (r.acao === 'lancar') {
    if (!TIPOS.includes(r.tipo)) return `Para lançar é preciso dizer o tipo (${TIPOS.join(', ')}).`;
  }
  return null;
}

// As regras que o dono já ensinou para estas chaves, no formato que
// `gravarSaidas` recebe. É o que a busca automática usa: ela só aplica o que já
// é sabido, e o resto espera alguém classificar na tela.
async function regrasSalvas(chaves, bancoId) {
  if (!chaves.length) return [];
  const { rows } = await pool.query(
    `SELECT chave, exemplo, acao, tipo, fornecedor_id, categoria
       FROM regras_extrato
      WHERE chave = ANY($1::text[]) AND COALESCE(banco_id, 0) = $2`,
    [chaves, bancoId || 0]
  );
  return rows;
}

// Grava as saídas: o que tem regra "lançar" vira conta já paga, o que tem
// "ignorar" é contado e deixado de lado, e o que não tem regra fica de fora,
// esperando alguém ensinar.
//
// `salvarRegras` é falso na busca automática: lá as regras vêm do próprio banco
// de dados, e regravá-las só mexeria no "atualizado em" sem ninguém ter mudado
// nada.
async function gravarSaidas({ lido, banco, regras, usuarioId = null, salvarRegras = true }) {
  const porChave = new Map(regras.map((r) => [r.chave, r]));
  const cliente = await pool.connect();
  const resultado = { lancadas: 0, ignoradas: 0, ja_existiam: 0, sem_regra: 0, valor_lancado: 0, valor_sem_regra: 0 };

  try {
    await cliente.query('BEGIN');

    // As regras vêm antes dos lançamentos: mesmo que nada seja gravado depois, o
    // que o dono ensinou não se perde.
    if (salvarRegras) {
      for (const r of regras) {
        await cliente.query(
          `INSERT INTO regras_extrato (chave, exemplo, acao, tipo, fornecedor_id, categoria, criado_por, banco_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (COALESCE(banco_id, 0), chave) DO UPDATE
              SET acao = EXCLUDED.acao, tipo = EXCLUDED.tipo,
                  fornecedor_id = EXCLUDED.fornecedor_id, categoria = EXCLUDED.categoria,
                  exemplo = COALESCE(EXCLUDED.exemplo, regras_extrato.exemplo),
                  atualizado_em = now()`,
          [r.chave, r.exemplo || null, r.acao, r.acao === 'lancar' ? r.tipo : null,
           r.fornecedor_id || null, r.categoria || null, usuarioId, banco.id]
        );
      }
    }

    const origem = lido.origem === 'api' ? ' (API)' : '';
    for (const s of lido.saidas) {
      const regra = porChave.get(s.chave);
      if (!regra) {
        resultado.sem_regra += 1;
        resultado.valor_sem_regra += s.valor;
        continue;
      }
      if (regra.acao === 'ignorar') { resultado.ignoradas += 1; continue; }

      // legado_id é UNIQUE: é ele que faz reimportar o mesmo extrato não duplicar.
      const { rows } = await cliente.query(
        `INSERT INTO contas (tipo, categoria, fornecedor_id, descricao, valor, vencimento,
                             observacoes, legado_id, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (legado_id) DO NOTHING
         RETURNING id`,
        [
          regra.tipo,
          regra.categoria || null,
          regra.fornecedor_id || null,
          (s.detalhes || s.lancamento).slice(0, 200),
          s.valor,
          s.data,
          `Do extrato do banco [${banco.nome}]${origem} — ${s.lancamento}`,
          s.impressao,
          usuarioId,
        ]
      );

      if (!rows[0]) { resultado.ja_existiam += 1; continue; }

      // A conta nasce paga: o dinheiro já saiu do banco, a data está no extrato.
      await cliente.query(
        `INSERT INTO contas_pagamentos (conta_id, valor, data_pagamento, forma_pagamento, origem, pago_por)
         VALUES ($1, $2, $3, $4, 'extrato-banco', $5)`,
        [rows[0].id, s.valor, s.data, s.forma, usuarioId]
      );

      resultado.lancadas += 1;
      resultado.valor_lancado += s.valor;
    }

    if (salvarRegras && regras.length) {
      await cliente.query(
        'UPDATE regras_extrato SET vezes = vezes + 1 WHERE chave = ANY($1::text[]) AND COALESCE(banco_id, 0) = $2',
        [regras.map((r) => r.chave), banco.id]
      );
    }

    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  resultado.valor_lancado = Math.round(resultado.valor_lancado * 100) / 100;
  resultado.valor_sem_regra = Math.round(resultado.valor_sem_regra * 100) / 100;
  return resultado;
}

module.exports = { ACOES, TIPOS, montarGrupos, conflitoDeModo, validarRegra, regrasSalvas, gravarSaidas };
