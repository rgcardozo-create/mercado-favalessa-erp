const { SEM_ACENTO } = require('./contasQuery');

// Como classificar a transação de um extrato.
//
// Cada adquirente escreve a forma do seu jeito — "Débito à vista", "Debito",
// "débito" — e o PIX da maquininha vem dentro do arquivo da Cielo como qualquer
// outra venda. Por isso a classificação é pela FORMA da transação, nunca pelo
// adquirente: agrupar por adquirente jogaria o PIX da Cielo no bolo do cartão.
//
// Parcelado é testado antes de crédito de propósito: "Crédito parcelado loja"
// tem as duas palavras, e é o parcelado que interessa separar, porque é onde a
// taxa dói.
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

// Para onde a transação vai no fechamento do dia.
//
// O arquivo de Tickets (Rede Compras) vem inteiro para o campo Tickets, mesmo
// nas linhas escritas como "Débito à vista": são cartões de benefício — Alelo,
// VR, Pluxee — e o adquirente os rotula como débito. Conferido contra os
// fechamentos gerados pelo sistema antigo: 12/07, 18/07 e 22/07 batem ao
// centavo com o total do arquivo de Tickets do dia.
//
// Nos demais arquivos, o que separa é o PIX: ele tem campo próprio no
// fechamento e chega dentro do arquivo da Cielo como qualquer outra venda.
// Todo o resto é cartão.
//
// Voucher solto num arquivo de cartão não precisa de regra aqui: na importação
// do extrato ele já é desviado para o adquirente Tickets. Reclassificar de novo
// nesta etapa só faria mover para Tickets linha de benefício que o sistema
// antigo contava como cartão — e aí o fechamento novo deixaria de bater com o
// histórico, sem que nada tivesse mudado na loja.
function campoDoFechamento(adquirente, grupo) {
  if (adquirente === 'tickets') return 'tickets';
  return grupo === 'PIX' ? 'pix' : 'cartao';
}

module.exports = { GRUPO_FORMA, campoDoFechamento };
