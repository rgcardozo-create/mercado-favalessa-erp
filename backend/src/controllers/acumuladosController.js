const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

const CAMPOS_VALOR = ['dinheiro', 'cartao', 'pix', 'tickets', 'pos_sistema', 'pos_maquina', 'outras'];

// O total do dia é sempre derivado dos campos, nunca guardado — evita o total
// ficar defasado quando alguém corrige um dos valores.
function comTotal(linha) {
  const total = CAMPOS_VALOR.reduce((acc, campo) => acc + Number(linha[campo] || 0), 0);
  return { ...linha, total };
}

async function listar(req, res) {
  const { de, ate } = req.query;
  const params = [];
  const condicoes = [];

  if (de) {
    params.push(de);
    condicoes.push(`data >= $${params.length}`);
  }
  if (ate) {
    params.push(ate);
    condicoes.push(`data <= $${params.length}`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM acumulados ${where} ORDER BY data DESC`, params);

  const acumulados = rows.map(comTotal);
  const totais = CAMPOS_VALOR.reduce((acc, campo) => {
    acc[campo] = acumulados.reduce((s, a) => s + Number(a[campo] || 0), 0);
    return acc;
  }, {});
  totais.total = acumulados.reduce((s, a) => s + a.total, 0);

  return res.json({ acumulados, totais });
}

async function criar(req, res) {
  const { data, observacoes } = req.body;
  if (!data) {
    return res.status(400).json({ error: 'data é obrigatória.' });
  }

  const valores = CAMPOS_VALOR.map((campo) => Number(req.body[campo] || 0));
  if (valores.some((v) => !Number.isFinite(v))) {
    return res.status(400).json({ error: 'Todos os valores precisam ser numéricos.' });
  }

  // Um acumulado por dia: relançar a mesma data corrige a conferência daquele dia.
  const { rows } = await pool.query(
    `INSERT INTO acumulados (data, ${CAMPOS_VALOR.join(', ')}, observacoes, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (data) DO UPDATE
       SET ${CAMPOS_VALOR.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
           observacoes = EXCLUDED.observacoes,
           atualizado_em = now()
     RETURNING *`,
    [data, ...valores, observacoes || null, req.user.id]
  );
  const acumulado = rows[0];

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'acumulados',
    entidadeId: acumulado.id,
    dados: acumulado,
  });

  return res.status(201).json(comTotal(acumulado));
}

async function deletar(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('DELETE FROM acumulados WHERE id = $1 RETURNING id', [id]);

  if (!rows[0]) {
    return res.status(404).json({ error: 'Acumulado não encontrado.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'acumulados',
    entidadeId: Number(id),
  });

  return res.status(204).send();
}

module.exports = { listar, criar, deletar };
