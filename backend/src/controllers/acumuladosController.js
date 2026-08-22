const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { HOJE_SP } = require('../db/contasQuery');
const { GRUPO_FORMA, campoDoFechamento } = require('../db/conciliacaoQuery');

const CAMPOS_VALOR = ['dinheiro', 'cartao', 'pix', 'tickets', 'pos_sistema', 'pos_maquina', 'outras'];

// O total do dia é sempre derivado dos campos, nunca guardado — evita o total
// ficar defasado quando alguém corrige um dos valores.
function comTotal(linha) {
  const total = CAMPOS_VALOR.reduce((acc, campo) => acc + Number(linha[campo] || 0), 0);
  return { ...linha, total };
}

// Grava um dia mexendo só nas colunas que vieram no corpo; as ausentes ficam
// como estão. A tela de hoje não mostra POS sistema/máquina, e um dia importado
// do v3 que tem esses valores não pode perdê-los em silêncio só porque alguém
// corrigiu o dinheiro daquele dia.
function comandoUpsert(corpo, usuarioId) {
  const presente = (campo) => Object.prototype.hasOwnProperty.call(corpo, campo);
  const campos = CAMPOS_VALOR.filter(presente);
  const temObservacoes = presente('observacoes');

  const colunas = ['data', ...campos, ...(temObservacoes ? ['observacoes'] : []), 'criado_por'];
  const valores = [
    corpo.data,
    ...campos.map((campo) => Number(corpo[campo] || 0)),
    ...(temObservacoes ? [corpo.observacoes || null] : []),
    usuarioId,
  ];
  const atualizacoes = [
    ...campos.map((campo) => `${campo} = EXCLUDED.${campo}`),
    ...(temObservacoes ? ['observacoes = EXCLUDED.observacoes'] : []),
    'atualizado_em = now()',
  ];

  return {
    sql: `INSERT INTO acumulados (${colunas.join(', ')})
          VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')})
          ON CONFLICT (data) DO UPDATE SET ${atualizacoes.join(', ')}
          RETURNING *`,
    valores,
  };
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
  // A data volta como texto: a tela usa esse valor tanto para exibir quanto para
  // reabrir o dia em edição, e conversão para Date no meio do caminho já trocou
  // o dia de lugar em outros pontos do sistema.
  const { rows } = await pool.query(
    `SELECT id, to_char(data, 'YYYY-MM-DD') AS data, ${CAMPOS_VALOR.join(', ')},
            observacoes, criado_por, criado_em, atualizado_em
       FROM acumulados ${where} ORDER BY data DESC`,
    params
  );

  const acumulados = rows.map(comTotal);
  const totais = CAMPOS_VALOR.reduce((acc, campo) => {
    acc[campo] = acumulados.reduce((s, a) => s + Number(a[campo] || 0), 0);
    return acc;
  }, {});
  totais.total = acumulados.reduce((s, a) => s + a.total, 0);

  return res.json({ acumulados, totais });
}

