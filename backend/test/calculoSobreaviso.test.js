const { calcularSobreaviso } = require('../src/utils/calculoSobreaviso');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };
const perto = (a, b) => Math.abs(a - b) < 0.005;

// Novembro/2026: 30 dias, 5 domingos (1, 8, 15, 22, 29) → 25 úteis.
// Salário 2.200 ÷ 220 = hora de 10,00.
const base = { salarioBase: 2200, mes: '2026-11', divisorHoras: 220, percentualAcionado: 50, percentualDomingo: 100 };

console.log('=== só espera: 72 h de sobreaviso, ninguém chamou ===');
// À mão: 72 × 10 × 1/3 = 240,00
//        DSR = 240 ÷ 25 × 5 = 48,00
//        total = 288,00
const a = calcularSobreaviso({ ...base, horasSobreaviso: 72, percentualSobreaviso: 33.33 });
ok('sobreaviso é 1/3 da hora: 240,00', perto(a.linhas[0].valor, 240));
ok('rótulo diz 1/3',                    a.linhas[0].rotulo.includes('1/3'));
ok('DSR 48,00',                         perto(a.linhas[1].valor, 48));
ok('total 288,00',                      perto(a.total, 288));

console.log('\n=== 33,33% vira o terço exato ===');
// 100 h × 10 × 1/3 = 333,33 — com 0,3333 daria 333,30.
const t = calcularSobreaviso({ ...base, horasSobreaviso: 100, percentualSobreaviso: 33.33 });
ok('100 h dão 333,33', perto(t.linhas[0].valor, 333.33));

console.log('\n=== chamado para trabalhar: a hora sai do sobreaviso e vira extra ===');
// 72 h de escala, 6 h trabalhadas em dia comum e 2 h num domingo.
// Espera: (72 − 8) × 10 × 1/3 = 213,33
// Comum:  6 × 10 × 1,5 = 90,00
// Domingo: 2 × 10 × 2 = 40,00
// DSR: 343,33 ÷ 25 × 5 = 68,67
// Total: 412,00
const b = calcularSobreaviso({
  ...base, horasSobreaviso: 72, percentualSobreaviso: 33.33, horasAcionado: 6, horasAcionadoDomingo: 2,
});
ok('sobra 64 h de espera',          b.horas.so_espera === 64);
ok('espera 213,33',                 perto(b.linhas[0].valor, 213.33));
ok('trabalhadas comuns 90,00',      perto(b.linhas[1].valor, 90));
ok('trabalhadas em domingo 40,00',  perto(b.linhas[2].valor, 40));
ok('DSR 68,67',                     perto(b.linhas[3].valor, 68.67));
ok('total 412,00',                  perto(b.total, 412));

console.log('\n=== feriado no mês muda o DSR ===');
// 2 feriados: 7 de descanso, 23 úteis. DSR = 240 ÷ 23 × 7 = 73,04
const f = calcularSobreaviso({ ...base, horasSobreaviso: 72, percentualSobreaviso: 33.33, feriadosNoMes: 2 });
ok('DSR 73,04', perto(f.linhas[1].valor, 73.04));

console.log('\n=== convenção que paga mais que 1/3 ===');
// 72 × 10 × 0,5 = 360,00
const c = calcularSobreaviso({ ...base, horasSobreaviso: 72, percentualSobreaviso: 50 });
ok('50% da hora: 360,00', perto(c.linhas[0].valor, 360));
ok('rótulo diz 50,00%',   c.linhas[0].rotulo.includes('50,00%'));

console.log('\n=== trabalhou mais horas do que estava de sobreaviso ===');
let erro = null;
try { calcularSobreaviso({ ...base, horasSobreaviso: 5, horasAcionado: 6 }); } catch (e) { erro = e; }
ok('recusa a conta', erro && erro.status === 400);

console.log('\n=== chamado a escala inteira: não sobra espera ===');
const g = calcularSobreaviso({ ...base, horasSobreaviso: 6, percentualSobreaviso: 33.33, horasAcionado: 6 });
ok('sem linha de sobreaviso', !g.linhas.some((l) => l.rotulo.startsWith('Sobreaviso')));
ok('só as 6 h trabalhadas e o DSR: 90 + 18 = 108', perto(g.total, 108));

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nTudo certo.');
