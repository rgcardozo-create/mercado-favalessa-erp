const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { SELECT_CONTAS_COM_SALDO } = require('../db/contasQuery');

async function listar(req, res) {
  const { status } = req.query; // 'pendente' | 'quitado' (opcional)
  let query = SELECT_CONTAS_COM_SALDO;
  const params = [];

  if (status === 'pendente' || status === 'quitado') {
    const quitadoBool = status === 'quitado';
    query = `SELECT * FROM (${SELECT_CONTAS_COM_SALDO}) t WHERE t.quitado = $1`;
    params.push(quitadoBool);
  }

  query += params.length ? ' ORDER BY vencimento' : ' ORDER BY c.vencimento';
  const { rows } = await pool.query(query, params);
  return res.json(rows);
}

async function obter(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(`${SELECT_CONTAS_COM_SALDO} WHERE c.id = $1`, [id]);
  if (!rows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  const { rows: pagamentos } = await pool.query(
    'SELECT * FROM contas_pagamentos WHERE conta_id = $1 ORDER BY data_pagamento',
    [id]
  );

  return res.json({ ...rows[0], pagamentos });
}

async function criar(req, res) {
  const { fornecedor_id, descricao, valor, vencimento } = req.body;
  if (!descricao || valor === undefined || !vencimento) {
    return res.status(400).json({ error: 'descricao, valor e vencimento são obrigatórios.' });
  }
  if (Number(valor) < 0) {
    return res.status(400).json({ error: 'valor não pode ser negativo.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO contas (fornecedor_id, descricao, valor, vencimento, criado_por)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [fornecedor_id || null, descricao, valor, vencimento, req.user.id]
  );
  const conta = rows[0];

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'contas',
    entidadeId: conta.id,
    dados: conta,
  });

  return res.status(201).json(conta);
}

async function atualizar(req, res) {
  const { id } = req.params;
  const { fornecedor_id, descricao, valor, vencimento } = req.body;

  const { rows } = await pool.query(
    `UPDATE contas
     SET fornecedor_id = COALESCE($1, fornecedor_id),
         descricao = COALESCE($2, descricao),
         valor = COALESCE($3, valor),
         vencimento = COALESCE($4, vencimento),
         atualizado_em = now()
     WHERE id = $5
     RETURNING *`,
    [fornecedor_id, descricao, valor, vencimento, id]
  );

  if (!rows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'update',
    entidade: 'contas',
    entidadeId: rows[0].id,
    dados: rows[0],
  });

  return res.json(rows[0]);
}

async function deletar(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('DELETE FROM contas WHERE id = $1 RETURNING id', [id]);

  if (!rows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'contas',
    entidadeId: Number(id),
  });

  return res.status(204).send();
}

async function registrarPagamento(req, res) {
  const { id } = req.params;
  const { valor, data_pagamento, forma_pagamento } = req.body;

  if (!valor || Number(valor) <= 0 || !data_pagamento) {
    return res.status(400).json({ error: 'valor (maior que zero) e data_pagamento são obrigatórios.' });
  }

  const { rows: contaRows } = await pool.query('SELECT id FROM contas WHERE id = $1', [id]);
  if (!contaRows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO contas_pagamentos (conta_id, valor, data_pagamento, forma_pagamento, pago_por)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, valor, data_pagamento, forma_pagamento || null, req.user.id]
  );
  const pagamento = rows[0];

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'pagamento',
    entidade: 'contas',
    entidadeId: Number(id),
    dados: pagamento,
  });

  return res.status(201).json(pagamento);
}

module.exports = { listar, obter, criar, atualizar, deletar, registrarPagamento };
