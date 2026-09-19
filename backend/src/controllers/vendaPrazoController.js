const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { faturasAbertas, FAIXAS } = require('../utils/faturasPrazo');

// Dia de corte e dia de vencimento do caderno. Vêm do sistema antigo e moram em
// `configuracoes`, como os percentuais da folha: são regra da casa, não dado de
// lançamento.
const PRAZO_PADRAO = { dia_corte: 1, dia_vencimento: 10 };

async function lerConfigPrazo() {
  const { rows } = await pool.query(
    "SELECT chave, valor FROM configuracoes WHERE chave IN ('prazo_dia_corte', 'prazo_dia_vencimento')"
  );
  const guardado = new Map(rows.map((r) => [r.chave, Number(r.valor)]));
  const limpo = (v, padrao) => (Number.isInteger(v) && v >= 1 && v <= 28 ? v : padrao);
  return {
    dia_corte: limpo(guardado.get('prazo_dia_corte'), PRAZO_PADRAO.dia_corte),
    dia_vencimento: limpo(guardado.get('prazo_dia_vencimento'), PRAZO_PADRAO.dia_vencimento),
  };
}

async function hojeSP() {
  const { rows } = await pool.query(
    "SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS hoje"
  );
  return rows[0].hoje;
}

// Saldo devedor por cliente: o que ele comprou menos o que já pagou.
const SALDO_POR_CLIENTE = `
  SELECT
    c.id, c.codigo, c.nome, c.telefone,
    COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'compra'), 0) AS total_compras,
    COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'pagamento'), 0) AS total_pago,
    COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'compra'), 0)
      - COALESCE(sum(m.valor) FILTER (WHERE m.tipo = 'pagamento'), 0) AS saldo,
    count(m.id)::int AS movimentos,
    max(m.data) AS ultimo_movimento
  FROM clientes c
  LEFT JOIN mov_prazo m ON m.cliente_id = c.id
  GROUP BY c.id
`;

async function resumo(req, res) {
  const [{ rows }, config, hoje] = await Promise.all([
    pool.query(`${SALDO_POR_CLIENTE} ORDER BY saldo DESC, c.nome`),
    lerConfigPrazo(),
    hojeSP(),
  ]);

  // Todos os movimentos de uma vez, e não uma consulta por cliente: com
  // trezentos clientes isso seriam trezentas idas ao banco para montar uma tela.
  const { rows: movimentos } = await pool.query(
    `SELECT cliente_id, tipo::text AS tipo, valor, to_char(data, 'YYYY-MM-DD') AS data
       FROM mov_prazo ORDER BY data, id`
  );
  const porCliente = new Map();
  for (const m of movimentos) {
    if (!porCliente.has(m.cliente_id)) porCliente.set(m.cliente_id, []);
    porCliente.get(m.cliente_id).push(m);
  }

  const opcoes = { diaCorte: config.dia_corte, diaVencimento: config.dia_vencimento, hoje };

  const clientes = rows.map((r) => {
    const f = faturasAbertas(porCliente.get(r.id) || [], opcoes);
    return {
      ...r,
      total_compras: Number(r.total_compras),
      total_pago: Number(r.total_pago),
      saldo: Number(r.saldo),
      ultima_compra: (porCliente.get(r.id) || []).filter((m) => m.tipo === 'compra').slice(-1)[0]?.data || null,
      faturas: f.faturas,
      atrasos: f.atrasos,
      atraso_30: f.atraso_30,
      situacao: f.situacao,
    };
  });

  return res.json({
    config,
    hoje,
    clientes,
    totais: {
      compras: clientes.reduce((a, c) => a + c.total_compras, 0),
      pago: clientes.reduce((a, c) => a + c.total_pago, 0),
      saldo: clientes.reduce((a, c) => a + c.saldo, 0),
      clientes_com_saldo: clientes.filter((c) => c.saldo > 0).length,
      // Os dois recortes do sistema antigo: quem passou de 30 dias e quem não.
      atrasados: clientes.filter((c) => c.situacao === 'atrasado').length,
      em_dia_ate_30: clientes.filter((c) => c.situacao === 'devendo').length,
      total_atrasado: clientes.reduce((a, c) => a + c.atraso_30, 0),
      // Quanto há em cada faixa, para a tela não ter que somar de novo.
      por_faixa: Object.fromEntries(
        FAIXAS.map((d) => [d, Math.round(clientes.reduce((a, c) => a + (c.atrasos[d] || 0), 0) * 100) / 100])
      ),
    },
    faixas: FAIXAS,
  });
}

