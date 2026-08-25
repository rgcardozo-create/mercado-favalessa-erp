const pool = require('../db/pool');
const { SELECT_CONTAS_COM_SALDO, HOJE_SP } = require('../db/contasQuery');

// Painel do dia — separa o que é compromisso previsível do que é o corre do dia.
//
// Despesas fixas, impostos e outras despesas ficam sempre à vista, mas mostrando
// por padrão só o que já venceu ou vence hoje: é isso que precisa de ação agora.
// O que vence depois só aparece se o usuário pedir pelo seletor do próprio bloco.
//
// Boleto de fornecedor é volumoso (dezenas em aberto a qualquer momento), então
// não fica listado por inteiro: aparece só a fatia escolhida no filtro — o dia
// corrente por padrão, saindo sozinho quando vira o dia. A lista completa vive
// na tela de Contas a pagar, que é onde ela faz sentido.
//
// Contas pessoais e extras de funcionários não aparecem aqui e nunca podem aparecer:
// pessoais nunca entram em nenhum total da empresa, e extras (adiantamentos/vales) já
// são descontados na folha. Por isso ficam fora da tabela `contas` (SPEC.md, regras 1 e 3).

// Recortes possíveis para os boletos de fornecedor.
const FILTROS = {
  hoje: `t.vencimento = ${HOJE_SP}`,
  ontem: `t.vencimento = ${HOJE_SP} - 1`,
  atrasados: `t.vencimento < ${HOJE_SP}`,
  semana: `t.vencimento >= ${HOJE_SP} AND t.vencimento <= ${HOJE_SP} + 7`,
};

// Recortes dos três blocos fixos (fixas, impostos e outras despesas). O padrão é `ate_hoje` — vencidas mais as
// que vencem hoje — e é ele que vale quando o parâmetro vem vazio ou inválido.
const FILTROS_FIXOS = {
  ate_hoje: `t.vencimento <= ${HOJE_SP}`,
  atrasados: `t.vencimento < ${HOJE_SP}`,
  hoje: `t.vencimento = ${HOJE_SP}`,
  semana: `t.vencimento <= ${HOJE_SP} + 7`,
  todos: 'true',
};
const FILTRO_FIXOS_PADRAO = 'ate_hoje';

const escolher = (mapa, valor, padrao) => (mapa[valor] ? valor : padrao);

