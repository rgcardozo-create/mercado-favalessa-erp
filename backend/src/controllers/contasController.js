const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { SELECT_CONTAS_COM_SALDO, SEM_ACENTO, HOJE_SP, TIPOS_VALIDOS } = require('../db/contasQuery');

// Duas contas iguais no fornecedor, na descrição, no vencimento E no valor são,
// na prática, o mesmo boleto lançado duas vezes. Repetir fornecedor e descrição é
// normal (é o mesmo fornecedor todo mês); repetir também data e valor não é.
// Parcelas diferem no vencimento, e dois boletos do mesmo dia diferem no valor.
async function contaDuplicada({ tipo, fornecedorId, descricao, valor, vencimento, ignorarId = null }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.descricao, c.valor, c.tipo, f.nome AS fornecedor_nome,
            to_char(c.vencimento, 'YYYY-MM-DD') AS vencimento,
            to_char(c.vencimento, 'DD/MM/YYYY') AS vencimento_br
       FROM contas c
       LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.tipo = $1
        AND c.fornecedor_id IS NOT DISTINCT FROM $2
        AND ${SEM_ACENTO('btrim(c.descricao)')} = ${SEM_ACENTO('btrim($3)')}
        AND c.valor = $4
        AND c.vencimento = $5
        AND ($6::bigint IS NULL OR c.id <> $6)
      ORDER BY c.id
      LIMIT 1`,
    [tipo, fornecedorId, descricao, valor, vencimento, ignorarId]
  );
  return rows[0] || null;
}

function respostaDuplicada(res, existente) {
  const dia = existente.vencimento_br;
  const quem = existente.fornecedor_nome ? `${existente.fornecedor_nome} — ` : '';
  return res.status(409).json({
    error:
      `Já existe um lançamento igual: ${quem}${existente.descricao}, vencimento ${dia}, ` +
      `valor R$ ${Number(existente.valor).toFixed(2).replace('.', ',')}. ` +
      'Se for mesmo outra conta, confirme para cadastrar assim mesmo.',
    duplicada: existente,
  });
}

// Recorte por mês. A data que importa muda com o estado da conta: quitada
// interessa por quando foi paga ("o que paguei em agosto"), pendente interessa
// por quando vence. Sem isso, a lista de quitadas cresce para sempre.
const MES_REF = `CASE WHEN t.quitado THEN t.ultimo_pagamento::date ELSE t.vencimento END`;
const MESES = {
  atual: `date_trunc('month', ${MES_REF}) = date_trunc('month', ${HOJE_SP})`,
  anterior: `date_trunc('month', ${MES_REF}) = date_trunc('month', ${HOJE_SP}) - interval '1 month'`,
};

// Recortes por situação. `vencidas` é o padrão da tela: é o que precisa de ação
// hoje. `pendente` continua aceito porque é o nome antigo do mesmo recorte sem
// separar o que já venceu do que ainda vai vencer.
const STATUS = {
  pendente: 't.quitado = false',
  quitado: 't.quitado = true',
  vencidas: `t.quitado = false AND t.vencimento <= ${HOJE_SP}`,
  a_vencer: `t.quitado = false AND t.vencimento > ${HOJE_SP}`,
};

async function listar(req, res) {
  const { status, tipo, busca, mes } = req.query; // tipo: fornecedor|fixa|imposto|despesa
  const filtros = [];
  const params = [];

  if (STATUS[status]) filtros.push(STATUS[status]);

  if (tipo) {
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ error: `tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
    }
    params.push(tipo);
    filtros.push(`t.tipo = $${params.length}`);
  }

  // Busca livre: pega fornecedor, descrição e categoria de uma vez, sem ligar
  // para acento nem maiúscula — é como o usuário lembra do lançamento.
  const termo = (busca || '').trim();
  if (termo) {
    // `%` e `_` digitados são texto, não curinga — quem busca "100%" quer 100%.
    params.push(`%${termo.replace(/([\\%_])/g, '\\$1')}%`);
    const alvo = `coalesce(t.fornecedor_nome, '') || ' ' || t.descricao || ' ' || coalesce(t.categoria, '')`;
    filtros.push(`${SEM_ACENTO(alvo)} LIKE ${SEM_ACENTO(`$${params.length}`)} ESCAPE '\\'`);
  }

  // `mes` só escolhe uma expressão de uma lista fixa; valor desconhecido vira
  // "todos", que é não filtrar.
  if (MESES[mes]) filtros.push(MESES[mes]);

  const where = filtros.length ? ` WHERE ${filtros.join(' AND ')}` : '';
  const query = `SELECT * FROM (${SELECT_CONTAS_COM_SALDO}) t${where} ORDER BY t.vencimento`;

  const { rows } = await pool.query(query, params);
  return res.json(rows);
}

