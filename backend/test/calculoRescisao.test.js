const { calcularRescisao, diasDeAviso, avos, periodoEmAberto } = require('../src/utils/calculoRescisao');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };
const perto = (a, b) => Math.abs(a - b) < 0.011;
const tem = (r, pedaco) => [...r.proventos, ...r.descontos].some((l) => l.rotulo.includes(pedaco));
const valorDe = (r, pedaco) => {
  const l = [...r.proventos, ...r.descontos].find((x) => x.rotulo.includes(pedaco));
  return l ? l.valor : null;
};

console.log('=== aviso prévio (Lei 12.506/2011) ===');
ok('menos de 1 ano: 30 dias',  diasDeAviso('2026-01-01', '2026-06-01') === 30);
ok('1 ano completo: 33 dias',  diasDeAviso('2025-06-01', '2026-06-01') === 33);
ok('5 anos: 45 dias',          diasDeAviso('2021-06-01', '2026-06-01') === 45);
ok('20 anos: 90 dias (teto)',  diasDeAviso('2006-06-01', '2026-06-01') === 90);
ok('30 anos não passa de 90',  diasDeAviso('1996-06-01', '2026-06-01') === 90);

console.log('\n=== avos (15 dias fazem o mês) ===');
ok('ano inteiro: 12',                avos('2026-01-01', '2026-12-31') === 12);
ok('mês com 14 dias não conta',      avos('2026-01-18', '2026-01-31') === 0);
ok('mês com 15 dias conta',          avos('2026-01-17', '2026-01-31') === 1);
ok('nunca passa de 12',              avos('2020-01-01', '2026-12-31') === 12);
ok('data final antes da inicial: 0', avos('2026-05-01', '2026-01-01') === 0);

// Caso base de todos os testes: salário 2.000, admitido 10/03/2023,
// sai 20/06/2026. Casa: 3 anos completos -> aviso de 30 + 9 = 39 dias.
const caso = { salarioBase: 2000, admissao: '2023-03-10', saida: '2026-06-20' };

console.log('\n=== dispensa sem justa causa ===');
// À mão:
//   saldo   = 2000/30 x 20 dias           = 1.333,33
//   aviso   = 2000/30 x 39                = 2.600,00
//   projeção: 20/06 + 39 dias             = 29/07/2026
//   13º     = jan..jul = 7 avos           = 2000/12 x 7  = 1.166,67
//   período aberto desde 10/03/2026; até 29/07 dá 5 avos (mar 22d, abr, mai, jun, jul 29d)
//   férias  = 2000/12 x 5 = 833,33 ; terço = 277,78
//   multa   = 40% de 12.000              = 4.800,00
const a = calcularRescisao({ ...caso, motivo: 'sem_justa_causa', saldoFgts: 12000 });
ok('aviso de 39 dias',            a.dias_aviso === 39);
ok('projeta até 29/07/2026',      a.fim_contado === '2026-07-29');
ok('saldo de salário 1.333,33',   perto(valorDe(a, 'Saldo de salário'), 1333.33));
ok('aviso indenizado 2.600,00',   perto(valorDe(a, 'Aviso prévio indenizado'), 2600));
ok('13º de 7/12 = 1.166,67',      perto(valorDe(a, '13º proporcional'), 1166.67));
ok('férias proporcionais 5/12',   a.meses_ferias_proporcionais === 5);
ok('férias prop. = 833,33',       perto(valorDe(a, 'Férias proporcionais'), 833.33));
ok('terço das proporcionais',     perto(valorDe(a, 'terço sobre as proporcionais'), 277.78));
ok('multa de 40% = 4.800,00',     perto(valorDe(a, 'Multa de 40%'), 4800));
ok('nada descontado',             a.total_descontos === 0);
ok('total = soma dos proventos',  perto(a.total, 1333.33 + 2600 + 1166.67 + 833.33 + 277.78 + 4800));

