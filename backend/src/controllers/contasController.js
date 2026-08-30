const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { SELECT_CONTAS_COM_SALDO, SEM_ACENTO, HOJE_SP, TIPOS_VALIDOS } = require('../db/contasQuery');

// O mesmo boleto lançado duas vezes é: mesmo fornecedor, mesmo valor, mesmo
// vencimento. A descrição fica de fora — é texto livre, muda a cada digitação
// ("ADILSON", "adilson 2", "boleto adilson"), e enquanto ela contava bastava
// escrever diferente para o mesmo boleto entrar de novo sem aviso.
//
// Repetir fornecedor é normal (é o mesmo todo mês) e repetir valor também;
// parcelas diferem no vencimento e dois boletos do mesmo dia diferem no valor.
// Os três juntos é que não acontecem por acaso.
//
// Sem fornecedor (despesa fixa, imposto, custo operacional, outras), a descrição
// é o que identifica o lançamento e volta a contar: sem ela, dois impostos
// diferentes de mesmo valor no mesmo dia seriam tratados como o mesmo.
async function contaDuplicada({ tipo, fornecedorId, descricao, valor, vencimento, ignorarId = null }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.descricao, c.valor, c.tipo, f.nome AS fornecedor_nome,
            to_char(c.vencimento, 'YYYY-MM-DD') AS vencimento,
            to_char(c.vencimento, 'DD/MM/YYYY') AS vencimento_br
       FROM contas c
       LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.tipo = $1
        AND c.fornecedor_id IS NOT DISTINCT FROM $2
        AND c.valor = $4
        AND c.vencimento = $5
        AND ($6 OR ${SEM_ACENTO('btrim(c.descricao)')} = ${SEM_ACENTO('btrim($3)')})
        AND ($7::bigint IS NULL OR c.id <> $7)
      ORDER BY c.id
      LIMIT 1`,
    [tipo, fornecedorId, descricao, valor, vencimento, Boolean(fornecedorId), ignorarId]
  );
  return rows[0] || null;
}

function respostaDuplicada(res, existente) {
  const dia = existente.vencimento_br;
  const quem = existente.fornecedor_nome ? `${existente.fornecedor_nome} — ` : '';
  return res.status(409).json({
    error:
      `Já existe um lançamento com ${
        existente.fornecedor_nome ? 'o mesmo fornecedor' : 'a mesma descrição'
      }, valor e vencimento: ${quem}${existente.descricao}, vencimento ${dia}, ` +
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

// Parcelamento: um boleto em 3x é lançado uma vez e vira três contas, cada uma
// com seu vencimento. O intervalo é em dias, menos "mensal", que anda de mês em
// mês mantendo o dia — quem paga todo dia 10 espera 10/09, não 09/09 (que é o
// que dariam 30 dias corridos). Mês curto encosta no último dia (31/01 -> 28/02).
// O intervalo é 'mensal' ou um número de dias digitado. Aceitar qualquer número
// em vez de uma lista fechada porque boleto não segue calendário redondo: vem de
// 2, 4, 9, 93 dias, e uma lista de opções sempre deixaria de fora justo o que
// está na mão da pessoa.
const MAX_INTERVALO_DIAS = 365;
const MAX_PARCELAS = 60;

function normalizarIntervalo(valor) {
  const texto = String(valor ?? 'mensal').trim();
  if (texto === '' || texto === 'mensal') return 'mensal';
  const dias = Number(texto);
  if (!Number.isInteger(dias) || dias < 1 || dias > MAX_INTERVALO_DIAS) return null;
  return String(dias);
}

async function datasDasParcelas({ vencimento, parcelas, intervalo }) {
  const sql =
    intervalo === 'mensal'
      ? `SELECT to_char(($1::date + (g.i || ' month')::interval)::date, 'YYYY-MM-DD') AS d
           FROM generate_series(0, $2::int - 1) g(i) ORDER BY g.i`
      : `SELECT to_char($1::date + (g.i * $3::int), 'YYYY-MM-DD') AS d
           FROM generate_series(0, $2::int - 1) g(i) ORDER BY g.i`;

  const params = intervalo === 'mensal' ? [vencimento, parcelas] : [vencimento, parcelas, Number(intervalo)];
  const { rows } = await pool.query(sql, params);
  return rows.map((r) => r.d);
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

  // Fornecedor só faz sentido em conta de fornecedor — e a Ceasa é isso também:
  // os nomes de lá estão no mesmo cadastro, marcados como da Ceasa.
  const fornecedorId = tipo === 'fornecedor' || tipo === 'ceasa' ? fornecedor_id || null : null;

  // Compra da Ceasa é paga por PIX no ato: não existe "a pagar", existe "já
  // paguei, registra". Lançar e depois dar baixa seriam dois passos para um
  // pagamento só, e o passo esquecido deixaria a conta pendente para sempre.
  const jaPago = req.body.pago === true;

  const parcelas = Math.trunc(Number(req.body.parcelas) || 1);
  if (!Number.isFinite(parcelas) || parcelas < 1 || parcelas > MAX_PARCELAS) {
    return res.status(400).json({ error: `parcelas precisa ser um número entre 1 e ${MAX_PARCELAS}.` });
  }
  if (jaPago && parcelas > 1) {
    return res.status(400).json({
      error: 'Lançamento já pago é de uma parcela só. Para parcelar, cadastre e dê baixa em cada parcela.',
    });
  }
  const intervalo = normalizarIntervalo(req.body.intervalo);
  if (intervalo === null) {
    return res.status(400).json({
      error: `O intervalo entre parcelas precisa ser "mensal" ou um número de 1 a ${MAX_INTERVALO_DIAS} dias.`,
    });
  }

  const datas = await datasDasParcelas({ vencimento, parcelas, intervalo });

  if (!req.body.permitir_duplicado) {
    for (const data of datas) {
      const existente = await contaDuplicada({ tipo, fornecedorId, descricao, valor, vencimento: data });
      if (existente) return respostaDuplicada(res, existente);
    }
  }

  // Todas as parcelas nascem juntas ou nenhuma nasce: metade de um carnê lançado
  // é pior do que nada, porque some no meio da lista sem ninguém perceber.
  const cliente = await pool.connect();
  let criadas;
  try {
    await cliente.query('BEGIN');
    const inseridas = [];
    for (let i = 0; i < datas.length; i += 1) {
      const { rows } = await cliente.query(
        `INSERT INTO contas
           (tipo, categoria, fornecedor_id, descricao, valor, vencimento, forma_prevista,
            parcela, total_parcelas, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          tipo,
          categoria || null,
          fornecedorId,
          descricao,
          valor,
          datas[i],
          forma_prevista || null,
          parcelas > 1 ? i + 1 : null,
          parcelas > 1 ? parcelas : null,
          req.user.id,
        ]
      );
      inseridas.push(rows[0]);

      // A baixa entra na mesma transação: conta marcada como paga que nasce sem
      // o pagamento seria uma conta pendente que ninguém mais procura.
      if (jaPago) {
        await cliente.query(
          `INSERT INTO contas_pagamentos
             (conta_id, valor, data_pagamento, forma_pagamento, banco_id, pago_por)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            rows[0].id,
            valor,
            req.body.data_pagamento || datas[i],
            req.body.forma_pagamento || forma_prevista || null,
            req.body.banco_id || null,
            req.user.id,
          ]
        );
      }
    }
    await cliente.query('COMMIT');
    criadas = inseridas;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  for (const conta of criadas) {
    await registrarAuditoria({
      usuarioId: req.user.id,
      acao: 'create',
      entidade: 'contas',
      entidadeId: conta.id,
      dados: conta,
    });
  }

  return res.status(201).json({ ...criadas[0], parcelas_criadas: criadas.length, contas: criadas });
}

// Reclassificar em lote. A conta lançada como fornecedor que na verdade é da
// Ceasa (ou imposto, ou custo operacional) já existe às centenas — refazer uma a
// uma seria trabalho de dias, e enquanto isso os totais por tipo continuariam
// mentindo.
async function mover(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
  const tipo = req.body.tipo;

  if (!ids || !ids.length) {
    return res.status(400).json({ error: 'Selecione ao menos um lançamento.' });
  }
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'Lista de lançamentos inválida.' });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: 'Máximo de 500 lançamentos por vez.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.` });
  }

  const cliente = await pool.connect();
  let movidas = [];
  let fornecedoresMarcados = 0;
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query(
      `UPDATE contas SET tipo = $2, atualizado_em = now()
        WHERE id = ANY($1::int[]) AND tipo IS DISTINCT FROM $2::conta_tipo
        RETURNING id, fornecedor_id, descricao`,
      [ids, tipo]
    );
    movidas = rows;

    // Mandar a conta para a Ceasa sem marcar o fornecedor deixaria o nome fora
    // da lista da aba — e editar a conta depois não acharia o próprio
    // fornecedor dela. Quem manda a conta para lá está dizendo que o fornecedor
    // é de lá.
    const fornecedores = [...new Set(movidas.map((c) => c.fornecedor_id).filter(Boolean))];
    if (fornecedores.length) {
      if (tipo === 'ceasa') {
        const { rowCount } = await cliente.query(
          'UPDATE fornecedores SET ceasa = true WHERE id = ANY($1::int[]) AND ceasa = false',
          [fornecedores]
        );
        fornecedoresMarcados = rowCount;
      } else {
        // Tirando a conta da Ceasa, o fornecedor volta para a lista de
        // fornecedores — a menos que ainda tenha outra conta lá. Sem isso, um
        // engano ao mover deixaria o nome preso na aba errada, sem jeito de
        // voltar pela tela.
        const { rowCount } = await cliente.query(
          `UPDATE fornecedores SET ceasa = false
            WHERE id = ANY($1::int[]) AND ceasa = true
              AND NOT EXISTS (SELECT 1 FROM contas c WHERE c.fornecedor_id = fornecedores.id AND c.tipo = 'ceasa')`,
          [fornecedores]
        );
        fornecedoresMarcados = -rowCount;
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
    acao: 'mover',
    entidade: 'contas',
    entidadeId: 0,
    dados: { tipo, ids: movidas.map((c) => c.id), fornecedores_marcados: fornecedoresMarcados },
  });

  return res.json({
    movidas: movidas.length,
    ignoradas: ids.length - movidas.length,
    tipo,
    fornecedores_marcados: fornecedoresMarcados,
  });
}

