const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Extras = adiantamentos/vales de funcionário.
//
// IMPORTANTE: estes valores NÃO entram em nenhuma soma de despesa da empresa.
// Eles já são descontados na folha (campo `adiantamento`), então contá-los de novo
// duplicaria a despesa (SPEC.md, regra 3). Por isso este controller nunca é
// chamado pelo painel nem pelos relatórios de despesa.
const SELECT_EXTRAS = `
  SELECT
    e.*,
    COALESCE(b.total_baixado, 0) AS total_baixado,
    e.valor - COALESCE(b.total_baixado, 0) AS saldo,
    (COALESCE(b.total_baixado, 0) > 0 AND e.valor - COALESCE(b.total_baixado, 0) <= 0) AS quitado
  FROM extras e
  LEFT JOIN (
    SELECT extra_id, SUM(valor) AS total_baixado FROM extras_baixas GROUP BY extra_id
  ) b ON b.extra_id = e.id
`;

async function listar(req, res) {
  const { rows } = await pool.query(`${SELECT_EXTRAS} ORDER BY e.data DESC`);

  const extras = rows.map((r) => ({
    ...r,
    total_baixado: Number(r.total_baixado),
    saldo: Number(r.saldo),
  }));

  return res.json({
    extras,
    totais: {
      valor: extras.reduce((a, e) => a + Number(e.valor), 0),
      baixado: extras.reduce((a, e) => a + e.total_baixado, 0),
      saldo: extras.reduce((a, e) => a + e.saldo, 0),
    },
  });
}

async function criar(req, res) {
  const { funcionario_id, nome, codigo, tipo, valor, data, observacoes } = req.body;

  if (!nome || valor === undefined || !data) {
    return res.status(400).json({ error: 'nome, valor e data são obrigatórios.' });
  }
  if (Number(valor) < 0) {
    return res.status(400).json({ error: 'valor não pode ser negativo.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO extras (funcionario_id, nome, codigo, tipo, valor, data, observacoes, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [funcionario_id || null, nome, codigo || null, tipo || 'adiantamento', valor, data, observacoes || null, req.user.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'extras',
    entidadeId: rows[0].id,
    dados: rows[0],
  });

  return res.status(201).json(rows[0]);
}

async function registrarBaixa(req, res) {
  const { id } = req.params;
  const { valor, data, observacoes } = req.body;

  if (!valor || Number(valor) <= 0 || !data) {
    return res.status(400).json({ error: 'valor (maior que zero) e data são obrigatórios.' });
  }

  const { rows: existe } = await pool.query('SELECT id FROM extras WHERE id = $1', [id]);
  if (!existe[0]) {
    return res.status(404).json({ error: 'Extra não encontrado.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO extras_baixas (extra_id, valor, data, observacoes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, valor, data, observacoes || null]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'baixa',
    entidade: 'extras',
    entidadeId: Number(id),
    dados: rows[0],
  });

  return res.status(201).json(rows[0]);
}

async function deletar(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('DELETE FROM extras WHERE id = $1 RETURNING id', [id]);

  if (!rows[0]) {
    return res.status(404).json({ error: 'Extra não encontrado.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'extras',
    entidadeId: Number(id),
  });

  return res.status(204).send();
}

module.exports = { listar, criar, registrarBaixa, deletar };
