const pool = require('../db/pool');
const { SELECT_CONTAS_COM_SALDO, HOJE_SP } = require('../db/contasQuery');

// Painel do dia: o que precisa ser pago hoje, o que já venceu e o que vence na semana.
//
// Só entram contas de fornecedores (Fase 1). Quando as demais coleções chegarem, elas
// precisam respeitar as regras do SPEC.md — contas pessoais nunca entram em nenhum total
// da empresa, e `extras[]` (adiantamentos/vales) fica fora das somas de despesa porque
// já é descontado na folha.
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
  });
}

module.exports = { painelDoDia };
