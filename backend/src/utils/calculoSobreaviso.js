// Sobreaviso (CLT art. 244, § 2º, aplicado por analogia pela Súmula 428 do TST).
//
// Sobreaviso é o tempo em que o funcionário fica fora do mercado, mas à
// disposição: com o celular ligado, sem poder viajar, esperando ser chamado.
// Ele não está trabalhando, mas também não está livre — por isso a lei paga
// essas horas a 1/3 da hora normal, e não inteiras.
//
// Quando ele é CHAMADO e vai trabalhar, aquelas horas deixam de ser sobreaviso
// e passam a ser hora trabalhada, paga como hora extra. As duas coisas não se
// somam sobre a mesma hora: a hora acionada sai do sobreaviso e entra como
// extra. Pagar as duas seria pagar 1/3 + 150% pela mesma hora.
//
// Mesma régua das outras calculadoras: devolve o BRUTO, linha por linha, com a
// conta escrita ao lado. INSS e IR dependem do mês inteiro e ficam com o
// contador.

const { baseDoMes } = require('./calculoHoras');

const centavos = (n) => Math.round(n * 100) / 100;

// A escala de sobreaviso tem no máximo 24 horas seguidas (art. 244, § 2º).
// O limite é por escala, não por mês — o sistema só recebe o total do mês e
// não tem como conferir isso; fica o aviso na tela.
const ESCALA_MAXIMA_HORAS = 24;

function calcularSobreaviso({
  salarioBase,
  mes,
  divisorHoras,
  horasSobreaviso = 0,
  percentualSobreaviso,
  horasAcionado = 0,
  percentualAcionado,
  horasAcionadoDomingo = 0,
  percentualDomingo,
  feriadosNoMes = 0,
}) {
  const salario = Number(salarioBase) || 0;
  const divisor = Number(divisorHoras) || 220;
  const valorHora = centavos(salario / divisor);

  const hs = Number(horasSobreaviso) || 0;
  const ha = Number(horasAcionado) || 0;
  const had = Number(horasAcionadoDomingo) || 0;
  const ps = Number(percentualSobreaviso);
  const pa = Number(percentualAcionado) || 0;
  const pd = Number(percentualDomingo) || 0;
  // O 1/3 da lei vira 33,33% no campo da tela; a conta usa o terço exato,
  // senão 100 horas dariam três centavos a menos que a conta do contador.
  let fracao = (Number.isFinite(ps) ? ps : 100 / 3) / 100;
  const umTerco = Math.abs(fracao - 1 / 3) < 0.0001;
  if (umTerco) fracao = 1 / 3;

  const acionadas = ha + had;
  if (acionadas > hs) {
    const erro = new Error(
      `As horas trabalhadas quando chamado (${acionadas} h) passam das horas de sobreaviso (${hs} h). ` +
        'Quem foi chamado estava de sobreaviso naquela hora — confira os números.'
    );
    erro.status = 400;
    throw erro;
  }

  const base = baseDoMes(mes, feriadosNoMes);
  const linhas = [];

  // Só as horas em que ele ficou esperando. As que ele trabalhou saem daqui.
  const horasSoEspera = hs - acionadas;
  let sobreaviso = 0;
  if (horasSoEspera > 0 && fracao > 0) {
    sobreaviso = centavos(horasSoEspera * valorHora * fracao);
    linhas.push({
      rotulo: `Sobreaviso (${umTerco ? '1/3' : `${(fracao * 100).toFixed(2).replace('.', ',')}%`} da hora)`,
      detalhe:
        `${horasSoEspera} h × ${valorHora.toFixed(2)} × ${umTerco ? '1/3' : fracao.toFixed(4)}` +
        (acionadas > 0 ? ` — ${hs} h de escala menos ${acionadas} h trabalhadas` : ''),
      valor: sobreaviso,
    });
  }

  let trabalhadas = 0;
  if (ha > 0) {
    const valor = centavos(ha * valorHora * (1 + pa / 100));
    trabalhadas += valor;
    linhas.push({
      rotulo: `Horas trabalhadas quando chamado (${pa}%)`,
      detalhe: `${ha} h × ${valorHora.toFixed(2)} × ${(1 + pa / 100).toFixed(2)}`,
      valor,
    });
  }
  if (had > 0) {
    const valor = centavos(had * valorHora * (1 + pd / 100));
    trabalhadas += valor;
    linhas.push({
      rotulo: `Horas trabalhadas quando chamado em domingo ou feriado (${pd}%)`,
      detalhe: `${had} h × ${valorHora.toFixed(2)} × ${(1 + pd / 100).toFixed(2)}`,
      valor,
    });
  }

  // O sobreaviso pago todo mês é parte da remuneração, e o descanso da semana
  // sobe junto — pela mesma conta do DSR da hora extra (Súmula 172 do TST).
  const variavel = centavos(sobreaviso + trabalhadas);
  let dsr = 0;
  if (variavel > 0 && base.uteis > 0) {
    dsr = centavos((variavel / base.uteis) * base.descanso);
    linhas.push({
      rotulo: 'DSR sobre sobreaviso e horas trabalhadas',
      detalhe: `${variavel.toFixed(2)} ÷ ${base.uteis} dias úteis × ${base.descanso} de descanso`,
      valor: dsr,
    });
  }

  return {
    valor_hora: valorHora,
    base_do_mes: base,
    horas: { escala: hs, so_espera: horasSoEspera, trabalhadas: acionadas },
    linhas,
    total: centavos(variavel + dsr),
  };
}

module.exports = { calcularSobreaviso, ESCALA_MAXIMA_HORAS };
