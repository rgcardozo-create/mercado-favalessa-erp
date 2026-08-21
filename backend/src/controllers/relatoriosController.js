const pool = require('../db/pool');
const { ROTULOS_TIPO, TIPOS_VALIDOS, SEM_ACENTO } = require('../db/contasQuery');

// Cada adquirente escreve a forma do seu jeito ("Débito à vista", "Debito",
// "débito"), então o agrupamento é por palavra encontrada, sem acento e em
// minúsculas. Parcelado vem antes de crédito de propósito: "Crédito parcelado
// loja" tem as duas palavras e é o parcelado que interessa separar, porque é
// onde a taxa dói.
const GRUPO_FORMA = `
  CASE
    WHEN ${SEM_ACENTO('t.forma')} LIKE '%parcel%' THEN 'Crédito parcelado'
    WHEN t.categoria = 'ticket' OR ${SEM_ACENTO('t.forma')} LIKE '%voucher%'
      OR ${SEM_ACENTO('t.forma')} LIKE '%benefic%' THEN 'Voucher / ticket'
    WHEN ${SEM_ACENTO('t.forma')} LIKE '%debito%' THEN 'Débito'
    WHEN ${SEM_ACENTO('t.forma')} LIKE '%credito%' THEN 'Crédito'
    WHEN ${SEM_ACENTO('t.forma')} LIKE '%pix%' THEN 'PIX'
    ELSE 'Outros'
  END
`;