// Quem passou de 30 dias vencido — para o painel do dia avisar.
//
// O dono pediu porque é a hora de bloquear o cliente na balança, e essa decisão
// não pode depender de ele lembrar de abrir a tela de venda a prazo. Devolve
// nome e valor de propósito: caderno de fiado não é a folha, e sem o nome o
// aviso não serve para nada — "alguém está atrasado" não bloqueia ninguém.
async function alertas(req, res) {
  const [config, hoje] = await Promise.all([lerConfigPrazo(), hojeSP()]);

  const { rows: movimentos } = await pool.query(
    `SELECT m.cliente_id, c.codigo, c.nome, m.tipo::text AS tipo, m.valor,
            to_char(m.data, 'YYYY-MM-DD') AS data
       FROM mov_prazo m JOIN clientes c ON c.id = m.cliente_id
      ORDER BY m.data, m.id`
  );

  const porCliente = new Map();
  for (const m of movimentos) {
    if (!porCliente.has(m.cliente_id)) {
      porCliente.set(m.cliente_id, { id: m.cliente_id, codigo: m.codigo, nome: m.nome, movimentos: [] });
    }
    porCliente.get(m.cliente_id).movimentos.push(m);
  }

  const opcoes = { diaCorte: config.dia_corte, diaVencimento: config.dia_vencimento, hoje };
  const bloquear = [];
  for (const c of porCliente.values()) {
    const f = faturasAbertas(c.movimentos, opcoes);
    if (f.atraso_30 > 0) {
      const maisVelha = f.faturas.reduce((a, x) => (x.dias_vencida > a ? x.dias_vencida : a), 0);
      bloquear.push({ id: c.id, codigo: c.codigo, nome: c.nome, valor: f.atraso_30, dias: maisVelha });
    }
  }

  bloquear.sort((a, b) => b.dias - a.dias || b.valor - a.valor);
  return res.json({
    quantidade: bloquear.length,
    total: Math.round(bloquear.reduce((a, c) => a + c.valor, 0) * 100) / 100,
    clientes: bloquear,
  });
}

// Apagar o caderno inteiro e recomeçar do zero.
//
// O dono pediu porque o histórico veio do PDV e ele não consegue trabalhar
// assim. É decisão dele e é legítima — mas é sem volta, então a função foi
// escrita para ser difícil de disparar por engano:
//
//  - Só o Master alcança a rota.
//  - Exige a palavra LIMPAR no corpo. Botão errado não apaga nada; só apaga
//    quem digitou de propósito.
//  - Apaga os LANÇAMENTOS e não os clientes: o cadastro custou a existir, e
//    recriá-lo à mão seria trabalho sem motivo.
//  - Devolve quanto apagou e deixa registro na auditoria, com o total que havia.
//
// O que ela não faz é backup. Isso fica dito na tela, em vermelho, porque é a
// única rede que existe depois daqui.
async function limparCaderno(req, res) {
  if (String(req.body.confirmacao || '').trim().toUpperCase() !== 'LIMPAR') {
    return res.status(400).json({
      error: 'Para apagar o caderno, escreva LIMPAR no campo de confirmação.',
    });
  }

  const { rows: antes } = await pool.query(
    `SELECT count(*)::int AS movimentos,
            COALESCE(sum(valor) FILTER (WHERE tipo = 'compra'), 0) AS compras,
            COALESCE(sum(valor) FILTER (WHERE tipo = 'pagamento'), 0) AS pagamentos
       FROM mov_prazo`
  );

  const { rowCount } = await pool.query('DELETE FROM mov_prazo');

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'limpar-caderno',
    entidade: 'mov_prazo',
    dados: {
      movimentos_apagados: rowCount,
      compras: Number(antes[0].compras),
      pagamentos: Number(antes[0].pagamentos),
    },
  });

  return res.json({
    apagados: rowCount,
    compras: Number(antes[0].compras),
    pagamentos: Number(antes[0].pagamentos),
  });
}

