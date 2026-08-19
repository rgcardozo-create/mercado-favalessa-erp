const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { HOJE_SP } = require('../db/contasQuery');

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
    faltando: r.faltando,
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

module.exports = { listar, criar, deletar, resumoVendas };
