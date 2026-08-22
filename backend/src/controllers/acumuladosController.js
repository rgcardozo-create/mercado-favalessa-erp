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

module.exports = { listar, criar, deletar, resumoVendas, sugestaoDoDia };
