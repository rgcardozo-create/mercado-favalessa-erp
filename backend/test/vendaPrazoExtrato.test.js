const { lerVendaPrazo } = require('../src/utils/vendaPrazoExtrato');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };
const perto = (a, b) => Math.abs(a - b) < 0.011;
const D = (s) => new Date(`${s}T00:00:00Z`);

// Monta uma linha pondo cada valor na coluna indicada, como o relatório faz.
function linha(pares) {
  const l = [];
  for (const [i, v] of pares) l[i] = v;
  return l;
}

// O relatório do SGLinear é impresso, não tabelado: o exportador só emite
// célula preenchida, e as colunas ESCORREGAM conforme o título tenha ou não
// data de baixa. As linhas abaixo reproduzem os dois formatos observados no
// arquivo real (que não entra no repositório: é dívida de cliente de verdade).
const CABECALHO = linha([
  [0, 'Fil'], [2, 'Doc'], [3, 'Parc'], [6, 'Histórico'], [8, 'Digit.'], [12, 'Emiss.'],
  [13, 'Vencto.'], [14, 'Vencto. Real'], [17, 'Baixa'], [18, 'Banco'], [19, 'Bruto'],
  [22, 'Desc.'], [23, 'Multa'], [26, 'Total'],
]);

// Título BAIXADO: tem histórico, então tudo depois dele anda para a direita.
const baixado = (doc, emiss, venc, baixa, valor) =>
  linha([[0, '001'], [2, doc], [4, '1'], [7, 'VENDA PRAZO - Cupom: ' + doc],
    [13, D(emiss)], [14, D(venc)], [16, D(venc)], [19, D(baixa)], [21, '001'],
    [23, valor], [27, 0], [28, 0], [29, valor]]);

// Título ABERTO: sem baixa, a cauda de números volta para o lugar do cabeçalho.
const aberto = (doc, emiss, venc, valor) =>
  linha([[0, '001'], [2, doc], [4, '1'], [7, 'VENDA PRAZO - Cupom: ' + doc],
    [13, D(emiss)], [14, D(venc)], [16, D(venc)], [19, valor], [22, 0], [23, 0], [26, valor]]);

// Título SEM documento: a coluna 2 fica vazia e a parcela cai na 3.
const semDoc = (emiss, valor, nome) =>
  linha([[0, '001'], [3, '1'], [6, nome], [8, D(emiss)], [12, D(emiss)], [13, D(emiss)],
    [14, D(emiss)], [18, '001'], [19, valor], [22, 0], [23, 0], [26, valor]]);

const totaisCliente = (ab, ba) =>
  linha([[5, 'Abertos:'], [7, ab], [12, 'Baixados:'], [15, ba], [19, 'Bruto:'], [25, ab + ba]]);

console.log('=== lê um cliente com título aberto e baixado ===');
const um = lerVendaPrazo([
  linha([[1, 'Cliente: 0000390-ADEMAR CUNHA'], [20, 'Fone: 27997679002']]),
  CABECALHO,
  baixado('12900', '2026-07-11', '2026-08-10', '2026-08-10', 350),
  aberto('362192', '2026-09-14', '2026-10-14', 23.58),
  totaisCliente(23.58, 350),
]);
ok('um cliente',                 um.clientes.length === 1);
ok('código separado do nome',    um.clientes[0].codigo === '0000390');
ok('nome sem o "Fone:"',         um.clientes[0].nome === 'ADEMAR CUNHA');
ok('dois títulos',               um.clientes[0].titulos.length === 2);
ok('o baixado tem data de baixa', um.clientes[0].titulos[0].baixa === '2026-08-10');
ok('o aberto não tem',            um.clientes[0].titulos[1].baixa === null);
ok('valores certos',              perto(um.clientes[0].titulos[0].valor, 350) && perto(um.clientes[0].titulos[1].valor, 23.58));
ok('confere com os totais do arquivo', um.confere === true);

console.log('\n=== título sem número de documento ===');
// Nove títulos do arquivo real vêm sem documento. Lendo "a segunda célula
// preenchida" como documento, pegava-se a PARCELA — que vale 1 em todos —, os
// nove viravam o mesmo registro e R$ 712,58 sumiam na importação.
const sem = lerVendaPrazo([
  linha([[1, 'Cliente: 0000409-ALESSANDRA KONYK']]),
  CABECALHO,
  semDoc('2026-09-08', 44.51, 'ALESSANDRA KONYK -'),
  aberto('361500', '2026-08-27', '2026-09-26', 63.69),
  totaisCliente(108.2, 0),
]);
ok('documento vem vazio, não "1"', sem.clientes[0].titulos[0].documento === '');
ok('não é confundido com baixado', sem.clientes[0].titulos[0].baixa === null);
ok('o outro mantém o documento',   sem.clientes[0].titulos[1].documento === '361500');
ok('confere',                      sem.confere === true);

console.log('\n=== cliente dividido pela quebra de página ===');
const partido = lerVendaPrazo([
  linha([[1, 'Cliente: 0000048-LEOMICE BARROS']]),
  CABECALHO,
  aberto('1001', '2026-08-01', '2026-09-01', 366.3),
  linha([[16, 'Página 2 de 12']]),
  linha([[1, 'Cliente: 0000048-LEOMICE BARROS']]),
  CABECALHO,
  aberto('1002', '2026-08-05', '2026-09-05', 111.34),
  totaisCliente(477.64, 0),
]);
ok('vira um cliente só, não dois', partido.clientes.length === 1);
ok('com os dois títulos',          partido.clientes[0].titulos.length === 2);
ok('e os totais somados conferem', partido.confere === true);

console.log('\n=== leitura que não bate é denunciada ===');
const errado = lerVendaPrazo([
  linha([[1, 'Cliente: 0000001-TESTE']]),
  CABECALHO,
  aberto('2001', '2026-08-01', '2026-09-01', 100),
  totaisCliente(999, 0),
]);
ok('confere = false',        errado.confere === false);
ok('e diz qual divergiu',    errado.divergentes.length === 1 && errado.divergentes[0].codigo === '0000001');

console.log('\n=== soma geral ===');
ok('abertos somados',  perto(um.soma.abertos, 23.58));
ok('baixados somados', perto(um.soma.baixados, 350));
ok('contagem de títulos', um.soma.titulos === 2);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
