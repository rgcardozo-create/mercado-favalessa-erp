// Cálculo de horas extras, adicional de domingo/feriado e o DSR que vem junto.
//
// O que este arquivo NÃO faz, de propósito: descontar INSS e IRRF. As tabelas
// mudam todo ano e dependem do total do mês inteiro, não desta verba isolada.
// O que sai daqui é o valor BRUTO da hora extra — que é o número que o dono
// precisa para saber quanto separar e para conferir o que o contador mandou.
//
// Cada linha do resultado carrega a própria conta em texto. Número sem origem
// não se confere, e o objetivo aqui é justamente poder conferir.

const centavos = (n) => Math.round(n * 100) / 100;

// Domingos do mês. O DSR (descanso semanal remunerado) incide sobre os
// domingos e feriados; os feriados entram por fora porque variam por cidade e
// o sistema não tem calendário municipal — quem sabe que dia 8 de setembro é
// feriado na cidade é quem mora nela.
function domingosDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const dias = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  let domingos = 0;
  for (let d = 1; d <= dias; d += 1) {
    if (new Date(Date.UTC(ano, m - 1, d)).getUTCDay() === 0) domingos += 1;
  }
  return { dias, domingos };
}

// Dias úteis para o DSR: o mês inteiro menos os domingos e feriados. O sábado
// conta como útil nesta conta, mesmo quando não se trabalha nele — é assim que
// a Súmula 172 do TST manda dividir.
function baseDoMes(mes, feriados = 0) {
  const { dias, domingos } = domingosDoMes(mes);
  const descanso = domingos + Number(feriados || 0);
  return { dias, domingos, feriados: Number(feriados || 0), descanso, uteis: dias - descanso };
}

function calcularHoras({
  salarioBase,
  mes,
  divisorHoras,
  horasNormais = 0,
  percentualNormal,
  horasDomingo = 0,
  percentualDomingo,
  feriadosNoMes = 0,
  diasFeriadoTrabalhado = 0,
}) {
  const salario = Number(salarioBase) || 0;
  const divisor = Number(divisorHoras) || 220;
  const valorHora = centavos(salario / divisor);
  const valorDia = centavos(salario / 30);

  const base = baseDoMes(mes, feriadosNoMes);
  const linhas = [];

  const hn = Number(horasNormais) || 0;
  const pn = Number(percentualNormal) || 0;
  let totalExtras = 0;
  if (hn > 0) {
    const valor = centavos(hn * valorHora * (1 + pn / 100));
    totalExtras += valor;
    linhas.push({
      rotulo: `Horas extras (${pn}%)`,
      detalhe: `${hn} h × ${valorHora.toFixed(2)} × ${(1 + pn / 100).toFixed(2)}`,
      valor,
    });
  }

  const hd = Number(horasDomingo) || 0;
  const pd = Number(percentualDomingo) || 0;
  if (hd > 0) {
    const valor = centavos(hd * valorHora * (1 + pd / 100));
    totalExtras += valor;
    linhas.push({
      rotulo: `Horas em domingo ou feriado (${pd}%)`,
      detalhe: `${hd} h × ${valorHora.toFixed(2)} × ${(1 + pd / 100).toFixed(2)}`,
      valor,
    });
  }

  // DSR sobre as extras: é a parte que mais se esquece de pagar. A hora extra
  // aumenta o salário da semana, e o descanso daquela semana tem que subir na
  // mesma proporção — senão o domingo do funcionário fica valendo menos que o
  // dele mesmo trabalhando.
  let dsr = 0;
  if (totalExtras > 0 && base.uteis > 0) {
    dsr = centavos((totalExtras / base.uteis) * base.descanso);
    linhas.push({
      rotulo: 'DSR sobre as horas extras',
      detalhe: `${totalExtras.toFixed(2)} ÷ ${base.uteis} dias úteis × ${base.descanso} de descanso`,
      valor: dsr,
    });
  }

  // Feriado trabalhado e não compensado com folga se paga em dobro: o dia
  // normal já está no salário, então o que falta pagar é mais um dia.
  const df = Number(diasFeriadoTrabalhado) || 0;
  let feriado = 0;
  if (df > 0) {
    feriado = centavos(df * valorDia);
    linhas.push({
      rotulo: 'Feriado trabalhado sem folga (dobro)',
      detalhe: `${df} dia(s) × ${valorDia.toFixed(2)} — o dia normal já está no salário, este é o segundo`,
      valor: feriado,
    });
  }

  const total = centavos(totalExtras + dsr + feriado);

  return {
    valor_hora: valorHora,
    valor_dia: valorDia,
    base_do_mes: base,
    linhas,
    total,
  };
}

module.exports = { calcularHoras, baseDoMes };
