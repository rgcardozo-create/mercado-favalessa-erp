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

// Aviso do painel. Roda ANTES da senha adicional de propósito: sem isso, saber
// que existe folha em aberto exigiria destravar a folha, e o aviso deixaria de
// servir para o que serve — lembrar de olhar.
//
// Por isso devolve só a contagem e o mês mais antigo. Nome e valor continuam
// atrás da senha (SPEC.md, seção 3).
async function pendencias(req, res) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS pendentes,
            to_char(min(data_ref), 'YYYY-MM') AS desde
       FROM (${SELECT_FOLHA}) t
      WHERE t.saldo > 0`
  );
  return res.json({ pendentes: rows[0].pendentes, desde: rows[0].desde });
}

// Funcionário que compra fiado é cliente do caderno como qualquer outro — o que
// liga as duas pontas é o código, digitado igual nos dois cadastros. Foi a
// escolha do dono: menos informação para preencher na hora da venda.
const SALDO_FIADO_DO_FUNCIONARIO = `
  SELECT c.id AS cliente_id, c.codigo, c.nome,
         COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'compra'), 0)
           - COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'pagamento'), 0) AS saldo
    FROM funcionarios f
    JOIN clientes c ON lower(btrim(c.codigo)) = lower(btrim(f.codigo))
    LEFT JOIN mov_prazo m ON m.cliente_id = c.id
   WHERE f.id = $1 AND f.codigo IS NOT NULL AND btrim(f.codigo) <> ''
   GROUP BY c.id
`;

// O que esse funcionário deve no caderno, para virar o campo "compras" da folha.
async function comprasDoFuncionario(req, res) {
  const { rows } = await pool.query(SALDO_FIADO_DO_FUNCIONARIO, [req.params.id]);
  if (!rows[0]) return res.json({ vinculado: false, saldo: 0 });

  return res.json({
    vinculado: true,
    cliente_id: rows[0].cliente_id,
    codigo: rows[0].codigo,
    nome: rows[0].nome,
    saldo: Number(rows[0].saldo),
  });
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

  const adiantamento = Number(req.body.adiantamento || 0);
  const abaterExtras = req.body.abater_extras !== false && funcionario_id && adiantamento > 0;

  const compras = Number(req.body.compras || 0);
  const liquidarFiado = req.body.liquidar_prazo !== false && funcionario_id && compras > 0;

  const cliente = await pool.connect();
  let criado;
  let extrasBaixados = 0;
  let fiadoLiquidado = 0;
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query(
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
    criado = rows[0];

    // O adiantamento descontado aqui quita o vale lá — senão o mesmo dinheiro
    // ficaria cobrado duas vezes: uma no saldo do extra, outra na folha.
    if (abaterExtras) {
      const { rows: abertos } = await cliente.query(
        `SELECT e.id, e.valor - COALESCE(b.total, 0) AS saldo
           FROM extras e
           LEFT JOIN (SELECT extra_id, SUM(valor) AS total FROM extras_baixas GROUP BY extra_id) b
             ON b.extra_id = e.id
          WHERE e.funcionario_id = $1
            AND e.valor - COALESCE(b.total, 0) > 0
            -- Serviço extra já foi pago e nasce quitado; se um dia sobrar saldo
            -- nele por qualquer motivo, ainda assim não é vale a descontar.
            AND e.tipo IS DISTINCT FROM 'servico'
          ORDER BY e.data, e.id`,
        [funcionario_id]
      );

      let restante = adiantamento;
      for (const extra of abertos) {
        if (restante <= 0) break;
        const baixa = Math.min(restante, Number(extra.saldo));
        await cliente.query(
          `INSERT INTO extras_baixas (extra_id, valor, data, observacoes)
           VALUES ($1, $2, $3, $4)`,
          [extra.id, baixa, data_ref || new Date().toISOString().slice(0, 10), `Descontado na folha #${criado.id}`]
        );
        restante -= baixa;
        extrasBaixados += 1;
      }
    }

    // A compra descontada aqui é paga aqui: sem isso a dívida continuaria de pé
    // no caderno depois de já ter saído do salário.
    if (liquidarFiado) {
      const { rows: vinculo } = await cliente.query(SALDO_FIADO_DO_FUNCIONARIO, [funcionario_id]);
      if (vinculo[0]) {
        await cliente.query(
          `INSERT INTO mov_prazo (cliente_id, tipo, valor, data, observacoes, criado_por)
           VALUES ($1, 'pagamento', $2, $3, $4, $5)`,
          [
            vinculo[0].cliente_id,
            compras,
            data_ref || new Date().toISOString().slice(0, 10),
            `Descontado na folha #${criado.id}`,
            req.user.id,
          ]
        );
        fiadoLiquidado = compras;
      }
    }

    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'folha',
    entidadeId: criado.id,
    dados: criado,
  });

  return res.status(201).json({ ...criado, extras_baixados: extrasBaixados, fiado_liquidado: fiadoLiquidado });
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

module.exports = {
  desbloquear,
  pendencias,
  comprasDoFuncionario,
  listar,
  criar,
  registrarPagamento,
  deletar,
  SELECT_FOLHA,
};
