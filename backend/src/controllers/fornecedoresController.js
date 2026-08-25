const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

async function listar(req, res) {
  const { rows } = await pool.query('SELECT * FROM fornecedores ORDER BY nome');
  return res.json(rows);
}

// `ceasa` é só uma marca no mesmo cadastro: o fornecedor da Ceasa é fornecedor
// como qualquer outro, o que muda é em qual lista ele aparece na hora de lançar
// — e, por consequência, em qual coluna o gasto dele é somado.
async function criar(req, res) {
  const { nome, cnpj_cpf, telefone, pix, observacoes } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'Nome do fornecedor é obrigatório.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO fornecedores (nome, cnpj_cpf, telefone, pix, observacoes, ceasa)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [nome, cnpj_cpf || null, telefone || null, pix || null, observacoes || null, req.body.ceasa === true]
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