async function salvarConfigPrazo(req, res) {
  const limpo = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 28 ? n : null;
  };
  const corte = limpo(req.body.dia_corte);
  const vencimento = limpo(req.body.dia_vencimento);
  if (corte === null || vencimento === null) {
    return res.status(400).json({ error: 'Dia de corte e de vencimento: use números de 1 a 28.' });
  }

  for (const [chave, valor] of [['prazo_dia_corte', corte], ['prazo_dia_vencimento', vencimento]]) {
    await pool.query(
      `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES ($1, $2, now())
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [chave, String(valor)]
    );
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'update',
    entidade: 'prazo_config',
    dados: { dia_corte: corte, dia_vencimento: vencimento },
  });

  return res.json(await lerConfigPrazo());
}

async function extratoCliente(req, res) {
  const { id } = req.params;

  const { rows: clienteRows } = await pool.query(`${SALDO_POR_CLIENTE} HAVING c.id = $1`, [id]);
  if (!clienteRows[0]) {
    return res.status(404).json({ error: 'Cliente não encontrado.' });
  }

  // DATE vira texto aqui: devolver o objeto Date faz o dia voltar um quando o
  // servidor está em UTC e a loja, em São Paulo.
  const { rows: movimentos } = await pool.query(
    `SELECT id, cliente_id, tipo::text AS tipo, valor,
            to_char(data, 'YYYY-MM-DD') AS data, observacoes, forma_pagamento
       FROM mov_prazo WHERE cliente_id = $1 ORDER BY data, id`,
    [id]
  );

  const cliente = clienteRows[0];
  return res.json({
    ...cliente,
    total_compras: Number(cliente.total_compras),
    total_pago: Number(cliente.total_pago),
    saldo: Number(cliente.saldo),
    movimentos,
  });
}

async function criarMovimento(req, res) {
  const { cliente_id, tipo, valor, data, observacoes } = req.body;
  // Como o cliente pagou. Só faz sentido no pagamento: a compra fiada é, por
  // definição, a que ainda não foi paga por forma nenhuma.
  const forma = tipo === 'pagamento' ? String(req.body.forma_pagamento || '').trim() || null : null;

  if (!cliente_id || valor === undefined || !data) {
    return res.status(400).json({ error: 'cliente_id, valor e data são obrigatórios.' });
  }
  if (Number(valor) < 0) {
    return res.status(400).json({ error: 'valor não pode ser negativo.' });
  }
  if (tipo && !['compra', 'pagamento'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo inválido. Use compra ou pagamento.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO mov_prazo (cliente_id, tipo, valor, data, observacoes, forma_pagamento, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, cliente_id, tipo::text AS tipo, valor,
               to_char(data, 'YYYY-MM-DD') AS data, observacoes, forma_pagamento`,
    [cliente_id, tipo || 'compra', valor, data, observacoes || null, forma, req.user.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'mov_prazo',
    entidadeId: rows[0].id,
    dados: rows[0],
  });

  return res.status(201).json(rows[0]);
}

async function deletarMovimento(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('DELETE FROM mov_prazo WHERE id = $1 RETURNING id', [id]);

  if (!rows[0]) {
    return res.status(404).json({ error: 'Movimento não encontrado.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'mov_prazo',
    entidadeId: Number(id),
  });

  return res.status(204).send();
}

module.exports = {
  salvarConfigPrazo,
  limparCaderno,
  alertas, resumo, extratoCliente, criarMovimento, deletarMovimento };