// Resumo para responder "estou vendendo bem?" sem abrir planilha: quanto entrou
// hoje, como isso se compara com o mesmo dia da semana passada, com os 7 dias
// anteriores e com o mesmo pedaço do mês passado — e, principalmente, quais dias
// ficaram sem lançamento. O buraco na série é o que estraga qualquer comparação,
// então ele é informação de primeira classe aqui, não detalhe.
async function resumoVendas(req, res) {
  const TOTAL = CAMPOS_VALOR.map((c) => `COALESCE(a.${c}, 0)`).join(' + ');

  const sql = `
    WITH hoje AS (SELECT ${HOJE_SP} AS d),
    base AS (SELECT a.data, (${TOTAL}) AS total FROM acumulados a)
    SELECT
      to_char((SELECT d FROM hoje), 'YYYY-MM-DD') AS hoje,
      (SELECT total FROM base WHERE data = (SELECT d FROM hoje)) AS total_hoje,
      (SELECT total FROM base WHERE data = (SELECT d FROM hoje) - 1) AS total_ontem,
      (SELECT total FROM base WHERE data = (SELECT d FROM hoje) - 7) AS total_semana_passada,

      (SELECT COALESCE(sum(total), 0) FROM base
        WHERE data > (SELECT d FROM hoje) - 7 AND data <= (SELECT d FROM hoje)) AS ultimos_7,
      (SELECT COALESCE(sum(total), 0) FROM base
        WHERE data > (SELECT d FROM hoje) - 14 AND data <= (SELECT d FROM hoje) - 7) AS sete_anteriores,

      (SELECT COALESCE(sum(total), 0) FROM base
        WHERE data >= date_trunc('month', (SELECT d FROM hoje))::date
          AND data <= (SELECT d FROM hoje)) AS mes_atual,
      (SELECT COALESCE(sum(total), 0) FROM base
        WHERE data >= (date_trunc('month', (SELECT d FROM hoje)) - interval '1 month')::date
          AND data <= ((SELECT d FROM hoje) - interval '1 month')::date) AS mes_anterior,

      to_char((SELECT max(data) FROM base), 'YYYY-MM-DD') AS ultimo_lancamento,

      -- Série do mês para o gráfico, com os dias vazios explícitos.
      (SELECT COALESCE(json_agg(json_build_object(
                'data', to_char(g.dia, 'YYYY-MM-DD'),
                'total', COALESCE(b.total, 0),
                'lancado', b.data IS NOT NULL) ORDER BY g.dia), '[]'::json)
         FROM generate_series((SELECT d FROM hoje) - 29, (SELECT d FROM hoje), interval '1 day') g(dia)
         LEFT JOIN base b ON b.data = g.dia::date) AS ultimos_30,

      -- O mês corrente inteiro, do dia 1 ao último — inclusive os dias que ainda
      -- não chegaram. O gráfico do mês só faz sentido com o mês todo à vista:
      -- recorte de duas semanas esconde justamente a comparação com o começo do mês.
      (SELECT COALESCE(json_agg(json_build_object(
                'data', to_char(g.dia, 'YYYY-MM-DD'),
                'total', COALESCE(b.total, 0),
                'lancado', b.data IS NOT NULL,
                'futuro', g.dia > (SELECT d FROM hoje)
              ) ORDER BY g.dia), '[]'::json)
         FROM generate_series(
                date_trunc('month', (SELECT d FROM hoje))::date,
                (date_trunc('month', (SELECT d FROM hoje)) + interval '1 month - 1 day')::date,
                interval '1 day') g(dia)
         LEFT JOIN base b ON b.data = g.dia::date) AS dias_do_mes,

      -- Fechamento mês a mês, para a comparação que não cabe na série diária.
      -- dias_lancados vai junto porque mês pela metade não se compara com mês
      -- inteiro, e sem esse número o gráfico mentiria em silêncio.
      (SELECT COALESCE(json_agg(json_build_object(
                'mes', to_char(g.mes, 'YYYY-MM'),
                'total', COALESCE(m.total, 0),
                'dias_lancados', COALESCE(m.dias, 0),
                'dias_no_mes', EXTRACT(DAY FROM (g.mes + interval '1 month' - interval '1 day'))::int
              ) ORDER BY g.mes), '[]'::json)
         FROM generate_series(
                date_trunc('month', (SELECT d FROM hoje)) - interval '5 month',
                date_trunc('month', (SELECT d FROM hoje)),
                interval '1 month') g(mes)
         LEFT JOIN (
           SELECT date_trunc('month', data) AS mes, sum(total) AS total, count(*)::int AS dias
             FROM base GROUP BY 1
         ) m ON m.mes = g.mes) AS por_mes,

      -- Dias sem lançamento nas duas últimas semanas: é o que o sistema cobra.
      (SELECT COALESCE(json_agg(to_char(g.dia, 'YYYY-MM-DD') ORDER BY g.dia), '[]'::json)
         FROM generate_series((SELECT d FROM hoje) - 14, (SELECT d FROM hoje), interval '1 day') g(dia)
         LEFT JOIN base b ON b.data = g.dia::date
        WHERE b.data IS NULL) AS faltando
  `;

  const { rows } = await pool.query(sql);
  const r = rows[0];
  const num = (v) => (v === null || v === undefined ? null : Number(v));

  // Variação em % só faz sentido com base maior que zero; sem isso devolvemos
  // null e a tela mostra um traço em vez de "+Infinity%".
  const variacao = (atual, anterior) =>
    anterior && Number(anterior) > 0 ? ((Number(atual) - Number(anterior)) / Number(anterior)) * 100 : null;

  return res.json({
    hoje: r.hoje,
    lancado_hoje: r.total_hoje !== null,
    total_hoje: num(r.total_hoje),
    total_ontem: num(r.total_ontem),
    total_semana_passada: num(r.total_semana_passada),
    variacao_semana: variacao(r.total_hoje, r.total_semana_passada),
    ultimos_7: num(r.ultimos_7),
    sete_anteriores: num(r.sete_anteriores),
    variacao_7: variacao(r.ultimos_7, r.sete_anteriores),
    mes_atual: num(r.mes_atual),
    mes_anterior: num(r.mes_anterior),
    variacao_mes: variacao(r.mes_atual, r.mes_anterior),
    ultimo_lancamento: r.ultimo_lancamento,
    ultimos_30: r.ultimos_30,
    dias_do_mes: r.dias_do_mes,
    por_mes: r.por_mes,
    faltando: r.faltando,
  });
}

