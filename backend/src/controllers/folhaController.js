const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { assinarTokenFolha } = require('../middleware/folha');

// Líquido = salário + bonificação - compras - adiantamento - outras - descontos.
// Mesma conta do sistema atual; nunca é armazenado, sempre derivado.
const SELECT_FOLHA = `
  SELECT
    -- Sem f.* de propósito. A data precisa sair como texto — DATE virando Date do
    -- JavaScript volta como instante UTC e escorrega um dia dependendo do fuso,
    -- o mesmo motivo pelo qual as contas já saem daqui como texto. Com o coringa,
    -- o to_char viraria uma SEGUNDA coluna chamada data_ref, e qualquer consulta
    -- que envolvesse esta aqui quebrava com "column reference is ambiguous".
    f.id, f.funcionario_id, f.nome, f.tipo,
    to_char(f.data_ref, 'YYYY-MM-DD') AS data_ref,
    f.salario, f.bonificacao, f.compras, f.adiantamento, f.outras, f.descontos,
    f.dias_ferias, f.observacoes, f.legado_id, f.criado_por, f.criado_em, f.atualizado_em,
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
    // data_ref já vem como texto 'AAAA-MM-DD' — e nesse formato a ordem
    // alfabética é a ordem do calendário, então min() dá a folha mais antiga e os
    // sete primeiros caracteres dão o mês.
    `SELECT count(*)::int AS pendentes,
            left(min(t.data_ref), 7) AS desde
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

// Lançar folha mexe em duas coisas que vivem fora dela: dá baixa nos vales em
// aberto do funcionário e quita, no caderno de fiado, o que foi descontado em
// "compras". Os dois registros nascem marcados com o número da folha — e é por
// essa marca que a edição e a exclusão os encontram para desfazer.
//
// Sem isso, corrigir um adiantamento digitado errado deixaria o vale baixado
// pelo valor antigo, e excluir a folha deixaria o vale quitado sem folha
// nenhuma para justificar. O dinheiro sumiria da conta sem sumir da vida.
const marcaDaFolha = (id) => `Descontado na folha #${id}`;

async function desfazerEfeitos(cliente, folhaId) {
  const marca = marcaDaFolha(folhaId);
  await cliente.query('DELETE FROM extras_baixas WHERE observacoes = $1', [marca]);
  await cliente.query("DELETE FROM mov_prazo WHERE tipo = 'pagamento' AND observacoes = $1", [marca]);
}

async function aplicarEfeitos(cliente, { folhaId, funcionarioId, adiantamento, compras, dataRef, usuarioId }) {
  const quando = dataRef || new Date().toISOString().slice(0, 10);
  const marca = marcaDaFolha(folhaId);
  let extrasBaixados = 0;
  let fiadoLiquidado = 0;

  // O adiantamento descontado aqui quita o vale lá — senão o mesmo dinheiro
  // ficaria cobrado duas vezes: uma no saldo do extra, outra na folha.
  if (funcionarioId && adiantamento > 0) {
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
      [funcionarioId]
    );

    let restante = adiantamento;
    for (const extra of abertos) {
      if (restante <= 0) break;
      const baixa = Math.min(restante, Number(extra.saldo));
      await cliente.query(
        `INSERT INTO extras_baixas (extra_id, valor, data, observacoes)
         VALUES ($1, $2, $3, $4)`,
        [extra.id, baixa, quando, marca]
      );
      restante -= baixa;
      extrasBaixados += 1;
    }
  }

  // A compra descontada aqui é paga aqui: sem isso a dívida continuaria de pé
  // no caderno depois de já ter saído do salário.
  if (funcionarioId && compras > 0) {
    const { rows: vinculo } = await cliente.query(SALDO_FIADO_DO_FUNCIONARIO, [funcionarioId]);
    if (vinculo[0]) {
      await cliente.query(
        `INSERT INTO mov_prazo (cliente_id, tipo, valor, data, observacoes, criado_por)
         VALUES ($1, 'pagamento', $2, $3, $4, $5)`,
        [vinculo[0].cliente_id, compras, quando, marca, usuarioId]
      );
      fiadoLiquidado = compras;
    }
  }

  return { extrasBaixados, fiadoLiquidado };
}

const CAMPOS_VALOR = ['salario', 'bonificacao', 'compras', 'adiantamento', 'outras', 'descontos'];

