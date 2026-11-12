// Baixa pelo relatório de pagamentos do BB: leitura do PDF e casamento com as
// contas. Os casos vêm do que acontece na loja — três parcelas iguais da BRF,
// parcela paga atrasada com juros, o mesmo relatório importado duas vezes.
const { lerRelatorioPagamentosBB } = require('../src/utils/relatorioPagamentosBB');
const { casarPagamentos } = require('../src/utils/casarPagamentos');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };

// ── PDF no formato que o site do BB gera (jsPDF, texto com posição) ────────
const escapar = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const txt = (x, y, t) => `BT\n/F1 9 Tf\n0 g\n${x} ${y} Td\n(${escapar(t)}) Tj\nET\n`;

function pdfDoBB(pagamentos, { total } = {}) {
  let c = txt(325.98, 799.37, 'Relatório de Pagamentos Realizados');
  c += txt(28.35, 674.65, 'Período: 01/10/2026 a 31/10/2026');
  let y = 615.12;
  pagamentos.forEach((p, i) => {
    c += txt(28.35, y, String(i + 1)) + txt(56.69, y, p.data) + txt(107.72, y, p.nome);
    c += txt(311.81, y, p.col3) + txt(510.24, y, `R$ ${p.valor}`);
    c += txt(107.72, y - 8.51, `CNPJ: ${p.cnpj}`) + txt(311.81, y - 8.51, p.tipo) + txt(411.02, y - 8.51, 'Pagamento(Online)');
    y -= 44.5;
  });
  const soma = total || pagamentos.reduce((a, p) => a + Number(p.valor.replace(/\./g, '').replace(',', '.')), 0)
    .toFixed(2).replace('.', ',');
  c += txt(28.35, y, `QUANTIDADE DE PAGAMENTOS: ${pagamentos.length}`) + txt(311.81, y, `VALOR TOTAL: R$ ${soma}`);
  const conteudo = Buffer.from(c, 'latin1');
  return Buffer.concat([
    Buffer.from(`%PDF-1.3\n1 0 obj\n<</Length ${conteudo.length}>>\nstream\n`, 'latin1'),
    conteudo,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

const BRF = { nome: 'BRF S.A.', cnpj: '01.838.723/0001-27', tipo: 'Boleto' };

console.log('=== leitura do PDF ===');
const pdf = pdfDoBB([
  { ...BRF, data: '05/10/2026', col3: 'Nosso Número: 2372190017144614300052730', valor: '153,59' },
  { data: '13/10/2026', nome: 'MINISTERIO DA FAZENDA', col3: 'RFB-DARF CODIGO DE BARRAS', valor: '1.889,10', cnpj: '00.394.460/0033-29', tipo: 'Convênio' },
  { data: '13/10/2026', nome: '', col3: 'OUROCARD EMPRESARIAL ELO', valor: '459,43', cnpj: '00.000.000/0000-00', tipo: 'Pagamento Fatura Cartao' },
]);
const lido = lerRelatorioPagamentosBB(pdf);
ok('3 pagamentos', lido.pagamentos.length === 3);
ok('período lido', lido.periodo.de === '2026-10-01' && lido.periodo.ate === '2026-10-31');
const [b, darf, cartao] = lido.pagamentos;
ok('BRF: data, CNPJ, nosso número, valor',
  b.data === '2026-10-05' && b.cnpj === '01838723000127' && b.nosso_numero === '2372190017144614300052730' && b.valor === 153.59);
ok('DARF: sem nosso número, descrição do convênio, valor com milhar',
  darf.nosso_numero === null && darf.descricao === 'RFB-DARF CODIGO DE BARRAS' && darf.valor === 1889.1 && darf.tipo === 'Convênio');
ok('fatura do cartão: CNPJ zerado vira nulo', cartao.cnpj === null && cartao.tipo === 'Pagamento Fatura Cartao');

let erro = null;
try { lerRelatorioPagamentosBB(pdfDoBB([{ ...BRF, data: '05/10/2026', col3: 'Nosso Número: 1', valor: '10,00' }], { total: '99,00' })); } catch (e) { erro = e.message; }
ok('total que não bate com o rodapé: recusa', /soma/.test(erro || ''));
erro = null;
try { lerRelatorioPagamentosBB(Buffer.from('%PDF-1.3\n%%EOF')); } catch (e) { erro = e.message; }
ok('PDF sem texto (impresso como imagem): recusa explicando', /imagem/.test(erro || ''));

// ── Casamento ───────────────────────────────────────────────────────────────
const CODIGO_BRF = '23791159000000153592372190017144614300052730'; // campo livre = nosso número do BB
const conta = (o) => ({
  quitado: false, codigo_barras: null, nosso_numero: null, pagamentos: [],
  fornecedor_nome: 'BRF', fornecedor_cnpj: '01.838.723/0001-27', descricao: 'BRF', ...o,
  saldo: o.saldo ?? o.valor,
});
const pag = (o) => ({ nome: 'BRF S.A.', cnpj: '01838723000127', tipo: 'Boleto', nosso_numero: null, ...o });

console.log('\n=== 1. código de barras ===');
let r = casarPagamentos(
  [pag({ data: '2026-10-05', valor: 153.59, nosso_numero: '2372190017144614300052730' })],
  [
    conta({ id: 1, valor: 153.59, vencimento: '2026-10-05', codigo_barras: CODIGO_BRF }),
    conta({ id: 2, valor: 153.59, vencimento: '2026-11-05' }),
  ]
);
ok('casa pela barra, não pelo valor', r[0].situacao === 'codigo' && r[0].conta_id === 1);

console.log('\n=== 2. três parcelas iguais, sem código ===');
const tres = [
  conta({ id: 10, valor: 213.02, vencimento: '2026-10-14' }),
  conta({ id: 11, valor: 213.02, vencimento: '2026-10-21' }),
  conta({ id: 12, valor: 213.02, vencimento: '2026-10-28' }),
];
r = casarPagamentos([pag({ data: '2026-10-14', valor: 213.02 }), pag({ data: '2026-10-19', valor: 213.02 })], tres);
ok('primeiro pagamento: escolher, sugere a mais antiga', r[0].situacao === 'escolher' && r[0].conta_id === 10 && r[0].opcoes.length === 3);
ok('segundo pagamento não reaproveita a mesma conta', r[1].conta_id === 11);

console.log('\n=== 3. paga atrasada, com juros ===');
r = casarPagamentos(
  [pag({ data: '2026-10-09', valor: 158.20 })],
  [conta({ id: 20, valor: 153.59, vencimento: '2026-10-05' }), conta({ id: 21, valor: 153.59, vencimento: '2026-11-05' })]
);
ok('casa com a vencida, não com a do mês que vem', r[0].situacao === 'juros' && r[0].conta_id === 20);
ok('mostra os juros: R$ 4,61', r[0].opcoes[0].diferenca === 4.61);
r = casarPagamentos([pag({ data: '2026-10-09', valor: 500 })], [conta({ id: 22, valor: 153.59, vencimento: '2026-10-05' })]);
ok('valor muito acima: não chama de juros, pede para escolher', r[0].situacao === 'escolher' && r[0].conta_id === null);

console.log('\n=== 4. Matias: nosso número digitado à mão ===');
r = casarPagamentos(
  [pag({ nome: 'MATIAS', cnpj: '19067301000160', data: '2026-10-20', valor: 321.87, nosso_numero: '0000000033540180000040410' })],
  [
    conta({ id: 30, fornecedor_nome: 'MATIAS', fornecedor_cnpj: '', valor: 311.52, vencimento: '2026-11-05', nosso_numero: '40435' }),
    conta({ id: 31, fornecedor_nome: 'MATIAS', fornecedor_cnpj: '', valor: 321.87, vencimento: '2026-10-20', nosso_numero: '40410' }),
  ]
);
ok('casa pelo final do nosso número', r[0].situacao === 'nosso_numero' && r[0].conta_id === 31);

console.log('\n=== 5. fornecedor sem CNPJ: pelo nome, só sugestão ===');
r = casarPagamentos(
  [pag({ nome: 'NESTLE BRASIL LTDA.', cnpj: '60409075000152', data: '2026-11-11', valor: 377.52 })],
  [conta({ id: 40, fornecedor_nome: 'NESTLE', fornecedor_cnpj: null, valor: 377.52, vencimento: '2026-11-11' })]
);
ok('situação pelo nome, com a conta sugerida', r[0].situacao === 'pelo_nome' && r[0].conta_id === 40);
r = casarPagamentos(
  [pag({ nome: 'NESTLE BRASIL LTDA.', cnpj: '60409075000152', data: '2026-11-11', valor: 377.52 })],
  [conta({ id: 41, fornecedor_nome: 'PEPSICO', fornecedor_cnpj: null, valor: 377.52, vencimento: '2026-11-11' })]
);
ok('nome diferente com mesmo valor: não casa', r[0].situacao === 'sem_cadastro');

console.log('\n=== 6. não duplica ===');
const p1 = pag({ data: '2026-10-05', valor: 153.59, nosso_numero: '2372190017144614300052730' });
const primeira = casarPagamentos([p1], [conta({ id: 50, valor: 153.59, vencimento: '2026-10-05' })]);
r = casarPagamentos([p1], [conta({ id: 50, valor: 153.59, vencimento: '2026-10-05' })], new Set([primeira[0].ref]));
ok('mesmo relatório de novo: já importado', r[0].situacao === 'ja_importado');
r = casarPagamentos([p1], [conta({ id: 51, valor: 153.59, saldo: 0, quitado: true, vencimento: '2026-10-05', codigo_barras: CODIGO_BRF })]);
ok('boleto do código já quitado: não baixa de novo', r[0].situacao === 'ja_baixado');
r = casarPagamentos(
  [pag({ data: '2026-10-07', valor: 195.27 })],
  [conta({ id: 52, valor: 195.27, saldo: 0, quitado: true, vencimento: '2026-10-07',
    pagamentos: [{ data_pagamento: '2026-10-07', valor: 195.27 }] })]
);
ok('baixado à mão antes, mesma data e valor: já baixado', r[0].situacao === 'ja_baixado');
const darfs = casarPagamentos(
  [1, 2, 3].map(() => ({ data: '2026-10-13', nome: 'MINISTERIO DA FAZENDA', cnpj: '00394460003329', valor: 300.98, tipo: 'Convênio', nosso_numero: null })),
  []
);
ok('três DARF iguais no mesmo dia: referências diferentes', new Set(darfs.map((d) => d.ref)).size === 3);
ok('DARF sem cadastro', darfs.every((d) => d.situacao === 'sem_cadastro'));

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log('\nTudo certo.');