// Marca de atenção: um clique na lista, sem abrir formulário. É um campo só, e
// a graça está em marcar rápido enquanto se olha a lista — abrir a conta inteira
// para trocar um sim/não faria ninguém usar.
async function marcarAtencao(req, res) {
  const { id } = req.params;
  const atencao = req.body.atencao !== false;

  const { rows } = await pool.query(
    'UPDATE contas SET atencao = $2, atualizado_em = now() WHERE id = $1 RETURNING id, descricao, atencao',
    [id, atencao]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Conta não encontrada.' });

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: atencao ? 'atencao' : 'atencao-off',
    entidade: 'contas',
    entidadeId: Number(id),
    dados: rows[0],
  });

  return res.json(rows[0]);
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
  //
  // A forma prevista não usa COALESCE: ela precisa poder voltar a ser vazia, e
  // com COALESCE mandar vazio significaria "não mexe" — não havia como desfazer
  // uma escolha errada. O critério é a presença do campo no corpo.
  const mexeuNaForma = Object.prototype.hasOwnProperty.call(req.body, 'forma_prevista');

  const { rows } = await pool.query(
    `UPDATE contas
     SET fornecedor_id = COALESCE($1, fornecedor_id),
         descricao = COALESCE($2, descricao),
         valor = COALESCE($3, valor),
         vencimento = COALESCE($4, vencimento),
         categoria = COALESCE($5, categoria),
         forma_prevista = CASE WHEN $6 THEN $7 ELSE forma_prevista END,
         atualizado_em = now()
     WHERE id = $8
     RETURNING *`,
    [fornecedor_id, descricao, valor, vencimento, categoria, mexeuNaForma, forma_prevista || null, id]
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
  const { valor, data_pagamento, forma_pagamento, banco_id, observacoes } = req.body;

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

  // A observação é o porquê do pagamento, e o porquê some da memória em uma
  // semana: "reembolso ao Jorge, que pagou este boleto porque o cartão não passou"
  // é o tipo de coisa que ninguém reconstrói olhando só valor e data.
  const { rows } = await pool.query(
    `INSERT INTO contas_pagamentos
       (conta_id, valor, data_pagamento, forma_pagamento, banco_id, observacoes, pago_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, valor, data_pagamento, forma_pagamento || null, bancoId, observacoes || null, req.user.id]
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
  const { valor, data_pagamento, forma_pagamento, banco_id, observacoes } = req.body;

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
            banco_id = $4,
            observacoes = $5
      WHERE id = $6 AND conta_id = $7
      RETURNING *`,
    [
      valor === undefined ? null : valor,
      data_pagamento || null,
      forma_pagamento || null,
      bancoId,
      observacoes || null,
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
  mover,
  marcarAtencao,
  listar,
  obter,
  criar,
  atualizar,
  deletar,
  registrarPagamento,
  atualizarPagamento,
  excluirPagamento,
};
