// Foi `acharCabecalho` que inflou a taxa do extrato parcelado, tomando o líquido
// da parcela pelo líquido da venda. Por isso ele é testado direto.
const { acharCabecalho } = require('../src/utils/lerPlanilha');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };

function mapear(cabecalho) {
  const { mapa } = acharCabecalho([cabecalho, []]);
  const nome = (campo) => (mapa[campo] === undefined ? null : cabecalho[mapa[campo]]);
  return { bruto: nome('valorBruto'), liquido: nome('valorLiquido'), tarifa: nome('tarifa') };
}

console.log('=== o layout que já funcionava não pode quebrar ===');
const cielo = mapear(['Data da venda', 'Bandeira', 'Tipo', 'Valor bruto', 'Valor líquido', 'Status']);
ok('bruto = "Valor bruto"',      cielo.bruto === 'Valor bruto');
ok('líquido = "Valor líquido"',  cielo.liquido === 'Valor líquido');
ok('tarifa sai do mapa quando há bruto e líquido', cielo.tarifa === null);

console.log('\n=== crédito parcelado: o defeito que inflou a taxa ===');
// Antes desta correção, o líquido vinha de "Valor líquido da parcela": numa
// venda de 300 em 3x, a taxa saía como 300 - 96,50 = 67%.
const rede = mapear([
  'Data da venda', 'Bandeira', 'Tipo', 'Valor da venda',
  'Parcela', 'Valor da parcela', 'Valor líquido da parcela', 'Valor líquido da venda', 'Status',
]);
ok('bruto é o da VENDA, não o da parcela',     rede.bruto === 'Valor da venda');
ok('líquido é o da VENDA, não o da parcela',   rede.liquido === 'Valor líquido da venda');

console.log('\n=== líquido antes do bruto no arquivo ===');
// Antes, o sinônimo fraco "valor" fazia valorBruto abocanhar "Valor líquido"
// só por vir primeiro, e o líquido ficava sem coluna.
const invertido = mapear(['Data', 'Bandeira', 'Valor líquido', 'Valor bruto', 'Status']);
ok('bruto = "Valor bruto"',     invertido.bruto === 'Valor bruto');
ok('líquido = "Valor líquido"', invertido.liquido === 'Valor líquido');

console.log('\n=== extrato sem coluna de líquido ===');
const semLiquido = mapear(['Data', 'Bandeira', 'Valor', 'Taxa']);
ok('bruto = "Valor"',      semLiquido.bruto === 'Valor');
ok('tarifa = "Taxa"',      semLiquido.tarifa === 'Taxa');
ok('líquido não mapeado',  semLiquido.liquido === null);

console.log('\n=== "valor a receber" é líquido ===');
const aReceber = mapear(['Data', 'Bandeira', 'Valor', 'Taxa', 'Valor a receber']);
ok('bruto = "Valor"',              aReceber.bruto === 'Valor');
ok('líquido = "Valor a receber"',  aReceber.liquido === 'Valor a receber');

console.log('\n=== só colunas de parcela: usa, mas não inventa ===');
const soParcela = mapear(['Data', 'Bandeira', 'Valor da parcela', 'Valor líquido da parcela']);
ok('bruto cai na parcela',    soParcela.bruto === 'Valor da parcela');
ok('líquido cai na parcela',  soParcela.liquido === 'Valor líquido da parcela');

console.log('\n=== uma coluna serve a um campo só ===');
const repetido = mapear(['Data', 'Valor', 'Valor']);
ok('a segunda "Valor" não vira líquido', repetido.liquido === null);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
