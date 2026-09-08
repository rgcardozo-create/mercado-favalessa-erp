const pool = require('../db/pool');
const { lerExtratoBanco } = require('../utils/extratoBanco');
const { registrarAuditoria } = require('../utils/auditoria');

// Importação das SAÍDAS do extrato bancário.
//
// O desenho vem do jeito como o dono trabalha: ele olha a lista, joga fora o que
// é transferência entre as contas dele, diz quem é o resto — e a partir daí o
// sistema não pergunta de novo. Por isso o que ele ensina é guardado por chave,
// e não por linha: um Pix da noite ensinado classifica os vinte e cinco.
//
// Nada é gravado na análise. A tela mostra, ele decide, e só então grava.

const ACOES = ['lancar', 'ignorar'];
const TIPOS = ['fornecedor', 'ceasa', 'fixa', 'imposto', 'operacional', 'despesa'];

// De qual conta é o extrato. É obrigatório: sem saber o banco, a mesma descrição
// em contas diferentes disputa a mesma regra, e a trava contra misturar formatos
// olharia o período de todos juntos.
async function bancoDoCorpo(req) {
  const id = Number(req.body.banco_id);
  if (!id) return { erro: 'Escolha de qual conta é este extrato.' };
  const { rows } = await pool.query('SELECT id, nome FROM bancos WHERE id = $1', [id]);
  if (!rows[0]) return { erro: 'Conta não encontrada no cadastro de Bancos.' };
  return { banco: rows[0] };
}

function arquivoDoCorpo(req) {
  const base64 = req.body.arquivo_base64;
  if (!base64) return null;
  return Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
}

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

  return {
    modo_do_arquivo: lido.modo,
    modo_ja_importado: jaImportado,
    de: datas[0],
    ate: datas[datas.length - 1],
    mensagem:
      `Este período já foi importado com o extrato ${jaImportado === 'agrupado' ? 'AGRUPADO' : 'SEM AGRUPAR'}, ` +
      `e este arquivo está ${lido.modo === 'agrupado' ? 'AGRUPADO' : 'SEM AGRUPAR'}. ` +
      'No agrupado o banco junta os Pix enviados do dia numa linha só, sem número de documento — ' +
      'então o mesmo pagamento não é reconhecido entre os dois formatos e entraria em dobro. ' +
      'Use sempre o mesmo formato, ou apague o que já foi importado deste período antes de trocar.',
  };
}

async function analisar(req, res) {
  const buffer = arquivoDoCorpo(req);
  if (!buffer) return res.status(400).json({ error: 'Envie o arquivo do extrato.' });
  const { banco, erro } = await bancoDoCorpo(req);
  if (erro) return res.status(400).json({ error: erro });

  const lido = await lerExtratoBanco(buffer, req.body.nome_arquivo || 'extrato.xlsx', banco.id);
  if (!lido.reconhecido) {
    return res.json({ reconhecido: false, colunas: lido.colunas, amostra: lido.amostra });
  }

  const grupos = await montarGrupos(lido.saidas, banco.id);
  return res.json({
    reconhecido: true,
    banco,
    colunas: lido.colunas,
    modo: lido.modo,
    conflito: await conflitoDeModo(lido, banco),
    ignoradas: lido.ignoradas,
    total_saidas: lido.saidas.length,
    total_valor: lido.saidas.reduce((a, s) => a + s.valor, 0),
    grupos,
  });
}

function validarRegra(r) {
  if (!r || !r.chave) return 'Regra sem chave.';
  if (!ACOES.includes(r.acao)) return `Ação inválida: use ${ACOES.join(' ou ')}.`;
  if (r.acao === 'lancar') {
    if (!TIPOS.includes(r.tipo)) return `Para lançar é preciso dizer o tipo (${TIPOS.join(', ')}).`;
  }
  return null;
}

async function importar(req, res) {
  const buffer = arquivoDoCorpo(req);
  if (!buffer) return res.status(400).json({ error: 'Envie o arquivo do extrato.' });

  const regras = Array.isArray(req.body.regras) ? req.body.regras : [];
  for (const r of regras) {
    const erro = validarRegra(r);
    if (erro) return res.status(400).json({ error: erro });
  }

  const { banco, erro } = await bancoDoCorpo(req);
  if (erro) return res.status(400).json({ error: erro });

  const lido = await lerExtratoBanco(buffer, req.body.nome_arquivo || 'extrato.xlsx', banco.id);
  if (!lido.reconhecido) return res.status(400).json({ error: 'Não reconheci as colunas deste extrato.' });

  const conflito = await conflitoDeModo(lido, banco);
  if (conflito) return res.status(409).json({ error: conflito.mensagem, conflito });

  const porChave = new Map(regras.map((r) => [r.chave, r]));
  const cliente = await pool.connect();
  const resultado = { lancadas: 0, ignoradas: 0, ja_existiam: 0, sem_regra: 0, valor_lancado: 0 };

  try {
    await cliente.query('BEGIN');

    // As regras vêm antes dos lançamentos: mesmo que nada seja gravado depois, o
    // que o dono ensinou não se perde.
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
         r.fornecedor_id || null, r.categoria || null, req.user.id, banco.id]
      );
    }

    for (const s of lido.saidas) {
      const regra = porChave.get(s.chave);
      if (!regra) { resultado.sem_regra += 1; continue; }
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
          `Do extrato do banco [${banco.nome}] — ${s.lancamento}`,
          s.impressao,
          req.user.id,
        ]
      );

      if (!rows[0]) { resultado.ja_existiam += 1; continue; }

      // A conta nasce paga: o dinheiro já saiu do banco, a data está no extrato.
      await cliente.query(
        `INSERT INTO contas_pagamentos (conta_id, valor, data_pagamento, forma_pagamento, origem, pago_por)
         VALUES ($1, $2, $3, $4, 'extrato-banco', $5)`,
        [rows[0].id, s.valor, s.data, s.forma, req.user.id]
      );

      resultado.lancadas += 1;
      resultado.valor_lancado += s.valor;
    }

    if (regras.length) {
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

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'importar-extrato-banco',
    entidade: 'contas',
    dados: resultado,
  });

  resultado.valor_lancado = Math.round(resultado.valor_lancado * 100) / 100;
  return res.status(201).json(resultado);
}

async function listarRegras(req, res) {
  const { rows } = await pool.query(
    `SELECT r.*, f.nome AS fornecedor_nome, b.nome AS banco_nome
       FROM regras_extrato r
       LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
       LEFT JOIN bancos b ON b.id = r.banco_id
      ORDER BY b.nome, r.vezes DESC, r.chave`
  );
  return res.json(rows);
}

async function deletarRegra(req, res) {
  const { rows } = await pool.query('DELETE FROM regras_extrato WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Regra não encontrada.' });
  return res.status(204).send();
}

module.exports = { analisar, importar, listarRegras, deletarRegra };