console.log('\n=== pedido de demissão ===');
const b = calcularRescisao({ ...caso, motivo: 'pedido', saldoFgts: 12000 });
ok('sem aviso indenizado',        !tem(b, 'Aviso prévio indenizado'));
ok('desconta 30 dias de aviso',   perto(valorDe(b, 'não cumprido'), 2000));
ok('sem multa de FGTS',           !tem(b, 'Multa'));
ok('mantém 13º proporcional',     tem(b, '13º proporcional'));
ok('mantém férias proporcionais', tem(b, 'Férias proporcionais'));
ok('sem projeção do aviso',       b.fim_contado === '2026-06-20');
ok('13º cai para 6/12',           perto(valorDe(b, '13º proporcional'), 1000));

const bCumpriu = calcularRescisao({ ...caso, motivo: 'pedido', avisoCumprido: true });
ok('cumprindo o aviso, nada é descontado', bCumpriu.total_descontos === 0);

console.log('\n=== justa causa ===');
const c = calcularRescisao({ ...caso, motivo: 'justa_causa', saldoFgts: 12000, feriasVencidasDias: 30 });
ok('sem 13º proporcional',        !tem(c, '13º proporcional'));
ok('sem férias proporcionais',    !tem(c, 'Férias proporcionais'));
ok('sem multa de FGTS',           !tem(c, 'Multa'));
ok('sem aviso dos dois lados',    !tem(c, 'Aviso'));
ok('MAS paga férias vencidas',    perto(valorDe(c, 'Férias vencidas'), 2000));
ok('e o terço delas',             perto(valorDe(c, 'terço sobre as férias vencidas'), 666.67));
ok('e o saldo de salário',        perto(valorDe(c, 'Saldo de salário'), 1333.33));
ok('total = 1333,33+2000+666,67', perto(c.total, 4000));

console.log('\n=== acordo (art. 484-A) ===');
const d = calcularRescisao({ ...caso, motivo: 'acordo', saldoFgts: 12000 });
ok('aviso pela metade: 20 dias',  perto(valorDe(d, 'metade'), centavos(2000 / 30 * 20)));
ok('multa cai para 20%',          perto(valorDe(d, 'Multa de 20%'), 2400));
ok('mantém 13º e férias',         tem(d, '13º proporcional') && tem(d, 'Férias proporcionais'));
function centavos(n) { return Math.round(n * 100) / 100; }

console.log('\n=== fim da experiência ===');
const e = calcularRescisao({ salarioBase: 2000, admissao: '2026-04-01', saida: '2026-06-30', motivo: 'fim_experiencia' });
ok('sem aviso',                   !tem(e, 'Aviso'));
ok('sem multa',                   !tem(e, 'Multa'));
ok('com 13º proporcional',        tem(e, '13º proporcional'));
ok('com férias proporcionais',    tem(e, 'Férias proporcionais'));

console.log('\n=== FGTS não informado: não inventa ===');
const f = calcularRescisao({ ...caso, motivo: 'sem_justa_causa' });
ok('sem saldo, sem linha de multa', !tem(f, 'Multa'));
ok('e a tela fica sabendo disso',   f.regra.fgts_informado === false);
ok('mas continua devendo 40%',      f.regra.multa_fgts === 40);

console.log('\n=== média de hora extra entra na base ===');
const g = calcularRescisao({ ...caso, motivo: 'sem_justa_causa', mediaVariaveis: 300 });
ok('base vira 2.300', perto(g.base, 2300));
ok('tudo sobe junto',  g.total > f.total);

console.log('\n=== sem data de admissão ===');
const h = calcularRescisao({ salarioBase: 2000, saida: '2026-06-20', motivo: 'sem_justa_causa' });
ok('aviso volta ao mínimo de 30',     h.dias_aviso === 30);
ok('período aberto fica nulo',        h.periodo_aberto === null);
ok('sem período, sem proporcionais',  !tem(h, 'Férias proporcionais'));
ok('mas saldo e aviso saem',          tem(h, 'Saldo de salário') && tem(h, 'Aviso prévio indenizado'));

console.log('\n=== proventos e descontos nunca se misturam ===');
ok('desconto não entra nos proventos', b.proventos.every((l) => !l.rotulo.includes('não cumprido')));
ok('total = proventos - descontos',    perto(b.total, b.total_proventos - b.total_descontos));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
