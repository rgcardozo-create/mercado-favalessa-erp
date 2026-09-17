const pool = require('../db/pool');

// Análise das taxas das adquirentes: de cada R$ 100 vendidos numa bandeira,
// quanto sobrou.
//
// O dado já estava no banco desde que os extratos passaram a ser importados —
// `valor_bruto`, `tarifa` e `valor_liquido` por transação. O que faltava era
// olhar para ele agrupado: transação por transação a taxa é centavo, e só somada
// por bandeira é que ela vira uma decisão ("essa bandeira me custa o dobro da
// outra").
//
// A honestidade aqui importa mais que em outras telas, porque um percentual
// errado leva a trocar de adquirente por um motivo que não existe.

// Nem todo extrato traz a taxa. Quando não traz, a transação entra com tarifa
// zero — e zero de taxa num cartão não é "não paguei nada", é "o arquivo não
// disse". Misturar as duas coisas derrubaria a média e faria a bandeira parecer
// mais barata do que é. Por isso elas são contadas à parte, e o percentual sai
// só do que tem taxa informada.
const SEM_TAXA = 'tarifa = 0';
const COM_TAXA = 'tarifa <> 0';

const AGRUPAMENTOS = {
  bandeira: "COALESCE(NULLIF(btrim(bandeira), ''), 'sem bandeira')",
  forma: "COALESCE(NULLIF(btrim(forma), ''), 'sem forma')",
  adquirente: 'adquirente::text',
};

function periodoValido(de, ate) {
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  return formato.test(de) && formato.test(ate) && de <= ate;
}

async function taxas(req, res) {
  const { de, ate } = req.query;
  if (!periodoValido(de, ate)) {
    return res.status(400).json({ error: 'Informe o período com de e ate (AAAA-MM-DD), com o fim depois do início.' });
  }

  // Filtro por situação, opcional. O padrão é NÃO filtrar: cada adquirente
  // escreve a situação com a palavra que quer, e escolher sozinho quais palavras
  // significam "não vendeu" seria adivinhar — chutar errado sumiria com venda de
  // verdade, calada. A tela mostra quais situações existem nos dados dele e
  // deixa ele decidir; o que o sistema garante é que a lista apareça.
  const situacoes = String(req.query.situacoes || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const params = [de, ate];
  let filtroSituacao = '';
  if (situacoes.length) {
    params.push(situacoes);
    filtroSituacao = ` AND COALESCE(NULLIF(btrim(status), ''), 'sem status') = ANY($${params.length}::text[])`;
  }
  const onde = `WHERE data BETWEEN $1 AND $2${filtroSituacao}`;

  const colunas = `
    count(*)::int AS transacoes,
    COALESCE(sum(valor_bruto), 0) AS bruto,
    COALESCE(sum(tarifa), 0) AS tarifa,
    COALESCE(sum(valor_liquido), 0) AS liquido,
    count(*) FILTER (WHERE ${COM_TAXA})::int AS transacoes_com_taxa,
    COALESCE(sum(valor_bruto) FILTER (WHERE ${COM_TAXA}), 0) AS bruto_com_taxa,
    COALESCE(sum(tarifa) FILTER (WHERE ${COM_TAXA}), 0) AS tarifa_com_taxa,
    count(*) FILTER (WHERE ${SEM_TAXA})::int AS transacoes_sem_taxa,
    COALESCE(sum(valor_bruto) FILTER (WHERE ${SEM_TAXA}), 0) AS bruto_sem_taxa`;

  // O percentual só existe onde há taxa informada. Sem base, vem null — e a tela
  // escreve "sem taxa no extrato" em vez de um "0,00%" que seria mentira.
  const comPercentual = (linha) => {
    const base = Number(linha.bruto_com_taxa);
    const taxa = Number(linha.tarifa_com_taxa);
    return {
      ...linha,
      bruto: Number(linha.bruto),
      tarifa: Number(linha.tarifa),
      liquido: Number(linha.liquido),
      bruto_com_taxa: base,
      tarifa_com_taxa: taxa,
      bruto_sem_taxa: Number(linha.bruto_sem_taxa),
      percentual: base > 0 ? Number(((taxa / base) * 100).toFixed(4)) : null,
      // Quanto essa bandeira custa por transação, em reais. Ajuda a enxergar o
      // caso da taxa fixa, que pesa muito na venda pequena e quase nada na grande.
      custo_medio: linha.transacoes_com_taxa > 0 ? Number((taxa / linha.transacoes_com_taxa).toFixed(2)) : null,
    };
  };

  const consulta = async (agrupamento) => {
    const { rows } = await pool.query(
      `SELECT adquirente::text AS adquirente,
              ${AGRUPAMENTOS.bandeira} AS bandeira,
              ${AGRUPAMENTOS.forma} AS forma,
              ${colunas}
         FROM conciliacao_transacoes
        ${onde}
        GROUP BY 1, 2, 3
        ORDER BY 1, sum(valor_bruto) DESC`,
      params
    );
    return rows.map(comPercentual);
  };

  const [detalhe, porAdquirente, geral, status] = await Promise.all([
    consulta(),
    pool
      .query(
        `SELECT adquirente::text AS adquirente, ${colunas}
           FROM conciliacao_transacoes
           ${onde}
          GROUP BY 1 ORDER BY sum(valor_bruto) DESC`,
        params
      )
      .then((r) => r.rows.map(comPercentual)),
    pool
      .query(`SELECT ${colunas} FROM conciliacao_transacoes ${onde}`, params)
      .then((r) => comPercentual(r.rows[0])),
    // Extrato traz transação cancelada e negada junto com a aprovada. Somar tudo
    // como se fosse venda infla o bruto; por isso o recorte aparece na tela, para
    // ele ver se há algo fora de "Aprovada" mexendo no número.
    pool
      .query(
        `SELECT COALESCE(NULLIF(btrim(status), ''), 'sem status') AS status,
                count(*)::int AS transacoes,
                COALESCE(sum(valor_bruto), 0) AS bruto
           FROM conciliacao_transacoes
          WHERE data BETWEEN $1 AND $2
          GROUP BY 1 ORDER BY sum(valor_bruto) DESC`,
        [de, ate]
      )
      .then((r) => r.rows.map((l) => ({ ...l, bruto: Number(l.bruto) }))),
  ]);

  return res.json({ periodo: { de, ate }, situacoes, detalhe, por_adquirente: porAdquirente, geral, status });
}

module.exports = { taxas };