// Relatório consolidado por período. Três regras do SPEC.md moldam este arquivo:
//
//  1. Contas pessoais nunca entram em nenhum total da empresa. (Foram retiradas do
//     escopo do sistema pelo usuário, então nem existem no banco — mas a regra
//     continua valendo para qualquer coisa que venha a ser adicionada.)
//  2. Nome de funcionário só aparece com a Folha destravada. Trancada, a folha vira
//     uma linha genérica "Folha de pagamento": o valor entra nos totais, os nomes não.
//  3. Extras (adiantamentos/vales) ficam FORA das despesas — já são descontados na
//     folha, e contar de novo duplicaria. Aparecem só como informação à parte.
async function consolidado(req, res) {
  const { de, ate } = req.query;
  if (!de || !ate) {
    return res.status(400).json({ error: 'Informe o período com de e ate (AAAA-MM-DD).' });
  }

  // Despesas pagas no período, por tela. O que conta é a data da baixa: é quando
  // o dinheiro saiu de fato.
  const { rows: despesasRows } = await pool.query(
    `SELECT c.tipo, count(DISTINCT c.id)::int AS lancamentos, COALESCE(sum(p.valor), 0) AS pago
       FROM contas_pagamentos p
       JOIN contas c ON c.id = p.conta_id
      WHERE p.data_pagamento BETWEEN $1 AND $2
      GROUP BY c.tipo`,
    [de, ate]
  );

  const despesasPorTipo = TIPOS_VALIDOS.map((tipo) => {
    const achado = despesasRows.find((r) => r.tipo === tipo);
    return {
      tipo,
      rotulo: ROTULOS_TIPO[tipo],
      lancamentos: achado ? achado.lancamentos : 0,
      pago: achado ? Number(achado.pago) : 0,
    };
  }).filter((d) => d.lancamentos > 0);

  // Folha paga no período. Só entra o valor; os nomes dependem da folha destravada.
  const { rows: folhaRows } = await pool.query(
    `SELECT f.nome, COALESCE(sum(p.valor), 0) AS pago
       FROM folha_pagamentos p
       JOIN folha f ON f.id = p.folha_id
      WHERE p.data_pagamento BETWEEN $1 AND $2
      GROUP BY f.nome
      ORDER BY pago DESC`,
    [de, ate]
  );
  const folhaTotal = folhaRows.reduce((a, r) => a + Number(r.pago), 0);

  const folha = req.folhaDestravada
    ? {
        destravada: true,
        total: folhaTotal,
        por_funcionario: folhaRows.map((r) => ({ nome: r.nome, pago: Number(r.pago) })),
      }
    : {
        // Folha trancada: linha genérica, sem nome nenhum.
        destravada: false,
        total: folhaTotal,
        rotulo: 'Folha de pagamento',
      };

  // Entradas do período: conciliação (cartões) e dinheiro conferido por PDV.
  const { rows: cartaoRows } = await pool.query(
    `SELECT COALESCE(sum(valor_bruto), 0) AS bruto,
            COALESCE(sum(tarifa), 0) AS tarifa,
            COALESCE(sum(valor_liquido), 0) AS liquido,
            count(*)::int AS transacoes
       FROM conciliacao_transacoes
      WHERE data BETWEEN $1 AND $2`,
    [de, ate]
  );

  const { rows: dinheiroRows } = await pool.query(
    `SELECT COALESCE(sum(valor), 0) AS total FROM conciliacao_dinheiro WHERE data BETWEEN $1 AND $2`,
    [de, ate]
  );

  // Venda a prazo movimentada no período.
  const { rows: prazoRows } = await pool.query(
    `SELECT COALESCE(sum(valor) FILTER (WHERE tipo = 'compra'), 0) AS compras,
            COALESCE(sum(valor) FILTER (WHERE tipo = 'pagamento'), 0) AS pagamentos
       FROM mov_prazo
      WHERE data BETWEEN $1 AND $2`,
    [de, ate]
  );

  // Extras: fora das despesas de propósito, exibidos apenas como informação.
  const { rows: extrasRows } = await pool.query(
    `SELECT count(*)::int AS lancamentos, COALESCE(sum(valor), 0) AS total
       FROM extras WHERE data BETWEEN $1 AND $2`,
    [de, ate]
  );

  // Venda do período pelo fechamento diário — é a resposta para "quanto vendi",
  // e não se confunde com "quanto entrou de cartão", que chega dias depois.
  const { rows: vendasRows } = await pool.query(
    `SELECT count(*)::int AS dias,
            COALESCE(sum(dinheiro), 0) AS dinheiro,
            COALESCE(sum(cartao), 0) AS cartao,
            COALESCE(sum(pix), 0) AS pix,
            COALESCE(sum(tickets), 0) AS tickets,
            COALESCE(sum(pos_sistema + pos_maquina), 0) AS maquininha,
            COALESCE(sum(outras), 0) AS outras,
            COALESCE(sum(dinheiro + cartao + pix + tickets + pos_sistema + pos_maquina + outras), 0) AS total
       FROM acumulados WHERE data BETWEEN $1 AND $2`,
    [de, ate]
  );

  // Taxa por tipo de cartão: é o custo de vender, e ele só aparece se separado.
  const { rows: taxasRows } = await pool.query(
    `SELECT ${GRUPO_FORMA} AS grupo,
            count(*)::int AS transacoes,
            COALESCE(sum(t.valor_bruto), 0) AS bruto,
            COALESCE(sum(t.tarifa), 0) AS tarifa,
            COALESCE(sum(t.valor_liquido), 0) AS liquido
       FROM conciliacao_transacoes t
      WHERE t.data BETWEEN $1 AND $2
      GROUP BY 1
      ORDER BY tarifa DESC`,
    [de, ate]
  );

  const totalDespesas = despesasPorTipo.reduce((a, d) => a + d.pago, 0) + folhaTotal;
  const vendas = {
    dias: vendasRows[0].dias,
    total: Number(vendasRows[0].total),
    por_forma: ['dinheiro', 'cartao', 'pix', 'tickets', 'maquininha', 'outras'].map((k) => ({
      forma: k,
      valor: Number(vendasRows[0][k]),
    })),
  };

  return res.json({
    periodo: { de, ate },
    vendas,
    // Vendas menos despesas pagas. É o confronto do período, não lucro
    // contábil: não entram estoque, depreciação nem imposto ainda não pago.
    resultado: vendas.total - totalDespesas,
    taxas: {
      por_grupo: taxasRows.map((t) => ({
        grupo: t.grupo,
        transacoes: t.transacoes,
        bruto: Number(t.bruto),
        tarifa: Number(t.tarifa),
        liquido: Number(t.liquido),
        percentual: Number(t.bruto) > 0 ? (Number(t.tarifa) / Number(t.bruto)) * 100 : null,
      })),
      total: taxasRows.reduce((a, t) => a + Number(t.tarifa), 0),
    },
    despesas: {
      por_tipo: despesasPorTipo,
      folha,
      total: totalDespesas,
    },
    entradas: {
      cartoes: {
        transacoes: cartaoRows[0].transacoes,
        bruto: Number(cartaoRows[0].bruto),
        tarifa: Number(cartaoRows[0].tarifa),
        liquido: Number(cartaoRows[0].liquido),
      },
      dinheiro: Number(dinheiroRows[0].total),
    },
    venda_prazo: {
      compras: Number(prazoRows[0].compras),
      pagamentos: Number(prazoRows[0].pagamentos),
    },
    extras_informativo: {
      lancamentos: extrasRows[0].lancamentos,
      total: Number(extrasRows[0].total),
      nota: 'Não entra nas despesas: já é descontado na folha.',
    },
  });
}

module.exports = { consolidado };
