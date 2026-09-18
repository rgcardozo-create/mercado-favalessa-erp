const { faturasAbertas, competenciaDe, vencimentoDaCompetencia, diasDesde } = require('../src/utils/faturasPrazo');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };
const perto = (a, b) => Math.abs(a - b) < 0.011;
const CFG = { diaCorte: 1, diaVencimento: 10, hoje: '2026-09-18' };

console.log('=== competência ===');
ok('corte 1: compra de 15/09 é do mês 09',      competenciaDe('2026-09-15', 1) === '2026-09');
ok('corte 20: compra de 15/09 ainda é de 08',   competenciaDe('2026-09-15', 20) === '2026-08');
ok('corte 20: compra de 25/09 já é de 09',      competenciaDe('2026-09-25', 20) === '2026-09');
ok('janeiro com corte alto volta para dezembro', competenciaDe('2026-01-05', 20) === '2025-12');

console.log('\n=== vencimento ===');
ok('09 vence em 10/10',        vencimentoDaCompetencia('2026-09', 10) === '2026-10-10');
ok('12 vence em janeiro',      vencimentoDaCompetencia('2026-12', 10) === '2027-01-10');
ok('dia 31 em fev vira 28',    vencimentoDaCompetencia('2026-01', 31) === '2026-02-28');
ok('dia 31 em fev bissexto 29', vencimentoDaCompetencia('2024-01', 31) === '2024-02-29');

console.log('\n=== dias ===');
ok('18/09 menos 10/08 = 39 dias', diasDesde('2026-08-10', '2026-09-18') === 39);
ok('data futura não é atraso',    diasDesde('2026-12-01', '2026-09-18') === 0);

console.log('\n=== cliente que não deve nada ===');
const a = faturasAbertas(
  [{ tipo: 'compra', valor: 100, data: '2026-07-05' }, { tipo: 'pagamento', valor: 100, data: '2026-08-10' }],
  CFG
);
ok('nenhuma fatura aberta', a.faturas.length === 0);
ok('situação em dia',       a.situacao === 'em_dia');
ok('sem atraso',            a.atraso_30 === 0);

console.log('\n=== deve, mas ainda não venceu ===');
// compra de setembro fecha em 09 e vence em 10/10 — hoje é 18/09
const b = faturasAbertas([{ tipo: 'compra', valor: 80, data: '2026-09-05' }], CFG);
ok('uma fatura aberta',        b.faturas.length === 1);
ok('vence em 10/10/2026',      b.faturas[0].vencimento === '2026-10-10');
ok('zero dia de atraso',       b.faturas[0].dias_vencida === 0);
ok('situação devendo',         b.situacao === 'devendo');

console.log('\n=== vencida, mas há menos de 30 dias ===');
// julho fecha em 07 e vence em 10/08; de 10/08 a 18/09 são 39 dias -> já passa de 30.
// usar agosto: vence em 10/09, 8 dias atrás
const c = faturasAbertas([{ tipo: 'compra', valor: 50, data: '2026-08-20' }], CFG);
ok('vence em 10/09/2026',        c.faturas[0].vencimento === '2026-09-10');
ok('8 dias de atraso',           c.faturas[0].dias_vencida === 8);
ok('ainda conta como devendo',   c.situacao === 'devendo');
ok('não entra no atraso de 30',  c.atraso_30 === 0);

console.log('\n=== atrasado de verdade ===');
const d = faturasAbertas([{ tipo: 'compra', valor: 120, data: '2026-07-15' }], CFG);
ok('vence em 10/08/2026',   d.faturas[0].vencimento === '2026-08-10');
ok('39 dias de atraso',     d.faturas[0].dias_vencida === 39);
ok('situação atrasado',     d.situacao === 'atrasado');
ok('atraso de 120,00',      perto(d.atraso_30, 120));

console.log('\n=== pagamento abate a fatura mais antiga primeiro ===');
const e = faturasAbertas(
  [
    { tipo: 'compra', valor: 100, data: '2026-07-15' },
    { tipo: 'compra', valor: 100, data: '2026-08-15' },
    { tipo: 'compra', valor: 100, data: '2026-09-15' },
    { tipo: 'pagamento', valor: 150, data: '2026-09-16' },
  ],
  CFG
);
ok('julho sumiu (quitada)',           !e.faturas.some((f) => f.competencia === '2026-07'));
ok('agosto ficou com 50 de saldo',    perto(e.faturas.find((f) => f.competencia === '2026-08').saldo, 50));
ok('setembro intacta, 100',           perto(e.faturas.find((f) => f.competencia === '2026-09').saldo, 100));
ok('duas faturas abertas',            e.faturas.length === 2);
ok('agosto vence 10/09, 8 dias',      e.faturas.find((f) => f.competencia === '2026-08').dias_vencida === 8);
ok('nada com 30+ dias, então devendo', e.situacao === 'devendo');

console.log('\n=== pagou a mais do que devia ===');
const f = faturasAbertas(
  [{ tipo: 'compra', valor: 50, data: '2026-07-10' }, { tipo: 'pagamento', valor: 80, data: '2026-08-01' }],
  CFG
);
ok('nenhuma fatura aberta', f.faturas.length === 0);
ok('situação em dia',       f.situacao === 'em_dia');

console.log('\n=== resto de centavo não vira fatura ===');
const g = faturasAbertas(
  [{ tipo: 'compra', valor: 33.33, data: '2026-07-10' }, { tipo: 'pagamento', valor: 33.33, data: '2026-08-01' }],
  CFG
);
ok('nada aberto', g.faturas.length === 0);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