async function painelDoDia(req, res) {
  const filtro = escolher(FILTROS, req.query.filtro, 'hoje');
  const filtroFixas = escolher(FILTROS_FIXOS, req.query.filtroFixas, FILTRO_FIXOS_PADRAO);
  const filtroImpostos = escolher(FILTROS_FIXOS, req.query.filtroImpostos, FILTRO_FIXOS_PADRAO);
  const filtroDespesas = escolher(FILTROS_FIXOS, req.query.filtroDespesas, FILTRO_FIXOS_PADRAO);
  const filtroOperacionais = escolher(FILTROS_FIXOS, req.query.filtroOperacionais, FILTRO_FIXOS_PADRAO);

  const sql = `
    WITH contas_com_saldo AS (${SELECT_CONTAS_COM_SALDO}),
    pendentes AS (
      SELECT * FROM contas_com_saldo WHERE quitado = false
    )
    SELECT
      -- Como texto: o resto do código (e o frontend) compara datas por string.
      to_char(${HOJE_SP}, 'YYYY-MM-DD') AS hoje,

      -- Boletos de fornecedor, só a fatia escolhida. Outras despesas saíram daqui
      -- e ganharam bloco próprio: são poucas e previsíveis como fixas e impostos.
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t
        WHERE t.tipo = 'fornecedor'
          AND ${FILTROS[filtro]}) AS boletos,

      -- Quantos boletos existem em aberto ao todo, para o usuário saber que há
      -- mais fora do recorte sem precisar listar todos aqui.
      (SELECT count(*) FROM pendentes t WHERE t.tipo = 'fornecedor') AS boletos_em_aberto,
      (SELECT COALESCE(sum(t.saldo), 0) FROM pendentes t WHERE t.tipo = 'fornecedor') AS boletos_total,
      (SELECT count(*) FROM pendentes t
        WHERE t.tipo = 'fornecedor' AND t.vencimento < ${HOJE_SP}) AS boletos_atrasados,

      -- Fixas e impostos: por padrão só o que já venceu ou vence hoje.
      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.tipo = 'fixa' AND ${FILTROS_FIXOS[filtroFixas]}) AS fixas,
      (SELECT count(*) FROM pendentes t WHERE t.tipo = 'fixa') AS fixas_em_aberto,
      (SELECT COALESCE(sum(t.saldo), 0) FROM pendentes t WHERE t.tipo = 'fixa') AS fixas_total,

      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.tipo = 'imposto' AND ${FILTROS_FIXOS[filtroImpostos]}) AS impostos,
      (SELECT count(*) FROM pendentes t WHERE t.tipo = 'imposto') AS impostos_em_aberto,
      (SELECT COALESCE(sum(t.saldo), 0) FROM pendentes t WHERE t.tipo = 'imposto') AS impostos_total,

      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.tipo = 'operacional' AND ${FILTROS_FIXOS[filtroOperacionais]}) AS operacionais,
      (SELECT count(*) FROM pendentes t WHERE t.tipo = 'operacional') AS operacionais_em_aberto,
      (SELECT COALESCE(sum(t.saldo), 0) FROM pendentes t WHERE t.tipo = 'operacional') AS operacionais_total,

      (SELECT COALESCE(json_agg(t ORDER BY t.vencimento, t.valor DESC), '[]'::json)
         FROM pendentes t WHERE t.tipo = 'despesa' AND ${FILTROS_FIXOS[filtroDespesas]}) AS despesas,
      (SELECT count(*) FROM pendentes t WHERE t.tipo = 'despesa') AS despesas_em_aberto,
      (SELECT COALESCE(sum(t.saldo), 0) FROM pendentes t WHERE t.tipo = 'despesa') AS despesas_total
  `;

  const { rows } = await pool.query(sql);
  const p = rows[0];

  const somar = (lista) => lista.reduce((acc, c) => acc + Number(c.saldo), 0);
  // `vencimento` e `hoje` chegam como 'YYYY-MM-DD', então a comparação textual basta.
  const contarAtrasadas = (lista, hoje) =>
    lista.filter((c) => String(c.vencimento).slice(0, 10) < hoje).length;

  const bloco = (lista, emAberto) => ({
    contas: lista,
    quantidade: lista.length,
    total: somar(lista),
    atrasadas: contarAtrasadas(lista, p.hoje),
    ...(emAberto || {}),
  });

  const emAberto = (quantidade, valor) => ({
    em_aberto_total: Number(quantidade),
    em_aberto_valor: Number(valor),
  });

  return res.json({
    hoje: p.hoje,
    filtro,
    filtro_fixas: filtroFixas,
    filtro_impostos: filtroImpostos,
    filtro_despesas: filtroDespesas,
    filtro_operacionais: filtroOperacionais,
    boletos: {
      ...bloco(p.boletos, emAberto(p.boletos_em_aberto, p.boletos_total)),
      em_aberto_atrasados: Number(p.boletos_atrasados),
    },
    fixas: bloco(p.fixas, emAberto(p.fixas_em_aberto, p.fixas_total)),
    impostos: bloco(p.impostos, emAberto(p.impostos_em_aberto, p.impostos_total)),
    operacionais: bloco(p.operacionais, emAberto(p.operacionais_em_aberto, p.operacionais_total)),
    despesas: bloco(p.despesas, emAberto(p.despesas_em_aberto, p.despesas_total)),
  });
}

module.exports = { painelDoDia };
