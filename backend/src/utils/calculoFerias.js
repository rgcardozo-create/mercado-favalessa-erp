// Cálculo de férias: o que se paga para o funcionário que vai sair de férias.
//
// Como na calculadora de hora extra, o que sai daqui é o valor BRUTO. INSS e
// imposto de renda ficam de fora de propósito: as tabelas mudam todo ano e
// dependem do total do mês inteiro. O número daqui serve para saber quanto
// separar e para conferir o que o contador mandou.
//
// Cada linha carrega a própria conta em texto, pelo mesmo motivo de sempre:
// número sem origem não se confere.

const centavos = (n) => Math.round(n * 100) / 100;

// Quantos dias de férias o funcionário tem direito, conforme as faltas sem
// justificativa no período aquisitivo (CLT, art. 130). Esta tabela é o tipo de
// coisa que ninguém decora e que sai caro errar nos dois sentidos: dar 30 dias
// a quem faltou 20 é pagar a mais; dar 18 a quem faltou 3 é dever ao
// funcionário.
const FALTAS = [
  { ate: 5, dias: 30 },
  { ate: 14, dias: 24 },
  { ate: 23, dias: 18 },
  { ate: 32, dias: 12 },
];

function diasDeDireito(faltas) {
  const f = Number(faltas) || 0;
  const faixa = FALTAS.find((x) => f <= x.ate);
  // Mais de 32 faltas sem justificativa: perde o direito ao período.
  return faixa ? faixa.dias : 0;
}

// Datas em UTC, sem hora. Somar mês ou ano com o fuso do servidor no meio é
// como o sistema já escorregou um dia antes.
function somarAnos(iso, anos) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a + anos, m - 1, d));
  // 29/02 + 1 ano não existe: cai em 01/03 e volta para o último dia de fevereiro.
  if (alvo.getUTCMonth() !== m - 1) alvo.setUTCDate(0);
  return alvo.toISOString().slice(0, 10);
}

function somarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// O período aquisitivo é cada bloco de 12 meses trabalhados; as férias saem do
// último bloco que já fechou antes do início. Depois que ele fecha, o patrão
// tem mais 12 meses para conceder — é o período concessivo, e passar dele custa
// pagar a mesma remuneração de novo (CLT, art. 137).
//
// O sistema calcula o prazo, mas NÃO adivinha se há férias atrasadas de anos
// anteriores: ele não guarda quais períodos já foram gozados. Por isso o dobro
// do art. 137 é uma caixa que o dono marca sabendo do caso dele, e não um
// palpite do sistema — palpite errado aqui dobra ou some com um valor real.
function periodoAquisitivo(admissao, inicio) {
  if (!admissao || !inicio) return null;

  let n = 0;
  while (somarDias(somarAnos(admissao, n + 2), -1) < inicio) n += 1;
  const fim = somarDias(somarAnos(admissao, n + 1), -1);

  return {
    de: somarAnos(admissao, n),
    ate: fim,
    completo: fim < inicio,
    concessivo_ate: somarAnos(fim, 1),
  };
}

function calcularFerias({
  salarioBase,
  mediaVariaveis = 0,
  admissao = null,
  inicio,
  faltas = 0,
  diasGozo,
  diasAbono = 0,
  adiantar13 = false,
  pagarEmDobro = false,
}) {
  const salario = Number(salarioBase) || 0;
  const media = Number(mediaVariaveis) || 0;

  // A base das férias não é só o salário: média de hora extra, adicional
  // noturno e comissão entram nela (CLT, art. 142). Quem paga hora extra todo
  // mês e calcula férias só pelo salário paga a menos.
  const base = centavos(salario + media);
  // Só para mostrar na tela. As contas abaixo dividem por 30 no fim, e não a
  // partir daqui: arredondar o dia primeiro e multiplicar por 30 devolvia
  // 2.000,10 para quem ganha 2.000 e tira o mês inteiro — dez centavos que não
  // existem e que não bateriam com a folha do contador.
  const valorDia = centavos(base / 30);

  const direito = diasDeDireito(faltas);
  const gozo = Number(diasGozo) || 0;
  const abonoDias = Number(diasAbono) || 0;
  const periodo = periodoAquisitivo(admissao, inicio);

  const linhas = [];

  const ferias = centavos((base * gozo) / 30);
  if (gozo > 0) {
    linhas.push({
      rotulo: `Férias — ${gozo} dia(s) de descanso`,
      detalhe: `${base.toFixed(2)} ÷ 30 × ${gozo}`,
      valor: ferias,
    });
  }

  // O terço constitucional não é bônus da casa: é a Constituição, art. 7º, XVII.
  const tercoFerias = centavos(ferias / 3);
  if (ferias > 0) {
    linhas.push({
      rotulo: 'Um terço constitucional',
      detalhe: `${ferias.toFixed(2)} ÷ 3`,
      valor: tercoFerias,
    });
  }

  // Abono pecuniário: o funcionário pode vender até um terço das férias e
  // trabalhar esses dias (CLT, art. 143). O terço incide sobre ele também.
  const abono = centavos((base * abonoDias) / 30);
  const tercoAbono = centavos(abono / 3);
  if (abonoDias > 0) {
    linhas.push({
      rotulo: `Abono pecuniário — ${abonoDias} dia(s) vendido(s)`,
      detalhe: `${base.toFixed(2)} ÷ 30 × ${abonoDias}`,
      valor: abono,
    });
    linhas.push({
      rotulo: 'Um terço sobre o abono',
      detalhe: `${abono.toFixed(2)} ÷ 3`,
      valor: tercoAbono,
    });
  }

  // Férias não concedidas dentro do período concessivo se pagam em dobro. Quem
  // sabe se estas estão atrasadas é o dono, não o sistema — daí ser marcação
  // dele. Marcada, dobra-se as férias e o terço; o abono é escolha à parte e
  // não entra no dobro.
  let dobro = 0;
  if (pagarEmDobro && ferias > 0) {
    dobro = centavos(ferias + tercoFerias);
    linhas.push({
      rotulo: 'Dobro por férias vencidas (art. 137)',
      detalhe: `${ferias.toFixed(2)} + ${tercoFerias.toFixed(2)} pagos de novo, por passar do prazo de conceder`,
      valor: dobro,
    });
  }

  // Metade do 13º pode ser adiantada junto com as férias, se o funcionário
  // pedir (CLT, art. 4º da Lei 4.749/65). Fica opcional porque é escolha dele.
  let adiantamento = 0;
  if (adiantar13) {
    adiantamento = centavos(salario / 2);
    linhas.push({
      rotulo: 'Adiantamento de metade do 13º',
      detalhe: `${salario.toFixed(2)} ÷ 2 — só o salário entra nesta parcela`,
      valor: adiantamento,
    });
  }

  const total = centavos(linhas.reduce((s, l) => s + l.valor, 0));

  return {
    base,
    valor_dia: valorDia,
    dias_direito: direito,
    dias_gozo: gozo,
    dias_abono: abonoDias,
    periodo_aquisitivo: periodo,
    // Volta ao trabalho no dia seguinte ao último de descanso.
    retorno: gozo > 0 ? somarDias(inicio, gozo) : inicio,
    // As férias têm que estar pagas até dois dias antes de começarem (art. 145).
    pagar_ate: somarDias(inicio, -2),
    linhas,
    total,
  };
}

module.exports = { calcularFerias, diasDeDireito, periodoAquisitivo, somarAnos, somarDias };
