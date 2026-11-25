const { avos } = require('./calculoRescisao');

// 13º salário (Lei 4.090/62 e Lei 4.749/65).
//
// - Vale 1/12 do salário por mês trabalhado no ano ("avos"), contando o mês em
//   que se trabalhou 15 dias ou mais — a mesma régua já usada na rescisão.
// - É pago em duas parcelas: a 1ª entre fevereiro e 30 de novembro, a metade do
//   13º, sem desconto nenhum; a 2ª até 20 de dezembro, o resto, e é nela que se
//   descontam INSS e IRRF (sobre o 13º inteiro).
// - Pode ser pago de uma vez, em parcela única, até 30 de novembro.
//
// Aqui só se calcula a SUGESTÃO do valor. Quem lança confere: salário que
// mudou no ano, média de horas extras e comissões entram no 13º e o sistema não
// sabe delas.

const TIPOS_DECIMO = {
  '13_1': '13º — 1ª parcela',
  '13_2': '13º — 2ª parcela',
  '13_unica': '13º — parcela única',
};

const arredondar = (n) => Math.round(n * 100) / 100;

/**
 * @param salario    salário base do funcionário
 * @param admissao   data de admissão (YYYY-MM-DD), ou nula
 * @param ano        ano do 13º
 * @param lancados   { '13_1': soma lançada, '13_2': ..., '13_unica': ... } neste ano
 */
function calcularDecimoTerceiro({ salario, admissao, ano, lancados = {} }) {
  const base = Number(salario) || 0;
  const inicioAno = `${ano}-01-01`;
  const fimAno = `${ano}-12-31`;
  // Admitido depois do ano: não tem 13º neste ano.
  const inicio = admissao && admissao > inicioAno ? admissao : inicioAno;
  const meses = inicio > fimAno ? 0 : avos(inicio, fimAno);

  const total = arredondar((base * meses) / 12);
  const primeira = arredondar(Number(lancados['13_1']) || 0);
  const segunda = arredondar(Number(lancados['13_2']) || 0);
  const unica = arredondar(Number(lancados['13_unica']) || 0);
  const jaLancado = arredondar(primeira + segunda + unica);

  return {
    ano,
    salario: base,
    admissao: admissao || null,
    meses,
    total,
    lancado: { '13_1': primeira, '13_2': segunda, '13_unica': unica, total: jaLancado },
    sugestao: {
      // A 1ª parcela é a metade do 13º.
      '13_1': primeira || unica ? 0 : arredondar(total / 2),
      // A 2ª é o que falta depois da 1ª (os descontos vão no campo Descontos).
      '13_2': unica ? 0 : Math.max(0, arredondar(total - primeira - segunda)),
      '13_unica': primeira || segunda || unica ? 0 : total,
    },
  };
}

module.exports = { calcularDecimoTerceiro, TIPOS_DECIMO };
