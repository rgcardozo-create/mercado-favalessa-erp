// Leitura do código do boleto (utils/boleto.js).
//
// Os casos são boletos de verdade que chegaram na loja: um da BRF (Bradesco) e
// três da Matias Distribuidora (Banco do Brasil), estes com o mesmo começo de
// nosso número e só o final diferente. É esse caso que o código resolve.
const { lerCodigoBoleto, vencimentoDoFator } = require('../src/utils/boleto');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };
const HOJE = '2026-11-11';

console.log('=== BRF, Bradesco: linha digitável ===');
const brf = lerCodigoBoleto('23792.37213 90017.144610 43000.527309 1 15900000015359', HOJE);
ok('é boleto bancário', brf.tipo === 'boleto');
ok('banco Bradesco', brf.banco === '237' && brf.banco_nome === 'Bradesco');
ok('vencimento 05/10/2026', brf.vencimento === '2026-10-05');
ok('valor 153,59', brf.valor === 153.59);
ok('nosso número 00171446143 (o do papel, sem o dígito)', brf.nosso_numero === '00171446143');
// É exatamente o que o "Relatório de Pagamentos Realizados" do BB mostra como
// "Nosso Número" do pagamento de 05/10: é por aqui que o cruzamento vai casar.
ok('campo livre igual ao do relatório do BB', brf.campo_livre === '2372190017144614300052730');
ok('código de barras com 44 números', brf.codigo_barras.length === 44);

console.log('\n=== o leitor devolve o código de barras, não a linha ===');
const pelaBarra = lerCodigoBoleto(brf.codigo_barras, HOJE);
ok('mesmo valor', pelaBarra.valor === 153.59);
ok('mesmo vencimento', pelaBarra.vencimento === '2026-10-05');
ok('mesmo nosso número', pelaBarra.nosso_numero === brf.nosso_numero);

console.log('\n=== Matias, Banco do Brasil: três boletos, mesmo começo ===');
const matias = [
  ['00190.00009 03354.018008 00040.273179 7 15910000011035', '2026-10-06', 110.35, '33540180000040273'],
  ['00190.00009 03354.018008 00040.410177 2 16050000032187', '2026-10-20', 321.87, '33540180000040410'],
  ['00190.00009 03354.018008 00040.435174 2 16210000031152', '2026-11-05', 311.52, '33540180000040435'],
];
const codigos = new Set();
for (const [linha, venc, valor, nn] of matias) {
  const b = lerCodigoBoleto(linha, HOJE);
  ok(`vence ${venc}, R$ ${valor}, nosso número ${nn}`,
    b.banco === '001' && b.vencimento === venc && b.valor === valor && b.nosso_numero === nn);
  codigos.add(b.codigo_barras);
}
ok('os três códigos são diferentes', codigos.size === 3);

console.log('\n=== número errado é recusado, não gravado ===');
const trocado = lerCodigoBoleto('23792.37213 90017.144610 43000.527309 1 15900000015358', HOJE);
ok('valor trocado na linha: erro', Boolean(trocado.erro));
const campoTrocado = lerCodigoBoleto('23792.37213 90017.144611 43000.527309 1 15900000015359', HOJE);
ok('dígito de campo trocado: erro', Boolean(campoTrocado.erro));
const barraErrada = lerCodigoBoleto(`${brf.codigo_barras.slice(0, 43)}9`, HOJE);
ok('código de barras com número trocado: erro', Boolean(barraErrada.erro));
ok('leitura pela metade (40 números): erro', Boolean(lerCodigoBoleto('2'.repeat(40), HOJE).erro));

console.log('\n=== sem leitor: final do nosso número ===');
const curto = lerCodigoBoleto('0000040273', HOJE);
ok('vira nosso número', curto.tipo === 'nosso_numero');
ok('sem zeros à esquerda', curto.nosso_numero === '40273');
ok('não inventa valor nem vencimento', curto.valor === null && curto.vencimento === null);
ok('campo vazio: nada', lerCodigoBoleto('', HOJE) === null);
ok('dois números: curto demais', Boolean(lerCodigoBoleto('12', HOJE).erro));

console.log('\n=== fator de vencimento depois de fev/2025 ===');
ok('fator 1000 = 22/02/2025', vencimentoDoFator(1000, '2025-03-01') === '2025-02-22');
ok('fator 9999 em 2025 = 21/02/2025 (ciclo antigo)', vencimentoDoFator(9999, '2025-02-10') === '2025-02-21');
ok('fator 0 = sem vencimento', vencimentoDoFator(0, HOJE) === null);

console.log('\n=== conta de consumo / tributo (começa com 8) ===');
// Montado com dígitos válidos: referência 6 (valor em reais), R$ 300,98.
const { modulo10 } = require('../src/utils/boleto');
const semDv = `816${'00000030098'}${'0'.repeat(29)}`; // 43 números
const arrecadacao = semDv.slice(0, 3) + modulo10(semDv) + semDv.slice(3);
const conta = lerCodigoBoleto(arrecadacao, HOJE);
ok('reconhece arrecadação', conta.tipo === 'arrecadacao');
ok('valor 300,98', conta.valor === 300.98);

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log('\nTudo certo.');
