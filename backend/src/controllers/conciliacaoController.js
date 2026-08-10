const pool = require('../db/pool');

const ADQUIRENTES = ['cielo', 'stone', 'itau', 'tickets'];

const ROTULOS = {
  cielo: 'Cielo',
  stone: 'Stone',
  itau: 'Itaú',
  tickets: 'Tickets / Rede Compras',
};

// Período padrão quando o usuário não informa: mês corrente no fuso da loja.
function periodoDaQuery(query) {
  const { de, ate } = query;
  return {
    de: de || null,
    ate: ate || null,
  };
}

function filtroPeriodo(de, ate, params, coluna = 'data') {
  const partes = [];
  if (de) {
    params.push(de);
    partes.push(`${coluna} >= $${params.length}`);
  }
  if (ate) {
    params.push(ate);
    partes.push(`${coluna} <= $${params.length}`);
  }
  return partes;
}

// Resumo por adquirente no período + total de dinheiro conferido por PDV.
async function resumo(req, res) {
  const { de, ate } = periodoDaQuery(req.query);

  const paramsCartao = [];
  const condicoesCartao = filtroPeriodo(de, ate, paramsCartao);
  const whereCartao = condicoesCartao.length ? `WHERE ${condicoesCartao.join(' AND ')}` : '';

  const { rows: porAdquirente } = await pool.query(
    `SELECT adquirente,
            count(*)::int AS transacoes,
            COALESCE(sum(valor_bruto), 0) AS bruto,
            COALESCE(sum(tarifa), 0) AS tarifa,
            COALESCE(sum(valor_liquido), 0) AS liquido,
            min(data) AS primeira_data,
            max(data) AS ultima_data
       FROM conciliacao_transacoes
       ${whereCartao}
      GROUP BY adquirente`,
    paramsCartao
  );

  const paramsDinheiro = [];
  const condicoesDinheiro = filtroPeriodo(de, ate, paramsDinheiro);
  const whereDinheiro = condicoesDinheiro.length ? `WHERE ${condicoesDinheiro.join(' AND ')}` : '';

  const { rows: dinheiroRows } = await pool.query(
    `SELECT pdv, count(*)::int AS lancamentos, COALESCE(sum(valor), 0) AS total
       FROM conciliacao_dinheiro
       ${whereDinheiro}
      GROUP BY pdv
      ORDER BY pdv`,
    paramsDinheiro
  );

  const porAdquirenteCompleto = ADQUIRENTES.map((a) => {
    const achado = porAdquirente.find((r) => r.adquirente === a);
    return {
      adquirente: a,
      rotulo: ROTULOS[a],
      transacoes: achado ? achado.transacoes : 0,
      bruto: achado ? Number(achado.bruto) : 0,
      tarifa: achado ? Number(achado.tarifa) : 0,
      liquido: achado ? Number(achado.liquido) : 0,
      primeira_data: achado ? achado.primeira_data : null,
      ultima_data: achado ? achado.ultima_data : null,
    };
  });

  const somar = (campo) => porAdquirenteCompleto.reduce((acc, a) => acc + a[campo], 0);

  return res.json({
    periodo: { de, ate },
    por_adquirente: porAdquirenteCompleto,
    totais_cartao: {
      transacoes: somar('transacoes'),
      bruto: somar('bruto'),
      tarifa: somar('tarifa'),
      liquido: somar('liquido'),
    },
    dinheiro: {
      por_pdv: dinheiroRows.map((r) => ({
        pdv: r.pdv,
        lancamentos: r.lancamentos,
        total: Number(r.total),
      })),
      total: dinheiroRows.reduce((acc, r) => acc + Number(r.total), 0),
    },
  });
}

// Listagem paginada — a conciliação tem milhares de linhas, então nunca devolve tudo.
async function listarTransacoes(req, res) {
  const { de, ate } = periodoDaQuery(req.query);
  const { adquirente } = req.query;

  const limite = Math.min(Number(req.query.limite) || 100, 500);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);

  const params = [];
  const condicoes = filtroPeriodo(de, ate, params);

  if (adquirente) {
    if (!ADQUIRENTES.includes(adquirente)) {
      return res.status(400).json({ error: `adquirente inválido. Use um de: ${ADQUIRENTES.join(', ')}.` });
    }
    params.push(adquirente);
    condicoes.push(`adquirente = $${params.length}`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const { rows: totalRows } = await pool.query(
    `SELECT count(*)::int AS total FROM conciliacao_transacoes ${where}`,
    params
  );
  const total = totalRows[0].total;

  params.push(limite, (pagina - 1) * limite);
  const { rows } = await pool.query(
    `SELECT * FROM conciliacao_transacoes ${where}
      ORDER BY data DESC, hora DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return res.json({
    total,
    pagina,
    limite,
    paginas: Math.ceil(total / limite) || 1,
    transacoes: rows,
  });
}

module.exports = { resumo, listarTransacoes, ADQUIRENTES };
