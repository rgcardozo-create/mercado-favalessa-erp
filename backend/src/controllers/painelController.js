const pool = require('../db/pool');
const { SELECT_CONTAS_COM_SALDO, HOJE_SP, TIPOS_VALIDOS, ROTULOS_TIPO } = require('../db/contasQuery');

// Painel do dia: o que precisa ser pago hoje, o que já venceu e o que vence na semana.
//
// Cobre as quatro telas de Contas a pagar (Fornecedores, Despesas fixas, Impostos e
// Outras despesas), que vivem na tabela `contas` separadas por tipo.
//
// Contas pessoais e extras de funcionários não aparecem aqui e nunca podem aparecer:
// pessoais nunca entram em nenhum total da empresa, e extras (adiantamentos/vales) já
// são descontados na folha. Por isso ficam fora da tabela `contas` (SPEC.md, regras 1 e 3).
async function painelDoDia(req, res) {
  const sql = `
    WITH contas_com_saldo AS (${SELECT_CONTAS_COM_SALDO}),
    pendentes AS (
      SELECT * FROM contas_com_saldo WHERE quitado = false
    )
    SELECT
      ${HOJE_SP} AS hoje,
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.vencimento < ${HOJE_SP}) AS vencidas,
      (SELECT COALESCE(json_agg(t ORDER BY t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.vencimento = ${HOJE_SP}) AS vencem_hoje,
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t
        WHERE t.vencimento > ${HOJE_SP}
          AND t.vencimento <= ${HOJE_SP} + INTERVAL '7 days') AS proximos_7_dias
  `;

  const { rows } = await pool.query(sql);
  const painel = rows[0];

  const somar = (lista) => lista.reduce((acc, c) => acc + Number(c.saldo), 0);

  // Quanto está em aberto por tela (Fornecedores, Fixas, Impostos, Outras),
  // considerando tudo que já venceu ou vence nos próximos 7 dias.
  const aVencer = [...painel.vencidas, ...painel.vencem_hoje, ...painel.proximos_7_dias];
  const porTipo = TIPOS_VALIDOS.map((tipo) => {
    const doTipo = aVencer.filter((c) => c.tipo === tipo);
    return { tipo, rotulo: ROTULOS_TIPO[tipo], quantidade: doTipo.length, total: somar(doTipo) };
  }).filter((t) => t.quantidade > 0);

  return res.json({
    hoje: painel.hoje,
    vencidas: painel.vencidas,
    vencem_hoje: painel.vencem_hoje,
    proximos_7_dias: painel.proximos_7_dias,
    totais: {
      vencidas: somar(painel.vencidas),
      vencem_hoje: somar(painel.vencem_hoje),
      proximos_7_dias: somar(painel.proximos_7_dias),
    },
    por_tipo: porTipo,
  });
}

module.exports = { painelDoDia };