async function obter(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(`${SELECT_CONTAS_COM_SALDO} WHERE c.id = $1`, [id]);
  if (!rows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  const { rows: pagamentos } = await pool.query(
    `SELECT p.*, b.nome AS banco_nome
       FROM contas_pagamentos p
       LEFT JOIN bancos b ON b.id = p.banco_id
      WHERE p.conta_id = $1
      ORDER BY p.data_pagamento`,
    [id]
  );

  return res.json({ ...rows[0], pagamentos });
}

async function criar(req, res) {
  const { fornecedor_id, descricao, valor, vencimento, categoria, forma_prevista } = req.body;
  const tipo = req.body.tipo || 'fornecedor';

  if (!descricao || valor === undefined || !vencimento) {
    return res.status(400).json({ error: 'descricao, valor e vencimento são obrigatórios.' });
  }
  if (Number(valor) < 0) {
    return res.status(400).json({ error: 'valor não pode ser negativo.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
  }

  // Fornecedor só faz sentido em conta do tipo fornecedor.
  const fornecedorId = tipo === 'fornecedor' ? fornecedor_id || null : null;

  if (!req.body.permitir_duplicado) {
    const existente = await contaDuplicada({ tipo, fornecedorId, descricao, valor, vencimento });
    if (existente) return respostaDuplicada(res, existente);
  }

  const { rows } = await pool.query(
    `INSERT INTO contas (tipo, categoria, fornecedor_id, descricao, valor, vencimento, forma_prevista, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [tipo, categoria || null, fornecedorId, descricao, valor, vencimento, forma_prevista || null, req.user.id]
  );
  const conta = rows[0];

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'contas',
    entidadeId: conta.id,
    dados: conta,
  });

  return res.status(201).json(conta);
}

async function atualizar(req, res) {
  const { id } = req.params;
  const { fornecedor_id, descricao, valor, vencimento, categoria, forma_prevista } = req.body;

  // Editar também pode criar duplicata (mudar o valor para bater com outro
  // lançamento do mesmo dia, por exemplo), então a mesma checagem vale aqui.
  if (!req.body.permitir_duplicado) {
    const { rows: atuais } = await pool.query('SELECT * FROM contas WHERE id = $1', [id]);
    if (!atuais[0]) return res.status(404).json({ error: 'Conta não encontrada.' });
    const atual = atuais[0];
    const existente = await contaDuplicada({
      tipo: atual.tipo,
      fornecedorId: fornecedor_id === undefined ? atual.fornecedor_id : fornecedor_id || null,
      descricao: descricao ?? atual.descricao,
      valor: valor ?? atual.valor,
      vencimento: vencimento ?? atual.vencimento,
      ignorarId: atual.id,
    });
    if (existente) return respostaDuplicada(res, existente);
  }

  // `tipo` não é editável: mudar o tipo de uma conta já lançada bagunçaria o
  // histórico e os totais por tela. Para trocar, exclua e lance de novo.
  const { rows } = await pool.query(
    `UPDATE contas
     SET fornecedor_id = COALESCE($1, fornecedor_id),
         descricao = COALESCE($2, descricao),
         valor = COALESCE($3, valor),
         vencimento = COALESCE($4, vencimento),
         categoria = COALESCE($5, categoria),
         forma_prevista = COALESCE($6, forma_prevista),
         atualizado_em = now()
     WHERE id = $7
     RETURNING *`,
    [fornecedor_id, descricao, valor, vencimento, categoria, forma_prevista || null, id]
  );

  if (!rows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'update',
    entidade: 'contas',
    entidadeId: rows[0].id,
    dados: rows[0],
  });

  return res.json(rows[0]);
}

async function deletar(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('DELETE FROM contas WHERE id = $1 RETURNING id', [id]);

  if (!rows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'contas',
    entidadeId: Number(id),
  });

  return res.status(204).send();
}

async function registrarPagamento(req, res) {
  const { id } = req.params;
  const { valor, data_pagamento, forma_pagamento, banco_id } = req.body;

  if (!valor || Number(valor) <= 0 || !data_pagamento) {
    return res.status(400).json({ error: 'valor (maior que zero) e data_pagamento são obrigatórios.' });
  }

  const { rows: contaRows } = await pool.query('SELECT id FROM contas WHERE id = $1', [id]);
  if (!contaRows[0]) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }

  // Banco é opcional — dinheiro do caixa não sai de banco nenhum —, mas quando
  // vem tem que existir, senão a baixa guardaria uma referência solta.
  const bancoId = banco_id ? Number(banco_id) : null;
  if (bancoId) {
    const { rows: banco } = await pool.query('SELECT id FROM bancos WHERE id = $1', [bancoId]);
    if (!banco[0]) return res.status(400).json({ error: 'Banco não encontrado.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO contas_pagamentos (conta_id, valor, data_pagamento, forma_pagamento, banco_id, pago_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, valor, data_pagamento, forma_pagamento || null, bancoId, req.user.id]
  );
  const pagamento = rows[0];

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'pagamento',
    entidade: 'contas',
    entidadeId: Number(id),
    dados: pagamento,
  });

  return res.status(201).json(pagamento);
}

// Baixa registrada errada (data trocada, valor digitado a mais) tem que poder ser
// corrigida — sem isso o único jeito seria apagar a conta e lançar tudo de novo.
async function atualizarPagamento(req, res) {
  const { id, pagamentoId } = req.params;
  const { valor, data_pagamento, forma_pagamento, banco_id } = req.body;

  if (valor !== undefined && Number(valor) <= 0) {
    return res.status(400).json({ error: 'valor precisa ser maior que zero.' });
  }

  const bancoId = banco_id ? Number(banco_id) : null;
  if (bancoId) {
    const { rows: banco } = await pool.query('SELECT id FROM bancos WHERE id = $1', [bancoId]);
    if (!banco[0]) return res.status(400).json({ error: 'Banco não encontrado.' });
  }

  // `banco_id` e `forma_pagamento` são apagáveis (voltar para "sem banco"), então
  // vão direto em vez de COALESCE — o que não veio no corpo é que fica como está.
  const { rows } = await pool.query(
    `UPDATE contas_pagamentos
        SET valor = COALESCE($1, valor),
            data_pagamento = COALESCE($2, data_pagamento),
            forma_pagamento = $3,
            banco_id = $4
      WHERE id = $5 AND conta_id = $6
      RETURNING *`,
    [
      valor === undefined ? null : valor,
      data_pagamento || null,
      forma_pagamento || null,
      bancoId,
      pagamentoId,
      id,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Pagamento não encontrado nesta conta.' });

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'pagamento-editado',
    entidade: 'contas',
    entidadeId: Number(id),
    dados: rows[0],
  });

  return res.json(rows[0]);
}

async function excluirPagamento(req, res) {
  const { id, pagamentoId } = req.params;

  const { rows } = await pool.query(
    'DELETE FROM contas_pagamentos WHERE id = $1 AND conta_id = $2 RETURNING *',
    [pagamentoId, id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Pagamento não encontrado nesta conta.' });

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'pagamento-excluido',
    entidade: 'contas',
    entidadeId: Number(id),
    dados: rows[0],
  });

  return res.status(204).send();
}

module.exports = {
  listar,
  obter,
  criar,
  atualizar,
  deletar,
  registrarPagamento,
  atualizarPagamento,
  excluirPagamento,
};
