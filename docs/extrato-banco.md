# Extrato bancário — o que o arquivo traz

Anotações do extrato de conta corrente de junho/2026 (Banco do Brasil), lido
para planejar duas coisas ainda não construídas: importar as saídas como contas
pagas, e conferir os recebimentos dos parceiros contra o que foi vendido.

O arquivo em si não entra no repositório — é movimentação bancária real. O que
fica aqui é o formato e o que se aprendeu olhando os números.

## Dois formatos, o mesmo banco

O extrato baixado no **computador** e no **celular** não são iguais. O do celular
vem resumido, com seis colunas; o do computador vem cru, com onze. O leitor
precisa dar o mesmo resultado nos dois — o dono baixa ora de um jeito, ora de
outro.

| | Celular (resumido) | Computador (cru) |
|---|---|---|
| Colunas | 6 | 11 |
| Cabeçalho | linha 1 | linha 3 |
| Valor | `Valor` | `Valor R$` |
| Crédito/débito | colado no valor (`1.067,79 C`) | coluna própria, `Inf.` |
| Natureza | `Lançamento` | `Historico` |
| Contraparte | `Detalhes` | `Detalhamento Hist.` |
| Documento | `1045969` | `00000000001045969` |

Duas diferenças mordem:

O **número do documento** vem com zeros à esquerda num e sem no outro. A
identidade da linha tira os zeros — senão o mesmo mês importado pelos dois
caminhos duplicaria tudo.

E o banco **nomeia o mesmo lançamento de dois jeitos**: `Pagamento de Impostos`
no celular, `Impostos` no computador. Foi a única natureza divergente das dez.
A chave de aprendizado tira o "Pagamento de" da frente, para não ser preciso
ensinar a mesma coisa duas vezes; e a identidade da linha não usa a descrição,
só data, valor e documento.

## Formato

Planilha `.xlsx`, uma aba chamada **Extrato Conta**, cabeçalho na linha 1:

| Data | Lançamento | Detalhes | N° documento | Valor | Tipo Lançamento |
|---|---|---|---|---|---|

- **Data** — célula de data de verdade, não texto.
- **Lançamento** — a natureza (`Pix - Recebido`, `Pagamento de Boleto`, `Tarifa
  Pix Enviado`…).
- **Detalhes** — onde mora o nome do outro lado, quando existe. Costuma vir como
  `<CNPJ/CPF> <NOME>`, às vezes precedido de `dd/mm hh:mm`.
- **Valor** — **texto**, no formato `1.067,79 C`. A letra no fim é o que separa
  entrada de saída: `C` crédito, `D` débito.

### A armadilha da coluna "Tipo Lançamento"

Ela diz **"Entrada" para todas as linhas**, inclusive `Pix - Enviado`,
`Pagamento de Boleto`, `Pagamento de Impostos` e `Tarifa`. Confiar nela faria
todo pagamento entrar no sistema como recebimento.

**Quem separa entrada de saída é o `C`/`D` no fim do Valor.** Nada mais.

Linhas de saldo (`Saldo Anterior`, `Saldo do dia`, `S A L D O`) aparecem
misturadas e precisam sair antes de qualquer soma.

## O que o mês de junho/2026 mostrou

1.365 linhas, 29/05 a 30/06. Créditos e débitos deram exatamente o mesmo
(R$ 55.829,16) e o saldo do dia fecha em zero — a conta é esvaziada todo dia.

### Recebimentos: dá para conferir

Os parceiros de voucher aparecem com nome e CNPJ nos Detalhes, então o
confronto com o que foi vendido é viável:

| Parceiro | Linhas | Valor |
|---|---|---|
| COMPROCARD | 22 | 8.632,93 |
| BANCO TOPAZIO (Cessão de Crédito) | 20 | 5.690,54 |
| LE CARD | 5 | 5.693,95 |
| PLUXEE | 48 | 3.764,51 |
| ALELO | 18 | 2.868,48 |
| Banco VR | 18 | 2.250,32 |
| UP BRASIL | 3 | 1.261,62 |

**O mesmo parceiro aparece escrito de mais de um jeito** — `LE CARD ADMINI` e
`LE CARD ADM`, `Banco VR` e `BANCO VR`. Casar por nome exige normalizar; casar
pelo CNPJ é mais seguro, e ele está lá.

Há também 1.132 `Pix - Recebido` de `FAVALESSA M` somando R$ 22.805,50, ticket
médio de R$ 20 — é o PIX do caixa, venda a venda.

### Saídas: metade não diz para quem

- **`Pagamento de Boleto` diz o fornecedor**: PORTOSEG, PJBANK, FRINCARNES,
  TOPCARD, LOUREIRO DISTRIBUIDORA, MILLAR. Esses casam com o cadastro.
- **`Pix - Enviado` NÃO diz**: os 25 lançamentos, que somam R$ 36.119,74 e são a
  maior parte da saída, trazem só `dd/mm hh:mm Favalessa`. Sem beneficiário, sem
  CNPJ.

Pelo padrão — um por noite, entre 20h e 23h, valor da ordem da venda do dia, e a
conta zerando — parecem varreduras para outra conta, não pagamento a fornecedor.
Se for isso, os pagamentos que interessam estão no extrato da outra conta.
**Confirmar com o dono antes de construir qualquer coisa em cima deles.**

O resto das saídas é reconhecível pelo próprio tipo: `Pagamento de Impostos`
(DUA SEFAZ ES), `BB GIRO FGO PRONAMPE` (empréstimo), `Brasilprev`, `Pagto cartão
crédito`, `Tarifa` e `BB Rende Fácil` (aplicação, que é dinheiro andando entre
contas e não despesa).
