const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { faturasAbertas } = require('../utils/faturasPrazo');

// Dia de corte e dia de vencimento do caderno. Vêm do sistema antigo e moram em
// `configuracoes`, como os percentuais da folha: são regra da casa, não dado de
// lançamento.
const PRAZO_PADRAO = { dia_corte: 1, dia_vencimento: 10 };

async function lerConfigPrazo() {
  const { rows } = await pool.query(
    "SELECT chave, valor FROM configuracoes WHERE chave IN ('prazo_dia_corte', 'prazo_dia_vencimento')"
  );
  const guardado = new Map(rows.map((r) => [r.chave, Number(r.valor)]));
  const limpo = (v, padrao) => (Number.isInteger(v) && v >= 1 && v <= 28 ? v : padrao);
  return {
    dia_corte: limpo(guardado.get('prazo_dia_corte'), PRAZO_PADRAO.dia_corte),
    dia_vencimento: limpo(guardado.get('prazo_dia_vencimento'), PRAZO_PADRAO.dia_vencimento),
  };
}

async function hojeSP() {
  const { rows } = await pool.query(
    "SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS hoje"
  );
  return rows[0].hoje;
}

// Saldo devedor por cliente: o que ele comprou menos o que já pagou.
const SALDO_POR_CLIENTE = `
  SELECT
    c.id, c.codigo, c.nome, c.telefone,
    COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'compra'), 0) AS total_compras,
    COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'pagamento'), 0) AS total_pago,
    COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'compra'), 0)
      - COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'pagamento'), 0) AS saldo,
    count(m.id)::int AS movimentos,
    max(m.data) AS ultimo_movimento
  FROM clientes c
  LEFT JOIN mov_prazo m ON m.cliente_id = c.id
  GROUP BY c.id
`;

async function resumo(req, res) {
  const [{ rows }, config, hoje] = await Promise.all([
    pool.query(`${SALDO_POR_CLIENTE} ORDER BY saldo DESC, c.nome`),
    lerConfigPrazo(),
    hojeSP(),
  ]);

  // Todos os movimentos de uma vez, e não uma consulta por cliente: com
  // trezentos clientes isso seriam trezentas idas ao banco para montar uma tela.
  const { rows: movimentos } = await pool.query(
    `SELECT cliente_id, tipo::text AS tipo, valor, to_char(data, 'YYYY-MM-DD') AS data
       FROM mov_prazo ORDER BY data, id`
  );
  const porCliente = new Map();
  for (const m of movimentos) {
    if (!porCliente.has(m.cliente_id)) porCliente.set(m.cliente_id, []);
    porCliente.get(m.cliente_id).push(m);
  }

  const opcoes = { diaCorte: config.dia_corte, diaVencimento: config.dia_vencimento, hoje };

  const clientes = rows.map((r) => {
    const f = faturasAbertas(porCliente.get(r.id) || [], opcoes);
    return {
      ...r,
      total_compras: Number(r.total_compras),
      total_pago: Number(r.total_pago),
      saldo: Number(r.saldo),
      ultima_compra: (porCliente.get(r.id) || []).filter((m) => m.tipo === 'compra').slice(-1)[0]?.data || null,
      faturas: f.faturas,
      atraso_30: f.atraso_30,
      situacao: f.situacao,
    };
  });

  return res.json({
    config,
    hoje,
    clientes,
    totais: {
      compras: clientes.reduce((a, c) => a + c.total_compras, 0),
      pago: clientes.reduce((a, c) => a + c.total_pago, 0),
      saldo: clientes.reduce((a, c) => a + c.saldo, 0),
      clientes_com_saldo: clientes.filter((c) => c.saldo > 0).length,
      // Os dois recortes do sistema antigo: quem passou de 30 dias e quem não.
      atrasados: clientes.filter((c) => c.situacao === 'atrasado').length,
      em_dia_ate_30: clientes.filter((c) => c.situacao === 'devendo').length,
      total_atrasado: clientes.reduce((a, c) => a + c.atraso_30, 0),
    },
  });
}

async function salvarConfigPrazo(req, res) {
  const limpo = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 28 ? n : null;
  };
  const corte = limpo(req.body.dia_corte);
  const vencimento = limpo(req.body.dia_vencimento);
  if (corte === null || vencimento === null) {
    return res.status(400).json({ error: 'Dia de corte e de vencimento: use números de 1 a 28.' });
  }

  for (const [chave, valor] of [['prazo_dia_corte', corte], ['prazo_dia_vencimento', vencimento]]) {
    await pool.query(
      `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES ($1, $2, now())
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [chave, String(valor)]
    );
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'update',
    entidade: 'prazo_config',
    dados: { dia_corte: corte, dia_vencimento: vencimento },
  });

  return res.json(await lerConfigPrazo());
}

async function extratoCliente(req, res) {
  const { id } = req.params;

  const { rows: clienteRows } = await pool.query(`${SALDO_POR_CLIENTE} HAVING c.id = $1`, [id]);
  if (!clienteRows[0]) {
    return res.status(404).json({ error: 'Cliente não encontrado.' });
  }

  // DATE vira texto aqui: devolver o objeto Date faz o dia voltar um quando o
  // servidor está em UTC e a loja, em São Paulo.
  const { rows: movimentos } = await pool.query(
    `SELECT id, cliente_id, tipo::text AS tipo, valor,
            to_char(data, 'YYYY-MM-DD') AS data, observacoes, forma_pagamento
       FROM mov_prazo WHERE cliente_id = $1 ORDER BY data, id`,
    [id]
  );

  const cliente = clienteRows[0];
  return res.json({
    ...cliente,
    total_compras: Number(cliente.total_compras),
    total_pago: Number(cliente.total_pago),
    saldo: Number(cliente.saldo),
    movimentos,
  });
}

async function criarMovimento(req, res) {
  const { cliente_id, tipo, valor, data, observacoes } = req.body;
  // Como o cliente pagou. Só faz sentido no pagamento: a compra fiada é, por
  // definição, a que ainda não foi paga por forma nenhuma.
  const forma = tipo === 'pagamento' ? String(req.body.forma_pagamento || '').trim() || null : null;

  if (!cliente_id || valor === undefined || !data) {
    return res.status(400).json({ error: 'cliente_id, valor e data são obrigatórios.' });
  }
  if (Number(valor) < 0) {
    return res.status(400).json({ error: 'valor não pode ser negativo.' });
  }
  if (tipo && !['compra', 'pagamento'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo inválido. Use compra ou pagamento.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO mov_prazo (cliente_id, tipo, valor, data, observacoes, forma_pagamento, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, cliente_id, tipo::text AS tipo, valor,
               to_char(data, 'YYYY-MM-DD') AS data, observacoes, forma_pagamento`,
    [cliente_id, tipo || 'compra', valor, data, observacoes || null, forma, req.user.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'mov_prazo',
    entidadeId: rows[0].id,
    dados: rows[0],
  });

  return res.status(201).json(rows[0]);
}

async function deletarMovimento(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('DELETE FROM mov_prazo WHERE id = $1 RETURNING id', [id]);

  if (!rows[0]) {
    return res.status(404).json({ error: 'Movimento não encontrado.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'mov_prazo',
    entidadeId: Number(id),
  });

  return res.status(204).send();
}

module.exports = {
  salvarConfigPrazo, resumo, extratoCliente, criarMovimento, deletarMovimento };
