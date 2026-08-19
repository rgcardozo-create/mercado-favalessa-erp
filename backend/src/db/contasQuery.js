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
    to_char(p.ultimo_pagamento, 'YYYY-MM-DD') AS ultimo_pagamento,
    c.valor - COALESCE(p.total_pago, 0) AS saldo,
    (COALESCE(p.total_pago, 0) > 0 AND c.valor - COALESCE(p.total_pago, 0) <= 0) AS quitado
  FROM contas c
  LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
  LEFT JOIN (
    SELECT conta_id, SUM(valor) AS total_pago, MAX(data_pagamento) AS ultimo_pagamento
    FROM contas_pagamentos
    GROUP BY conta_id
  ) p ON p.conta_id = c.id
`;

// Texto sem acento e em minúsculas, para busca. `unaccent` é extensão e pode não
// estar instalada no banco do Railway, então normalizamos na mão — a tabela de
// contas é pequena (milhares de linhas), varredura sequencial aqui é barata.
const SEM_ACENTO = (expr) =>
  `translate(lower(${expr}), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`;

// "Hoje" sempre no fuso da loja, não no fuso do servidor (Railway roda em UTC).
const HOJE_SP = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;

// Os quatro tipos de conta a pagar da empresa. `pessoal` e `extra` não entram aqui
// de propósito — ver comentário do enum conta_tipo no schema.
const TIPOS_VALIDOS = ['fornecedor', 'fixa', 'imposto', 'despesa'];

const ROTULOS_TIPO = {
  fornecedor: 'Fornecedores',
  fixa: 'Despesas fixas',
  imposto: 'Impostos',
  despesa: 'Outras despesas',
};

module.exports = { SELECT_CONTAS_COM_SALDO, SEM_ACENTO, HOJE_SP, TIPOS_VALIDOS, ROTULOS_TIPO };
