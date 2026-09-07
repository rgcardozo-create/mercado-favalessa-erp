const fs = require('fs');
const { lerExtratoBanco, chaveDe, lerValor, lerData, formaDe } = require('../src/utils/extratoBanco');
const brl = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };

(async () => {
  console.log('=== peças isoladas ===');
  ok('valor "1.067,79 C" é entrada', JSON.stringify(lerValor('1.067,79 C')) === '{"valor":1067.79,"saida":false}');
  ok('valor "4.133,11 D" é SAÍDA',   JSON.stringify(lerValor('4.133,11 D')) === '{"valor":4133.11,"saida":true}');
  ok('valor "0,00 C" lido',          lerValor('0,00 C').valor === 0);
  ok('valor lixo devolve null',      lerValor('abc') === null);
  ok('data 15/06/2026',              lerData('15/06/2026') === '2026-06-15');
  ok('data como Date não escorrega', lerData(new Date(2026, 5, 15)) === '2026-06-15');
  ok('forma de Pix - Enviado',       formaDe('Pix - Enviado') === 'PIX');
  ok('forma de Pagamento de Boleto', formaDe('Pagamento de Boleto') === 'Boleto');
  ok('forma desconhecida vira Transferência', formaDe('BB GIRO FGO PRONAMPE') === 'Transferência');
  console.log('  chave junta os Pix da noite:',
    chaveDe('Pix - Enviado', '01/06 21:07 Favalessa') === chaveDe('Pix - Enviado', '29/06 21:51 Favalessa'));
  console.log('  chave junta as tarifas:',
    chaveDe('Tarifa Pix Enviado', 'Tar. agrupadas - ocorrencia 29/05/2026') === chaveDe('Tarifa Pix Enviado', 'Tar. agrupadas - ocorrencia 03/06/2026'));
  console.log('  chave separa Pix enviado de recebido:',
    chaveDe('Pix - Enviado', 'Favalessa') !== chaveDe('Pix - Recebido', 'Favalessa'));

  // O extrato de verdade não entra no repositório — é movimentação bancária. Para
  // rodar esta parte, aponte EXTRATO_BANCO_TESTE para um arquivo local:
  //   EXTRATO_BANCO_TESTE=/caminho/extrato.xlsx node backend/test/extratoBanco.test.js
  const caminho = process.env.EXTRATO_BANCO_TESTE;
  if (!caminho || !fs.existsSync(caminho)) {
    console.log('\n(sem EXTRATO_BANCO_TESTE apontado — a parte do arquivo real não rodou)');
    console.log(falhas ? `\n${falhas} FALHA(S)` : '\nAs peças isoladas conferem.');
    process.exit(falhas ? 1 : 0);
  }

  console.log('\n=== arquivo de verdade ===');
  const buf = fs.readFileSync(caminho);
  const r = await lerExtratoBanco(buf, caminho);
  ok('reconheceu as colunas', r.reconhecido);
  console.log('  cabeçalho na linha', r.linha_cabecalho, '| mapa:', JSON.stringify(r.mapa));
  console.log('  colunas:', r.colunas.map(c => c.titulo).join(' | '));
  ok('64 saídas (as mesmas da conferência manual)', r.saidas.length === 64);
  const total = r.saidas.reduce((a, s) => a + s.valor, 0);
  ok(`soma das saídas = R$ 55.829,16 (deu ${brl(total)})`, Math.abs(total - 55829.16) < 0.01);
  console.log('  ignoradas:', JSON.stringify(r.ignoradas));
  ok('nenhuma linha de saldo virou saída', !r.saidas.some(s => /saldo/i.test(s.lancamento)));
  ok('nenhum crédito virou saída', r.saidas.every(s => s.valor > 0));

  const chaves = new Set(r.saidas.map(s => s.chave));
  ok(`16 chaves distintas (deu ${chaves.size})`, chaves.size === 16);
  const impressoes = new Set(r.saidas.map(s => s.impressao));
  ok(`64 impressões digitais únicas (deu ${impressoes.size}) — reimportar não duplica`, impressoes.size === 64);

  console.log('\n  as 5 maiores saídas:');
  [...r.saidas].sort((a,b)=>b.valor-a.valor).slice(0,5).forEach(s =>
    console.log(`   ${s.data} ${brl(s.valor).padStart(13)} ${s.forma.padEnd(14)} ${s.chave.slice(0,52)}`));

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo confere.');
  process.exit(falhas ? 1 : 0);
})();
