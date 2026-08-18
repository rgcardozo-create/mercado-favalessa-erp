const pool = require('../db/pool');
const { SELECT_CONTAS_COM_SALDO, HOJE_SP } = require('../db/contasQuery');

// Painel do dia — organizado pelo que o dono precisa decidir, não por período genérico.
//
// A ideia: fixas e impostos são previsíveis e ficam sempre à vista; conta de
// fornecedor é do dia a dia e só aparece a do dia corrente, saindo sozinha quando
// vira o dia. Assim o painel não vira uma lista longa de tudo que existe.
//
// Contas pessoais e extras de funcionários não aparecem aqui e nunca podem aparecer:
// pessoais nunca entram em nenhum total da empresa, e extras (adiantamentos/vales) já
// são descontados na folha. Por isso ficam fora da tabela `contas` (SPEC.md, regras 1 e 3).

// Quanto o bloco "vencendo" enxerga à frente. Padrão: só o dia corrente.
const HORIZONTES = { hoje: 0, amanha: 1, semana: 7 };

async function painelDoDia(req, res) {
  const horizonte = HORIZONTES[req.query.horizonte] ?? 0;

  const sql = `
    WITH contas_com_saldo AS (${SELECT_CONTAS_COM_SALDO}),
    pendentes AS (
      SELECT * FROM contas_com_saldo WHERE quitado = false
    )
    SELECT
      ${HOJE_SP} AS hoje,

      -- Atrasados: tudo que já venceu, de qualquer tela. É a única lista que
      -- mistura tipos, porque atraso é atraso.
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.vencimento < ${HOJE_SP}) AS atrasados,

      -- Vencendo: o dia corrente (ou até o horizonte escolhido).
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t
        WHERE t.vencimento >= ${HOJE_SP}
          AND t.vencimento <= ${HOJE_SP} + ($1::int || ' days')::interval) AS vencendo,

      -- Contas fixas do mês corrente ainda a vencer: aluguel, água, sistema...
      -- ficam à vista o mês todo porque são compromisso certo.
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t
        WHERE t.tipo = 'fixa'
          AND t.vencimento > ${HOJE_SP} + ($1::int || ' days')::interval
          AND date_trunc('month', t.vencimento) = date_trunc('month', ${HOJE_SP})) AS fixas_do_mes,

      -- Impostos a vencer: sem recorte de mês, porque parcelamento de imposto
      -- se estende por meses e o dono quer enxergar tudo que vem pela frente.
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t
        WHERE t.tipo = 'imposto'
          AND t.vencimento > ${HOJE_SP} + ($1::int || ' days')::interval) AS impostos_a_vencer
  `;

  const { rows } = await pool.query(sql, [horizonte]);
  const p = rows[0];

  const somar = (lista) => lista.reduce((acc, c) => acc + Number(c.saldo), 0);
  const bloco = (lista) => ({ contas: lista, quantidade: lista.length, total: somar(lista) });

  return res.json({
    hoje: p.hoje,
    horizonte: req.query.horizonte || 'hoje',
    atrasados: bloco(p.atrasados),
    vencendo: bloco(p.vencendo),
    fixas_do_mes: bloco(p.fixas_do_mes),
    impostos_a_vencer: bloco(p.impostos_a_vencer),
  });
}

module.exports = { painelDoDia };
