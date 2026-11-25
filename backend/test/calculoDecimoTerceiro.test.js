const { calcularDecimoTerceiro } = require('../src/utils/calculoDecimoTerceiro');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };

console.log('=== 13º salário ===');
const anoInteiro = calcularDecimoTerceiro({ salario: 2400, admissao: '2021-11-03', ano: 2026 });
ok('admitido antes do ano: 12 avos', anoInteiro.meses === 12);
ok('13º do ano inteiro = um salário', anoInteiro.total === 2400);
ok('1ª parcela sugerida é a metade', anoInteiro.sugestao['13_1'] === 1200);
ok('2ª parcela sugerida, sem 1ª lançada, é o total', anoInteiro.sugestao['13_2'] === 2400);
ok('parcela única é o total', anoInteiro.sugestao['13_unica'] === 2400);

const admitido = calcularDecimoTerceiro({ salario: 1850, admissao: '2026-02-10', ano: 2026 });
ok('admitido em 10/02: fevereiro conta (19 dias), 11 avos', admitido.meses === 11);
ok('proporcional: 1850 × 11/12', admitido.total === 1695.83);

const tarde = calcularDecimoTerceiro({ salario: 1800, admissao: '2026-03-20', ano: 2026 });
ok('admitido em 20/03: março não conta (12 dias), 9 avos', tarde.meses === 9);

const semAdmissao = calcularDecimoTerceiro({ salario: 2000, admissao: null, ano: 2026 });
ok('sem data de admissão: ano inteiro', semAdmissao.meses === 12 && semAdmissao.total === 2000);

const futuro = calcularDecimoTerceiro({ salario: 2000, admissao: '2027-01-05', ano: 2026 });
ok('admitido depois do ano: sem 13º', futuro.meses === 0 && futuro.total === 0);

const comPrimeira = calcularDecimoTerceiro({ salario: 2400, admissao: '2021-11-03', ano: 2026, lancados: { '13_1': 1200 } });
ok('com a 1ª lançada, a 2ª é o que falta', comPrimeira.sugestao['13_2'] === 1200);
ok('com a 1ª lançada, não sugere outra 1ª', comPrimeira.sugestao['13_1'] === 0);
ok('com a 1ª lançada, não sugere parcela única', comPrimeira.sugestao['13_unica'] === 0);
ok('soma do que já foi lançado', comPrimeira.lancado.total === 1200);

const unica = calcularDecimoTerceiro({ salario: 2400, admissao: '2021-11-03', ano: 2026, lancados: { '13_unica': 2400 } });
ok('pago em parcela única: nada mais a sugerir', unica.sugestao['13_1'] === 0 && unica.sugestao['13_2'] === 0);

const semSalario = calcularDecimoTerceiro({ salario: null, admissao: '2021-01-01', ano: 2026 });
ok('sem salário base cadastrado: zero, sem erro', semSalario.total === 0);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
