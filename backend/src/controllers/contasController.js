const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { SELECT_CONTAS_COM_SALDO, TIPOS_VALIDOS } = require('../db/contasQuery');

async function listar(req, res) {
  const { status, tipo } = req.query; // status: pendente|quitado — tipo: fornecedor|fixa|imposto|despesa
  const filtros = [];
  const params = [];

  if (status === 'pendente' || status === 'quitado') {
    params.push(status === 'quitado');
    filtros.push(`t.quitado = $${params.length}`);
  }

  if (tipo) {
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ error: `tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
    }
    params.push(tipo);
    filtros.push(`t.tipo = $${params.length}`);
  }

  const where = filtros.length ? ` WHERE ${filtros.join(' AND ')}` : '';
  const query = `SELECT * FROM (${SELECT_CONTAS_COM_SALDO}) t${where} ORDER BY t.vencimento`;

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
  const { fornecedor_id, descricao, valor, vencimento, categoria } = req.body;
  const tipo = req.body.tipo || 'fornecedor';

  if (!descricao || valor === undefined || !vencimento) {
    return res.status(400).json({ error: 'descricao, valor e vencimento são obrigatórios.' });
  }
  if (Number(valor) < 0) {
    return res.status(400).json({ error: 'valor não pode ser negativo.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
  }

  // Fornecedor só faz sentido em conta do tipo fornecedor.
  const fornecedorId = tipo === 'fornecedor' ? fornecedor_id || null : null;

  const { rows } = await pool.query(
    `INSERT INTO contas (tipo, categoria, fornecedor_id, descricao, valor, vencimento, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tipo, categoria || null, fornecedorId, descricao, valor, vencimento, req.user.id]
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
  const { fornecedor_id, descricao, valor, vencimento, categoria } = req.body;

  // `tipo` não é editável: mudar o tipo de uma conta já lançada bagunçaria o
  // histórico e os totais por tela. Para trocar, exclua e lance de novo.
  const { rows } = await pool.query(
    `UPDATE contas
     SET fornecedor_id = COALESCE($1, fornecedor_id),
         descricao = COALESCE($2, descricao),
         valor = COALESCE($3, valor),
         vencimento = COALESCE($4, vencimento),
         categoria = COALESCE($5, categoria),
         atualizado_em = now()
     WHERE id = $6
     RETURNING *`,
    [fornecedor_id, descricao, valor, vencimento, categoria, id]
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