// O que a conciliação já sabe sobre um dia. Serve de sugestão para o fechamento:
// o extrato do adquirente conhece o cartão e o ticket, o PDV conhece o dinheiro.
//
// Sugestão, não gravação automática: o dia só está completo quando os três
// adquirentes foram importados, e quase nunca estão no mesmo momento. Preencher
// sozinho geraria um acumulado com metade da venda e cara de número fechado.
async function sugestaoDoDia(req, res) {
  const data = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : null;
  if (!data) return res.status(400).json({ error: 'Informe a data no formato AAAA-MM-DD.' });

  const { rows: porAdquirente } = await pool.query(
    `SELECT adquirente::text AS adquirente,
            count(*)::int AS transacoes,
            COALESCE(sum(valor_bruto), 0) AS bruto,
            COALESCE(sum(valor_liquido), 0) AS liquido
       FROM conciliacao_transacoes
      WHERE data = $1
      GROUP BY adquirente
      ORDER BY adquirente`,
    [data]
  );

  // Por forma, que é o que decide em qual campo do fechamento o valor entra.
  // Sem isso o PIX da maquininha — que vem dentro do arquivo da Cielo — cairia
  // no campo Cartão, e o fechamento nasceria errado todo dia.
  const { rows: porForma } = await pool.query(
    `SELECT t.adquirente::text AS adquirente,
            ${GRUPO_FORMA} AS grupo,
            count(*)::int AS transacoes,
            COALESCE(sum(t.valor_bruto), 0) AS bruto
       FROM conciliacao_transacoes t
      WHERE t.data = $1
      GROUP BY 1, 2
      ORDER BY bruto DESC`,
    [data]
  );

  const { rows: dinheiro } = await pool.query(
    `SELECT COALESCE(sum(valor), 0) AS total, count(*)::int AS lancamentos
       FROM conciliacao_dinheiro WHERE data = $1`,
    [data]
  );

  // Até que dia cada adquirente foi importado. É isso que explica um dia vazio:
  // quase sempre o arquivo daquele adquirente ainda não entrou.
  const { rows: ultimos } = await pool.query(
    `SELECT adquirente::text AS adquirente, to_char(max(data), 'YYYY-MM-DD') AS ate
       FROM conciliacao_transacoes GROUP BY adquirente ORDER BY adquirente`
  );

  const sugestao = { cartao: 0, pix: 0, tickets: 0, dinheiro: Number(dinheiro[0].total) };
  for (const linha of porForma) {
    sugestao[campoDoFechamento(linha.adquirente, linha.grupo)] += Number(linha.bruto);
  }

  return res.json({
    data,
    por_adquirente: porAdquirente.map((a) => ({ ...a, bruto: Number(a.bruto), liquido: Number(a.liquido) })),
    por_forma: porForma.map((f) => ({
      adquirente: f.adquirente,
      grupo: f.grupo,
      transacoes: f.transacoes,
      bruto: Number(f.bruto),
      campo: campoDoFechamento(f.adquirente, f.grupo),
    })),
    importado_ate: ultimos.reduce((acc, u) => ({ ...acc, [u.adquirente]: u.ate }), {}),
    sugestao,
    dinheiro_lancamentos: dinheiro[0].lancamentos,
  });
}

