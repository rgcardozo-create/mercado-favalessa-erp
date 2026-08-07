const pool = require('../db/pool');

async function registrarAuditoria({ usuarioId, acao, entidade, entidadeId, dados }) {
  await pool.query(
    `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, dados)
     VALUES ($1, $2, $3, $4, $5)`,
    [usuarioId, acao, entidade, entidadeId, dados ? JSON.stringify(dados) : null]
  );
}

module.exports = { registrarAuditoria };
