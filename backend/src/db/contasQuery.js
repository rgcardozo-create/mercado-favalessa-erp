// Definição única de saldo/quitação, compartilhada por todas as telas que leem contas.
//
// Regra do negócio (herdada do sistema v3): uma conta só é considerada quitada se
// existe pagamento registrado E o saldo zerou. Um lançamento de valor zero sem
// nenhuma baixa continua pendente — nunca some da lista só porque o saldo é zero.
const SELECT_CONTAS_COM_SALDO = `
  SELECT
    c.*,
    f.nome AS fornecedor_nome,
    COALESCE(p.total_pago, 0) AS total_pago,
    c.valor - COALESCE(p.total_pago, 0) AS saldo,
    (COALESCE(p.total_pago, 0) > 0 AND c.valor - COALESCE(p.total_pago, 0) <= 0) AS quitado
  FROM contas c
  LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
  LEFT JOIN (
    SELECT conta_id, SUM(valor) AS total_pago
    FROM contas_pagamentos
    GROUP BY conta_id
  ) p ON p.conta_id = c.id
`;

// "Hoje" sempre no fuso da loja, não no fuso do servidor (Railway roda em UTC).
const HOJE_SP = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;

module.exports = { SELECT_CONTAS_COM_SALDO, HOJE_SP };