async function criar(req, res) {
  const { funcionario_id, nome, tipo, data_ref } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'nome é obrigatório.' });
  }

  const numeros = CAMPOS_VALOR.map((c) => Number(req.body[c] || 0));
  if (numeros.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: 'Todos os valores precisam ser numéricos.' });
  }

  const adiantamento = req.body.abater_extras === false ? 0 : Number(req.body.adiantamento || 0);
  const compras = req.body.liquidar_prazo === false ? 0 : Number(req.body.compras || 0);

  const cliente = await pool.connect();
  let criado;
  let efeitos;
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

    efeitos = await aplicarEfeitos(cliente, {
      folhaId: criado.id,
      funcionarioId: funcionario_id,
      adiantamento,
      compras,
      dataRef: data_ref,
      usuarioId: req.user.id,
    });

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

  return res
    .status(201)
    .json({ ...criado, extras_baixados: efeitos.extrasBaixados, fiado_liquidado: efeitos.fiadoLiquidado });
}

// Corrigir um lançamento é refazê-lo por inteiro: os vales que ele tinha baixado
// e o fiado que ele tinha quitado são desfeitos e refeitos com os valores novos.
// Meio-termo aqui produziria vale baixado por um valor que não está mais em
// lugar nenhum.
async function atualizar(req, res) {
  const id = Number(req.params.id);
  const { rows: atuais } = await pool.query('SELECT * FROM folha WHERE id = $1', [id]);
  const atual = atuais[0];
  if (!atual) {
    return res.status(404).json({ error: 'Lançamento de folha não encontrado.' });
  }

  const nome = req.body.nome ?? atual.nome;
  if (!nome) {
    return res.status(400).json({ error: 'nome é obrigatório.' });
  }

  const numeros = CAMPOS_VALOR.map((c) => Number(req.body[c] ?? atual[c]));
  if (numeros.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: 'Todos os valores precisam ser numéricos.' });
  }

  const funcionarioId =
    req.body.funcionario_id === undefined ? atual.funcionario_id : req.body.funcionario_id || null;
  const dataRef = req.body.data_ref === undefined ? atual.data_ref : req.body.data_ref || null;
  const tipo = req.body.tipo === undefined ? atual.tipo : req.body.tipo || null;
  const observacoes =
    req.body.observacoes === undefined ? atual.observacoes : req.body.observacoes || null;

  const [, , compras, adiantamento] = numeros;

  const cliente = await pool.connect();
  let salvo;
  let efeitos;
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query(
      `UPDATE folha
          SET funcionario_id = $2, nome = $3, tipo = $4, data_ref = $5,
              salario = $6, bonificacao = $7, compras = $8, adiantamento = $9,
              outras = $10, descontos = $11, observacoes = $12, atualizado_em = now()
        WHERE id = $1
        RETURNING *`,
      [id, funcionarioId, nome, tipo, dataRef, ...numeros, observacoes]
    );
    salvo = rows[0];

    await desfazerEfeitos(cliente, id);
    efeitos = await aplicarEfeitos(cliente, {
      folhaId: id,
      funcionarioId,
      adiantamento: req.body.abater_extras === false ? 0 : adiantamento,
      compras: req.body.liquidar_prazo === false ? 0 : compras,
      dataRef,
      usuarioId: req.user.id,
    });

    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'update',
    entidade: 'folha',
    entidadeId: id,
    dados: { antes: atual, depois: salvo },
  });

  return res.json({
    ...salvo,
    extras_baixados: efeitos.extrasBaixados,
    fiado_liquidado: efeitos.fiadoLiquidado,
  });
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

// Excluir também desfaz o que o lançamento tinha feito por fora. Sem isso o vale
// continuaria baixado e o fiado continuaria quitado por uma folha que não existe
// mais — e o funcionário sairia devendo menos do que deve.
async function deletar(req, res) {
  const id = Number(req.params.id);

  const cliente = await pool.connect();
  let apagado;
  try {
    await cliente.query('BEGIN');
    await desfazerEfeitos(cliente, id);
    const { rows } = await cliente.query('DELETE FROM folha WHERE id = $1 RETURNING id', [id]);
    apagado = rows[0];
    await cliente.query(apagado ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  if (!apagado) {
    return res.status(404).json({ error: 'Lançamento de folha não encontrado.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'folha',
    entidadeId: id,
  });

  return res.status(204).send();
}

module.exports = {
  desbloquear,
  pendencias,
  comprasDoFuncionario,
  listar,
  criar,
  atualizar,
  registrarPagamento,
  deletar,
  SELECT_FOLHA,
};
