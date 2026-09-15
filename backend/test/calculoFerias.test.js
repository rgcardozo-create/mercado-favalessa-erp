const { calcularFerias, diasDeDireito, periodoAquisitivo, somarAnos, somarDias } = require('../src/utils/calculoFerias');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };
const perto = (a, b) => Math.abs(a - b) < 0.005;

console.log('=== datas ===');
ok('1 ano depois de 15/03/2023', somarAnos('2023-03-15', 1) === '2024-03-15');
ok('29/02 + 1 ano vira 28/02', somarAnos('2024-02-29', 1) === '2025-02-28');
ok('29/02 + 4 anos continua 29/02', somarAnos('2024-02-29', 4) === '2028-02-29');
ok('dia anterior atravessa o mês', somarDias('2024-03-01', -1) === '2024-02-29');
ok('30 dias depois atravessa o ano', somarDias('2025-12-20', 30) === '2026-01-19');

console.log('\n=== dias de direito (CLT art. 130) ===');
ok('sem faltas: 30 dias', diasDeDireito(0) === 30);
ok('5 faltas ainda são 30', diasDeDireito(5) === 30);
ok('6 faltas caem para 24', diasDeDireito(6) === 24);
ok('14 faltas: 24', diasDeDireito(14) === 24);
ok('15 faltas: 18', diasDeDireito(15) === 18);
ok('23 faltas: 18', diasDeDireito(23) === 18);
ok('24 faltas: 12', diasDeDireito(24) === 12);
ok('32 faltas: 12', diasDeDireito(32) === 12);
ok('33 faltas: perde o período', diasDeDireito(33) === 0);

console.log('\n=== período aquisitivo ===');
const p = periodoAquisitivo('2023-03-15', '2026-09-20');
ok('último período fechado começa em 15/03/2025', p.de === '2025-03-15');
ok('e termina em 14/03/2026',                     p.ate === '2026-03-14');
ok('está completo',                               p.completo === true);
ok('prazo para conceder vai até 14/03/2027',      p.concessivo_ate === '2027-03-14');

const novo = periodoAquisitivo('2026-05-01', '2026-09-20');
ok('quem tem 4 meses de casa ainda não fechou o período', novo.completo === false);
ok('e o período dele vai até 30/04/2027',                 novo.ate === '2027-04-30');

console.log('\n=== conta de férias: 30 dias, salário 2.000 ===');
// À mão: férias = 2000 x 30 / 30 = 2.000,00  (o mês inteiro é o próprio salário)
//        terço  = 2.000,00 / 3 = 666,67
//        total  = 2.666,67
const a = calcularFerias({ salarioBase: 2000, inicio: '2026-10-01', diasGozo: 30 });
ok('valor do dia 66,67',   perto(a.valor_dia, 66.67));
ok('férias 2.000,00',      perto(a.linhas[0].valor, 2000.00));
ok('terço 666,67',         perto(a.linhas[1].valor, 666.67));
ok('total 2.666,67',       perto(a.total, 2666.67));
ok('volta em 31/10/2026',  a.retorno === '2026-10-31');
ok('pagar até 29/09/2026', a.pagar_ate === '2026-09-29');

console.log('\n=== vendendo 10 dias (abono), gozando 20 ===');
// férias = 2000x20/30 = 1.333,33; terço = 444,44
// abono  = 2000x10/30 =   666,67; terço do abono = 222,22
// total  = 1333,33 + 444,44 + 666,67 + 222,22 = 2.666,66 (um centavo do de cima,
// diferença própria do arredondamento e não de regra diferente)
const b = calcularFerias({ salarioBase: 2000, inicio: '2026-10-01', diasGozo: 20, diasAbono: 10 });
ok('férias 1.333,33',        perto(b.linhas[0].valor, 1333.33));
ok('terço 444,44',           perto(b.linhas[1].valor, 444.44));
ok('abono 666,67',           perto(b.linhas[2].valor, 666.67));
ok('terço do abono 222,22',  perto(b.linhas[3].valor, 222.22));
ok('total fica a um centavo do de 30 dias de gozo', Math.abs(b.total - a.total) < 0.011);
ok('volta em 21/10, não em 31', b.retorno === '2026-10-21');

console.log('\n=== média de hora extra entra na base (art. 142) ===');
// base = 2000 + 300 = 2300; férias = 2.300,00; terço = 766,67
const c = calcularFerias({ salarioBase: 2000, mediaVariaveis: 300, inicio: '2026-10-01', diasGozo: 30 });
ok('base 2.300,00',  perto(c.base, 2300));
ok('dia 76,67',      perto(c.valor_dia, 76.67));
ok('total 3.066,67', perto(c.total, 3066.67));
ok('é maior que sem a média', c.total > a.total);

console.log('\n=== adiantamento de metade do 13º ===');
// metade do 13º sai do salário, sem a média: 2000/2 = 1000
const d = calcularFerias({ salarioBase: 2000, mediaVariaveis: 300, inicio: '2026-10-01', diasGozo: 30, adiantar13: true });
ok('adiantamento 1.000,00', perto(d.linhas[d.linhas.length - 1].valor, 1000));
ok('total soma o adiantamento', perto(d.total, c.total + 1000));

console.log('\n=== dobro do art. 137, quando o dono marca ===');
const e = calcularFerias({ salarioBase: 2000, inicio: '2026-10-01', diasGozo: 30, pagarEmDobro: true });
ok('dobro = férias + terço', perto(e.linhas[2].valor, 2666.67));
ok('total é o dobro exato',  perto(e.total, 5333.34));
const semDobro = calcularFerias({ salarioBase: 2000, inicio: '2026-10-01', diasGozo: 30, pagarEmDobro: false });
ok('sem marcar, não dobra nada', perto(semDobro.total, 2666.67));

console.log('\n=== faltas derrubam os dias de direito ===');
const f = calcularFerias({ salarioBase: 2000, inicio: '2026-10-01', diasGozo: 18, faltas: 16 });
ok('16 faltas dão direito a 18 dias', f.dias_direito === 18);
ok('férias de 18 dias: 1.200,00',     perto(f.linhas[0].valor, 1200.00));

console.log('\n=== sem data de admissão, calcula mesmo assim ===');
const g = calcularFerias({ salarioBase: 2000, inicio: '2026-10-01', diasGozo: 30 });
ok('período fica nulo em vez de inventado', g.periodo_aquisitivo === null);
ok('mas a conta sai', perto(g.total, 2666.67));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
