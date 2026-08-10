const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

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
  const { rows } = await pool.query(`${SALDO_POR_CLIENTE} ORDER BY saldo DESC, c.nome`);

  const clientes = rows.map((r) => ({
    ...r,
    total_compras: Number(r.total_compras),
    total_pago: Number(r.total_pago),
    saldo: Number(r.saldo),
  }));

  return res.json({
    clientes,
    totais: {
      compras: clientes.reduce((a, c) => a + c.total_compras, 0),
      pago: clientes.reduce((a, c) => a + c.total_pago, 0),
      saldo: clientes.reduce((a, c) => a + c.saldo, 0),
      clientes_com_saldo: clientes.filter((c) => c.saldo > 0).length,
    },
  });
}

async function extratoCliente(req, res) {
  const { id } = req.params;

  const { rows: clienteRows } = await pool.query(`${SALDO_POR_CLIENTE} HAVING c.id = $1`, [id]);
  if (!clienteRows[0]) {
    return res.status(404).json({ error: 'Cliente não encontrado.' });
  }

  const { rows: movimentos } = await pool.query(
    'SELECT * FROM mov_prazo WHERE cliente_id = $1 ORDER BY data, id',
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
    `INSERT INTO mov_prazo (cliente_id, tipo, valor, data, observacoes, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [cliente_id, tipo || 'compra', valor, data, observacoes || null, req.user.id]
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

module.exports = { resumo, extratoCliente, criarMovimento, deletarMovimento };
