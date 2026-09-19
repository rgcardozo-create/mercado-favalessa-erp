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

// ── Traço não é zero ─────────────────────────────────────────────────────────
//
// O relatório de vendas da Rede escreve "-" em `valor líquido` enquanto o MDR do
// dia não fecha. Lido como zero, a taxa virava a venda inteira — 100% — e num
// extrato do mês, misturado com linhas já liquidadas, dava os 30% e 45% que o
// dono estranhou. Reproduzido aqui com o mesmo desenho de colunas do arquivo
// real (o arquivo em si não entra no repositório: é movimentação de verdade).
const { converterLinhas } = require('../src/utils/extrato');

console.log('\n=== extrato da Rede com o MDR ainda em aberto ===');
const CAB_REDE = [
  'data da venda', 'hora da venda', 'status da venda', 'valor da venda original',
  'valor da venda atualizado', 'modalidade', 'tipo', 'número de parcelas', 'bandeira',
  'taxa MDR', 'valor MDR', 'valor líquido',
];
const mapaRede = acharCabecalho([CAB_REDE, []]).mapa;

const semMdr = converterLinhas(
  [['18/09/2026', '17:00:12', 'aprovada', 57.13, 57.13, 'crédito', 'à vista', 1, 'Mastercard', '-', 0, '-']],
  mapaRede,
  'itau',
  'rede.xlsx'
).transacoes[0];
ok('bruto lido certo',                 semMdr.valorBruto === 57.13);
ok('taxa é ZERO, não a venda inteira', semMdr.tarifa === 0);
ok('líquido é o bruto, não zero',      semMdr.valorLiquido === 57.13);

console.log('\n=== a mesma linha depois de o MDR fechar ===');
const comMdr = converterLinhas(
  [['18/09/2026', '17:00:12', 'aprovada', 57.13, 57.13, 'crédito', 'à vista', 1, 'Mastercard', '3,15%', 1.8, 55.33]],
  mapaRede,
  'itau',
  'rede.xlsx'
).transacoes[0];
ok('taxa = bruto menos líquido',  Math.abs(comMdr.tarifa - 1.8) < 0.001);
ok('percentual plausível (3,15%)', Math.abs((comMdr.tarifa / comMdr.valorBruto) * 100 - 3.15) < 0.05);

console.log('\n=== zero de verdade continua sendo zero ===');
const zeroReal = converterLinhas(
  [['18/09/2026', '17:00:12', 'aprovada', 57.13, 57.13, 'crédito', 'à vista', 1, 'Mastercard', '0%', 0, 57.13]],
  mapaRede,
  'itau',
  'rede.xlsx'
).transacoes[0];
ok('líquido igual ao bruto dá taxa 0', zeroReal.tarifa === 0);
ok('e o líquido segue sendo o bruto',  zeroReal.valorLiquido === 57.13);

console.log('\n=== outros jeitos de dizer "não tem valor" ===');
for (const vazio of ['--', 'N/A', 'n/d', '—', '', '  ']) {
  const t = converterLinhas(
    [['18/09/2026', '17:00:12', 'aprovada', 100, 100, 'débito', 'à vista', 1, 'Visa', '-', 0, vazio]],
    mapaRede,
    'itau',
    'rede.xlsx'
  ).transacoes[0];
  ok(`"${vazio.trim() || '(vazio)'}" não vira taxa de 100%`, t.tarifa === 0 && t.valorLiquido === 100);
}

console.log('\n=== voucher vai para Tickets mesmo vindo da Rede ===');
const voucher = converterLinhas(
  [['18/09/2026', '16:37:38', 'aprovada', 29.94, 29.94, 'voucher', 'outros', 1, 'Pluxee', '-', 0, '-']],
  mapaRede,
  'itau',
  'rede.xlsx'
).transacoes[0];
ok('separado como ticket', voucher.adquirente === 'tickets');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
