const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

async function listar(req, res) {
  const { rows } = await pool.query('SELECT * FROM fornecedores ORDER BY nome');
  return res.json(rows);
}

async function criar(req, res) {
  const { nome, cnpj_cpf, telefone, observacoes } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'Nome do fornecedor é obrigatório.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO fornecedores (nome, cnpj_cpf, telefone, observacoes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [nome, cnpj_cpf || null, telefone || null, observacoes || null]
  );
  const fornecedor = rows[0];

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'fornecedores',
    entidadeId: fornecedor.id,
    dados: fornecedor,
  });

  return res.status(201).json(fornecedor);
}

module.exports = { listar, criar };