// Mesma sugestão, mas para um período inteiro: um extrato importado de uma vez
// vira dezenas de dias para fechar, e fechar um por um é o mesmo clique repetido
// vinte vezes. Aqui cada dia já vem com o que o extrato sabe; só falta o
// dinheiro, que o extrato nunca sabe.
async function sugestaoDoPeriodo(req, res) {
  const { de, ate } = req.query;
  const dataValida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  if (!dataValida(de) || !dataValida(ate)) {
    return res.status(400).json({ error: 'Informe de e ate no formato AAAA-MM-DD.' });
  }
  if (de > ate) {
    return res.status(400).json({ error: 'A data inicial precisa ser anterior à final.' });
  }

  // Limite de dois meses: acima disso a tela vira uma parede de campos, e
  // conferência que ninguém consegue ler não é conferência.
  const { rows: tamanho } = await pool.query(`SELECT ($2::date - $1::date) + 1 AS dias`, [de, ate]);
  if (Number(tamanho[0].dias) > 62) {
    return res.status(400).json({ error: 'Período muito longo: escolha no máximo 62 dias.' });
  }

  const { rows: transacoes } = await pool.query(
    `SELECT to_char(t.data, 'YYYY-MM-DD') AS data,
            t.adquirente::text AS adquirente,
            ${GRUPO_FORMA} AS grupo,
            count(*)::int AS transacoes,
            COALESCE(sum(t.valor_bruto), 0) AS bruto
       FROM conciliacao_transacoes t
      WHERE t.data BETWEEN $1 AND $2
      GROUP BY 1, 2, 3`,
    [de, ate]
  );

  const { rows: dinheiro } = await pool.query(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data, COALESCE(sum(valor), 0) AS total
       FROM conciliacao_dinheiro WHERE data BETWEEN $1 AND $2 GROUP BY 1`,
    [de, ate]
  );

  // O que já foi fechado: quem repete um período precisa saber o que vai ser
  // substituído antes de salvar, não depois.
  const { rows: existentes } = await pool.query(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data, ${CAMPOS_VALOR.join(', ')}
       FROM acumulados WHERE data BETWEEN $1 AND $2`,
    [de, ate]
  );

  const { rows: dias } = await pool.query(
    `SELECT to_char(g.dia, 'YYYY-MM-DD') AS data
       FROM generate_series($1::date, $2::date, interval '1 day') g(dia) ORDER BY g.dia`,
    [de, ate]
  );

  const lista = dias.map(({ data }) => {
    const doDia = transacoes.filter((t) => t.data === data);
    const sugestao = { cartao: 0, pix: 0, tickets: 0, dinheiro: 0 };
    for (const linha of doDia) {
      sugestao[campoDoFechamento(linha.adquirente, linha.grupo)] += Number(linha.bruto);
    }
    const emDinheiro = dinheiro.find((d) => d.data === data);
    sugestao.dinheiro = emDinheiro ? Number(emDinheiro.total) : 0;

    const jaLancado = existentes.find((e) => e.data === data);

    return {
      data,
      transacoes: doDia.reduce((a, t) => a + t.transacoes, 0),
      sugestao,
      lancado: jaLancado
        ? CAMPOS_VALOR.reduce((acc, campo) => ({ ...acc, [campo]: Number(jaLancado[campo]) }), {})
        : null,
    };
  });

  return res.json({ de, ate, dias: lista });
}

