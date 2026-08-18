const pool = require('../db/pool');
const { SELECT_CONTAS_COM_SALDO, HOJE_SP } = require('../db/contasQuery');

// Painel do dia — separa o que é compromisso previsível do que é o corre do dia.
//
// Despesas fixas e impostos ficam SEMPRE à vista, com tudo que está pendente:
// são poucos, previsíveis, e o dono quer bater o olho e saber o que vem.
//
// Boleto de fornecedor é volumoso (dezenas em aberto a qualquer momento), então
// não fica listado por inteiro: aparece só a fatia escolhida no filtro — o dia
// corrente por padrão, saindo sozinho quando vira o dia. A lista completa vive
// na tela de Contas a pagar, que é onde ela faz sentido.
//
// Contas pessoais e extras de funcionários não aparecem aqui e nunca podem aparecer:
// pessoais nunca entram em nenhum total da empresa, e extras (adiantamentos/vales) já
// são descontados na folha. Por isso ficam fora da tabela `contas` (SPEC.md, regras 1 e 3).

// Recortes possíveis para os boletos.
const FILTROS = {
  hoje: `t.vencimento = ${HOJE_SP}`,
  ontem: `t.vencimento = ${HOJE_SP} - 1`,
  atrasados: `t.vencimento < ${HOJE_SP}`,
  semana: `t.vencimento >= ${HOJE_SP} AND t.vencimento <= ${HOJE_SP} + 7`,
};

async function painelDoDia(req, res) {
  const filtro = FILTROS[req.query.filtro] ? req.query.filtro : 'hoje';

  const sql = `
    WITH contas_com_saldo AS (${SELECT_CONTAS_COM_SALDO}),
    pendentes AS (
      SELECT * FROM contas_com_saldo WHERE quitado = false
    )
    SELECT
      ${HOJE_SP} AS hoje,

      -- Boletos de fornecedor e outras despesas, só a fatia escolhida.
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t
        WHERE t.tipo IN ('fornecedor', 'despesa')
          AND ${FILTROS[filtro]}) AS boletos,

      -- Quantos boletos existem em aberto ao todo, para o usuário saber que há
      -- mais fora do recorte sem precisar listar todos aqui.
      (SELECT count(*) FROM pendentes t WHERE t.tipo IN ('fornecedor', 'despesa')) AS boletos_em_aberto,
      (SELECT COALESCE(sum(t.saldo), 0) FROM pendentes t WHERE t.tipo IN ('fornecedor', 'despesa')) AS boletos_total,
      (SELECT count(*) FROM pendentes t
        WHERE t.tipo IN ('fornecedor', 'despesa') AND t.vencimento < ${HOJE_SP}) AS boletos_atrasados,

      -- Fixas e impostos: tudo que está pendente, atrasado ou não.
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.tipo = 'fixa') AS fixas,
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.tipo = 'imposto') AS impostos
  `;

  const { rows } = await pool.query(sql);
  const p = rows[0];

  const somar = (lista) => lista.reduce((acc, c) => acc + Number(c.saldo), 0);
  const contarAtrasadas = (lista, hoje) =>
    lista.filter((c) => String(c.vencimento).slice(0, 10) < String(hoje).slice(0, 10)).length;

  const bloco = (lista) => ({
    contas: lista,
    quantidade: lista.length,
    total: somar(lista),
    atrasadas: contarAtrasadas(lista, p.hoje),
  });

  return res.json({
    hoje: p.hoje,
    filtro,
    boletos: {
      ...bloco(p.boletos),
      em_aberto_total: Number(p.boletos_em_aberto),
      em_aberto_valor: Number(p.boletos_total),
      em_aberto_atrasados: Number(p.boletos_atrasados),
    },
    fixas: bloco(p.fixas),
    impostos: bloco(p.impostos),
  });
}

module.exports = { painelDoDia };
