// Venda que o cartão recusou não é venda.
//
// Desde 13/10/2026 o relatório da Cielo com "Todos os status" traz as
// tentativas "Não aprovada": bruto cheio, taxa zero, líquido zero. Lidas como
// venda, cada uma virava 100% de taxa — R$ 5.357,28 de despesa inventada no
// extrato de 05/10 a 09/11. Estes testes usam linhas no formato do "Detalhado
// de vendas" da Cielo.
const { converterLinhas, ehRecusada } = require('../src/utils/extrato');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };

// Data, hora, forma, bandeira, bruto, taxa, líquido, status
const mapa = { data: 0, hora: 1, forma: 2, bandeira: 3, valorBruto: 4, valorLiquido: 6, status: 7 };
const linhas = [
  ['23/10/2026', '11:22', 'Crédito à vista', 'Mastercard', 1200.02, 0, 0, 'Não aprovada'],
  ['23/10/2026', '11:25', 'Crédito à vista', 'Mastercard', 1200.02, -37.2, 1162.82, 'Aprovada'],
  ['25/10/2026', '09:10', 'Crédito parcelado loja', 'Visa', 246.25, 0, 0, 'Não aprovada'],
  ['04/11/2026', '10:39', 'Débito à vista', 'Visa', 152.35, 0, 0, 'Não aprovada'],
  ['04/11/2026', '10:39', 'Débito à vista', 'Visa', 152.35, -1.37, 150.98, 'Aprovada'],
  ['05/10/2026', '08:06', 'Débito à vista', 'Mastercard', 6.48, -0.06, 6.42, 'Aprovada'],
];

console.log('=== recusadas ficam de fora ===');
const r = converterLinhas(linhas, mapa, 'cielo', 'detalhe.xlsx');
ok('só as 3 aprovadas viram transação', r.transacoes.length === 3);
ok('nenhuma transação com status "Não aprovada"', r.transacoes.every((t) => t.status === 'Aprovada'));
ok('3 recusadas contadas', r.recusadas && r.recusadas.quantidade === 3);
ok('bruto recusado = 1.598,62', r.recusadas && r.recusadas.bruto === 1598.62);
ok('naOrdem traz as 6, na ordem do arquivo', r.naOrdem.length === 6 && r.naOrdem[0].status === 'Não aprovada');

console.log('\n=== a taxa das aprovadas continua certa ===');
const maiorTaxa = Math.max(...r.transacoes.map((t) => (t.tarifa / t.valorBruto) * 100));
ok('nenhuma taxa acima de 20%', maiorTaxa < 20);
ok('taxa da venda de 1.200,02 = 37,20', Math.abs(r.transacoes[0].tarifa - 37.2) < 0.001);

console.log('\n=== quais status contam como recusa ===');
ok('"Não aprovada"', ehRecusada('Não aprovada'));
ok('"NAO APROVADA"', ehRecusada('NAO APROVADA'));
ok('"Negada"', ehRecusada('Negada'));
ok('"Recusada"', ehRecusada('Recusada'));
ok('"Cancelada"', ehRecusada('Cancelada'));
ok('"Desfeita"', ehRecusada('Desfeita'));
ok('"Aprovada" não é recusa', !ehRecusada('Aprovada'));
ok('"Paga" não é recusa', !ehRecusada('Paga'));
ok('status vazio não é recusa', !ehRecusada(''));

console.log('\n=== arquivo sem coluna de status: nada muda ===');
const semStatus = converterLinhas(
  linhas.map((l) => l.slice(0, 7)),
  { data: 0, hora: 1, forma: 2, bandeira: 3, valorBruto: 4, valorLiquido: 6 },
  'cielo',
  'calendario.xlsx'
);
ok('todas as 6 entram', semStatus.transacoes.length === 6);
ok('nenhuma recusada', semStatus.recusadas === null);

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log('\nTudo certo.');