// Salva o período inteiro de uma vez. Tudo numa transação: um lote gravado pela
// metade deixaria dias fechados e dias não, sem ninguém saber quais.
async function salvarLote(req, res) {
  const dias = Array.isArray(req.body.dias) ? req.body.dias : null;
  if (!dias || !dias.length) {
    return res.status(400).json({ error: 'Envie a lista de dias a salvar.' });
  }
  if (dias.length > 62) {
    return res.status(400).json({ error: 'Máximo de 62 dias por vez.' });
  }

  for (const dia of dias) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia.data || '')) {
      return res.status(400).json({ error: `Data inválida no lote: ${dia.data}` });
    }
    if (CAMPOS_VALOR.some((c) => !Number.isFinite(Number(dia[c] || 0)))) {
      return res.status(400).json({ error: `Valor não numérico no dia ${dia.data}.` });
    }
  }

  const cliente = await pool.connect();
  const salvos = [];
  try {
    await cliente.query('BEGIN');
    for (const dia of dias) {
      const { sql, valores } = comandoUpsert(dia, req.user.id);
      const { rows } = await cliente.query(sql, valores);
      salvos.push(rows[0]);
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
    acao: 'lote',
    entidade: 'acumulados',
    entidadeId: 0,
    dados: { dias: salvos.map((a) => String(a.data).slice(0, 10)) },
  });

  return res.status(201).json({ salvos: salvos.length, dias: salvos.map(comTotal) });
}

async function criar(req, res) {
  const { data } = req.body;
  if (!data) {
    return res.status(400).json({ error: 'data é obrigatória.' });
  }

  if (CAMPOS_VALOR.some((campo) => !Number.isFinite(Number(req.body[campo] || 0)))) {
    return res.status(400).json({ error: 'Todos os valores precisam ser numéricos.' });
  }

  // Um acumulado por dia: relançar a mesma data corrige a conferência daquele dia.
  // É por aqui que passa também a edição de um fechamento já salvo — o dinheiro
  // que o cliente da venda a prazo paga em mãos dias depois não vem de PDV nenhum.
  const { sql, valores } = comandoUpsert(req.body, req.user.id);
  const { rows } = await pool.query(sql, valores);
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

// Excluir dia a dia é aceitável para um engano; para um mês inteiro lançado
// errado, não. Uma instrução só, portanto atômica por construção.
async function excluirLote(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
  if (!ids || !ids.length) {
    return res.status(400).json({ error: 'Selecione ao menos um fechamento.' });
  }
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'Lista de fechamentos inválida.' });
  }
  if (ids.length > 200) {
    return res.status(400).json({ error: 'Máximo de 200 fechamentos por vez.' });
  }

  const { rows } = await pool.query(
    `DELETE FROM acumulados WHERE id = ANY($1::int[])
     RETURNING id, to_char(data, 'YYYY-MM-DD') AS data`,
    [ids]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete-lote',
    entidade: 'acumulados',
    entidadeId: 0,
    dados: { dias: rows.map((r) => r.data) },
  });

  return res.json({ excluidos: rows.length, dias: rows.map((r) => r.data) });
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

module.exports = {
  listar,
  criar,
  deletar,
  excluirLote,
  resumoVendas,
  sugestaoDoDia,
  sugestaoDoPeriodo,
  salvarLote,
};
