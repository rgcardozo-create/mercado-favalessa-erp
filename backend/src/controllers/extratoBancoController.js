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

function arquivoDoCorpo(req) {
  const base64 = req.body.arquivo_base64;
  if (!base64) return null;
  return Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
}

// Junta as saídas por chave e pendura o que já se sabe de cada uma.
async function montarGrupos(saidas) {
  const chaves = [...new Set(saidas.map((s) => s.chave))];
  const impressoes = saidas.map((s) => s.impressao);

  const { rows: regras } = chaves.length
    ? await pool.query(
        `SELECT r.*, f.nome AS fornecedor_nome
           FROM regras_extrato r
           LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
          WHERE r.chave = ANY($1::text[])`,
        [chaves]
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

async function analisar(req, res) {
  const buffer = arquivoDoCorpo(req);
  if (!buffer) return res.status(400).json({ error: 'Envie o arquivo do extrato.' });

  const lido = await lerExtratoBanco(buffer, req.body.nome_arquivo || 'extrato.xlsx');
  if (!lido.reconhecido) {
    return res.json({ reconhecido: false, colunas: lido.colunas });
  }

  const grupos = await montarGrupos(lido.saidas);
  return res.json({
    reconhecido: true,
    colunas: lido.colunas,
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

  const lido = await lerExtratoBanco(buffer, req.body.nome_arquivo || 'extrato.xlsx');
  if (!lido.reconhecido) return res.status(400).json({ error: 'Não reconheci as colunas deste extrato.' });

  const porChave = new Map(regras.map((r) => [r.chave, r]));
  const cliente = await pool.connect();
  const resultado = { lancadas: 0, ignoradas: 0, ja_existiam: 0, sem_regra: 0, valor_lancado: 0 };

  try {
    await cliente.query('BEGIN');

    // As regras vêm antes dos lançamentos: mesmo que nada seja gravado depois, o
    // que o dono ensinou não se perde.
    for (const r of regras) {
      await cliente.query(
        `INSERT INTO regras_extrato (chave, exemplo, acao, tipo, fornecedor_id, categoria, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (chave) DO UPDATE
            SET acao = EXCLUDED.acao, tipo = EXCLUDED.tipo,
                fornecedor_id = EXCLUDED.fornecedor_id, categoria = EXCLUDED.categoria,
                exemplo = COALESCE(EXCLUDED.exemplo, regras_extrato.exemplo),
                atualizado_em = now()`,
        [r.chave, r.exemplo || null, r.acao, r.acao === 'lancar' ? r.tipo : null,
         r.fornecedor_id || null, r.categoria || null, req.user.id]
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
          `Do extrato do banco — ${s.lancamento}`,
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
        'UPDATE regras_extrato SET vezes = vezes + 1 WHERE chave = ANY($1::text[])',
        [regras.map((r) => r.chave)]
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
    `SELECT r.*, f.nome AS fornecedor_nome
       FROM regras_extrato r
       LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
      ORDER BY r.vezes DESC, r.chave`
  );
  return res.json(rows);
}

async function deletarRegra(req, res) {
  const { rows } = await pool.query('DELETE FROM regras_extrato WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Regra não encontrada.' });
  return res.status(204).send();
}

module.exports = { analisar, importar, listarRegras, deletarRegra };
