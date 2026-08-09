const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { assinarTokenFolha } = require('../middleware/folha');

// Líquido = salário + bonificação - compras - adiantamento - outras - descontos.
// Mesma conta do sistema atual; nunca é armazenado, sempre derivado.
const SELECT_FOLHA = `
  SELECT
    f.*,
    f.salario + f.bonificacao - f.compras - f.adiantamento - f.outras - f.descontos AS liquido,
    COALESCE(p.total_pago, 0) AS total_pago,
    (f.salario + f.bonificacao - f.compras - f.adiantamento - f.outras - f.descontos)
      - COALESCE(p.total_pago, 0) AS saldo,
    (COALESCE(p.total_pago, 0) > 0
      AND (f.salario + f.bonificacao - f.compras - f.adiantamento - f.outras - f.descontos)
          - COALESCE(p.total_pago, 0) <= 0) AS quitado
  FROM folha f
  LEFT JOIN (
    SELECT folha_id, SUM(valor) AS total_pago FROM folha_pagamentos GROUP BY folha_id
  ) p ON p.folha_id = f.id
`;

async function desbloquear(req, res) {
  const { senha } = req.body;
  if (!senha) {
    return res.status(400).json({ error: 'Informe a senha da folha.' });
  }

  const { rows } = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'folha_senha_hash'");
  if (!rows[0] || !rows[0].valor) {
    return res.status(500).json({
      error: 'Senha da folha não configurada. Defina FOLHA_SENHA e rode o seed.',
    });
  }

  const ok = await bcrypt.compare(senha, rows[0].valor);
  if (!ok) {
    return res.status(401).json({ error: 'Senha da folha incorreta.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'desbloqueio',
    entidade: 'folha',
    entidadeId: 0,
  });

  return res.json({ folhaToken: assinarTokenFolha(req.user.id) });
}

async function listar(req, res) {
  const { de, ate } = req.query;
  const params = [];
  const condicoes = [];

  if (de) {
    params.push(de);
    condicoes.push(`f.data_ref >= $${params.length}`);
  }
  if (ate) {
    params.push(ate);
    condicoes.push(`f.data_ref <= $${params.length}`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const { rows } = await pool.query(`${SELECT_FOLHA} ${where} ORDER BY f.data_ref DESC NULLS LAST, f.nome`, params);

  const lancamentos = rows.map((r) => ({
    ...r,
    liquido: Number(r.liquido),
    total_pago: Number(r.total_pago),
    saldo: Number(r.saldo),
  }));

  return res.json({
    lancamentos,
    totais: {
      liquido: lancamentos.reduce((a, l) => a + l.liquido, 0),
      pago: lancamentos.reduce((a, l) => a + l.total_pago, 0),
      saldo: lancamentos.reduce((a, l) => a + l.saldo, 0),
    },
  });
}

async function criar(req, res) {
  const { funcionario_id, nome, tipo, data_ref } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'nome é obrigatório.' });
  }

  const numeros = ['salario', 'bonificacao', 'compras', 'adiantamento', 'outras', 'descontos'].map(
    (c) => Number(req.body[c] || 0)
  );
  if (numeros.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: 'Todos os valores precisam ser numéricos.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO folha (funcionario_id, nome, tipo, data_ref, salario, bonificacao,
                        compras, adiantamento, outras, descontos, observacoes, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      funcionario_id || null,
      nome,
      tipo || null,
      data_ref || null,
      ...numeros,
      req.body.observacoes || null,
      req.user.id,
    ]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'folha',
    entidadeId: rows[0].id,
    dados: rows[0],
  });

  return res.status(201).json(rows[0]);
}

async function registrarPagamento(req, res) {
  const { id } = req.params;
  const { valor, data_pagamento, forma_pagamento, observacoes } = req.body;

  if (!valor || Number(valor) <= 0 || !data_pagamento) {
    return res.status(400).json({ error: 'valor (maior que zero) e data_pagamento são obrigatórios.' });
  }

  const { rows: existe } = await pool.query('SELECT id FROM folha WHERE id = $1', [id]);
  if (!existe[0]) {
    return res.status(404).json({ error: 'Lançamento de folha não encontrado.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO folha_pagamentos (folha_id, valor, data_pagamento, forma_pagamento, observacoes, pago_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, valor, data_pagamento, forma_pagamento || null, observacoes || null, req.user.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'pagamento',
    entidade: 'folha',
    entidadeId: Number(id),
    dados: rows[0],
  });

  return res.status(201).json(rows[0]);
}

async function deletar(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('DELETE FROM folha WHERE id = $1 RETURNING id', [id]);

  if (!rows[0]) {
    return res.status(404).json({ error: 'Lançamento de folha não encontrado.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'folha',
    entidadeId: Number(id),
  });

  return res.status(204).send();
}

module.exports = { desbloquear, listar, criar, registrarPagamento, deletar, SELECT_FOLHA };
