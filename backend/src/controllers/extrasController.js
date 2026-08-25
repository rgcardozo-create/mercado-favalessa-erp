const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Extras de funcionário. São duas coisas diferentes, e a diferença é o que decide
// se o valor é despesa da empresa ou não:
//
//   adiantamento — vale que o funcionário pediu. Fica em aberto e é descontado
//   do salário na folha seguinte. NÃO é despesa: o dinheiro volta pelo desconto,
//   e contá-lo aqui duplicaria a despesa (SPEC.md, regra 3).
//
//   servico — serviço extra que o funcionário fez e já recebeu. Não desconta de
//   salário nenhum: é dinheiro que saiu da empresa e não volta, então É despesa
//   e entra nos totais dos relatórios. Nasce já quitado, com a baixa no mesmo
//   ato, justamente para nunca ser abatido de uma folha futura.
const TIPO_SERVICO = 'servico';
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

  const somar = (lista, campo) => lista.reduce((a, e) => a + Number(e[campo]), 0);
  const adiantamentos = extras.filter((e) => e.tipo !== TIPO_SERVICO);
  const servicos = extras.filter((e) => e.tipo === TIPO_SERVICO);

  return res.json({
    extras,
    totais: {
      valor: somar(extras, 'valor'),
      baixado: somar(extras, 'total_baixado'),
      saldo: somar(extras, 'saldo'),
      // Separados porque respondem a perguntas diferentes: o adiantamento em
      // aberto é dinheiro a receber de volta; o serviço extra é despesa fechada.
      adiantamentos: somar(adiantamentos, 'valor'),
      adiantamentos_em_aberto: somar(adiantamentos, 'saldo'),
      servicos: somar(servicos, 'valor'),
    },
  });
}

// O funcionário pode vir pelo id (lista da tela) ou pelo código digitado. O
// código é o que está no crachá e na boca do gerente — foi por ele que o
// funcionário já foi ligado ao cliente da venda a prazo, então é o mesmo caminho.
async function acharFuncionario({ funcionario_id: id, codigo }) {
  if (id) {
    const { rows } = await pool.query('SELECT id, nome, codigo FROM funcionarios WHERE id = $1', [id]);
    return rows[0] || null;
  }
  if (!codigo) return null;
  const { rows } = await pool.query(
    'SELECT id, nome, codigo FROM funcionarios WHERE lower(btrim(codigo)) = lower(btrim($1))',
    [String(codigo)]
  );
  return rows[0] || null;
}

async function criar(req, res) {
  const { valor, data, observacoes } = req.body;
  const tipo = req.body.tipo === TIPO_SERVICO ? TIPO_SERVICO : 'adiantamento';

  if (valor === undefined || !data) {
    return res.status(400).json({ error: 'valor e data são obrigatórios.' });
  }
  if (!(Number(valor) > 0)) {
    return res.status(400).json({ error: 'valor precisa ser maior que zero.' });
  }

  const funcionario = await acharFuncionario(req.body);
  const nome = funcionario ? funcionario.nome : req.body.nome;
  if (!nome) {
    return res.status(400).json({
      error: req.body.codigo
        ? `Nenhum funcionário com o código ${req.body.codigo}. Confira no cadastro de funcionários.`
        : 'Escolha o funcionário (pelo nome ou pelo código).',
    });
  }

  const cliente = await pool.connect();
  let criado;
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query(
      `INSERT INTO extras (funcionario_id, nome, codigo, tipo, valor, data, observacoes, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        funcionario ? funcionario.id : null,
        nome,
        (funcionario && funcionario.codigo) || req.body.codigo || null,
        tipo,
        valor,
        data,
        observacoes || null,
        req.user.id,
      ]
    );
    criado = rows[0];

    // Serviço extra já foi pago: a baixa nasce junto. Sem ela o valor ficaria
    // "em aberto" e a próxima folha o abateria do salário — cobrando do
    // funcionário um dinheiro que a empresa já tinha dado a ele.
    if (tipo === TIPO_SERVICO) {
      await cliente.query(
        `INSERT INTO extras_baixas (extra_id, valor, data, observacoes)
         VALUES ($1, $2, $3, $4)`,
        [criado.id, valor, data, 'Pago no ato — serviço extra']
      );
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
    entidade: 'extras',
    entidadeId: criado.id,
    dados: criado,
  });

  return res.status(201).json(criado);
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
