// Cálculo de rescisão: o acerto de contas de quem está saindo.
//
// É a mais delicada das três calculadoras porque o motivo da saída muda tudo.
// Quem pede demissão não recebe multa de FGTS; quem é mandado embora por justa
// causa perde o 13º proporcional e as férias proporcionais, mas nunca perde as
// férias que já venceram. Trocar uma coisa por outra aqui é erro caro dos dois
// lados, e é justamente o que ninguém decora.
//
// Como nas outras duas: valor BRUTO, sem INSS e sem imposto de renda. Quem
// fecha o número é o contador; este serve para saber quanto separar e conferir.

const { somarAnos, somarDias } = require('./calculoFerias');

const centavos = (n) => Math.round(n * 100) / 100;

// A tabela que decide tudo. Cada motivo diz quais verbas entram.
//
// `aviso` diz de quem é o aviso prévio: 'patrao' é indenizado a favor do
// funcionário, 'funcionario' é o que ele deve se sair sem cumprir, 'metade' é
// o acordo do art. 484-A, e null é quando não há aviso nenhum.
const MOTIVOS = {
  sem_justa_causa: {
    rotulo: 'Dispensa sem justa causa',
    aviso: 'patrao',
    decimo_terceiro: true,
    ferias_proporcionais: true,
    multa_fgts: 40,
  },
  pedido: {
    rotulo: 'Pedido de demissão',
    aviso: 'funcionario',
    decimo_terceiro: true,
    ferias_proporcionais: true,
    multa_fgts: 0,
  },
  justa_causa: {
    rotulo: 'Dispensa por justa causa',
    aviso: null,
    decimo_terceiro: false,
    ferias_proporcionais: false,
    multa_fgts: 0,
  },
  acordo: {
    rotulo: 'Acordo entre as partes (art. 484-A)',
    aviso: 'metade',
    decimo_terceiro: true,
    ferias_proporcionais: true,
    multa_fgts: 20,
  },
  fim_experiencia: {
    rotulo: 'Fim do contrato de experiência',
    aviso: null,
    decimo_terceiro: true,
    ferias_proporcionais: true,
    multa_fgts: 0,
  },
};

// Aviso prévio: 30 dias, mais 3 por ano completo de casa, teto de 90
// (Lei 12.506/2011). Quem tem 10 anos de serviço tem direito a 60 dias, e essa
// diferença some fácil numa conta feita de cabeça.
function diasDeAviso(admissao, saida) {
  if (!admissao) return 30;
  let anos = 0;
  while (somarAnos(admissao, anos + 1) <= saida) anos += 1;
  return Math.min(30 + anos * 3, 90);
}

// Avos: quantos duodécimos entre duas datas. Conta o mês em que se trabalhou 15
// dias ou mais — é a regra do parágrafo único do art. 146 da CLT para as férias
// e a mesma da Lei 4.090/62 para o 13º.
function avos(de, ate) {
  if (!de || !ate || ate < de) return 0;
  const [aIni, mIni] = de.split('-').map(Number);
  const [aFim, mFim] = ate.split('-').map(Number);

  let total = 0;
  let ano = aIni;
  let mes = mIni;
  while (ano < aFim || (ano === aFim && mes <= mFim)) {
    const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const ultimo = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    const inicioNoMes = de > primeiro ? de : primeiro;
    const fimNoMes = ate < ultimo ? ate : ultimo;
    const dias = diasEntre(inicioNoMes, fimNoMes) + 1;
    if (dias >= 15) total += 1;

    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return Math.min(total, 12);
}

function diasEntre(de, ate) {
  const d1 = Date.UTC(...de.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const d2 = Date.UTC(...ate.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((d2 - d1) / 86400000);
}

// O período aquisitivo ainda aberto na saída: é dele que saem as férias
// proporcionais. As férias já vencidas são outra coisa, e o sistema não sabe
// quantas são — quem informa é o dono.
function periodoEmAberto(admissao, ate) {
  if (!admissao) return null;
  let n = 0;
  while (somarDias(somarAnos(admissao, n + 1), -1) < ate) n += 1;
  return { de: somarAnos(admissao, n), ate: somarDias(somarAnos(admissao, n + 1), -1) };
}

function calcularRescisao({
  salarioBase,
  mediaVariaveis = 0,
  admissao = null,
  saida,
  motivo,
  avisoCumprido = false,
  feriasVencidasDias = 0,
  saldoFgts = null,
}) {
  const regra = MOTIVOS[motivo];
  if (!regra) throw new Error(`Motivo de saída desconhecido: ${motivo}`);

  const salario = Number(salarioBase) || 0;
  const media = Number(mediaVariaveis) || 0;
  // Média de hora extra e adicionais entra na base das verbas, como nas férias.
  const base = centavos(salario + media);

  const proventos = [];
  const descontos = [];

  // --- Saldo de salário: os dias já trabalhados no mês em que ele sai.
  const primeiroDoMes = `${saida.slice(0, 7)}-01`;
  const inicioNoMes = admissao && admissao > primeiroDoMes ? admissao : primeiroDoMes;
  const diasSaldo = diasEntre(inicioNoMes, saida) + 1;
  const saldo = centavos((base * diasSaldo) / 30);
  if (diasSaldo > 0) {
    proventos.push({
      rotulo: `Saldo de salário — ${diasSaldo} dia(s)`,
      detalhe: `${base.toFixed(2)} ÷ 30 × ${diasSaldo}`,
      valor: saldo,
    });
  }

  // --- Aviso prévio. Indenizado, ele projeta o fim do contrato: o 13º e as
  // férias proporcionais contam como se o funcionário tivesse ficado até lá.
  // Esquecer a projeção é pagar avos a menos, e é erro comum.
  const diasAvisoCheio = diasDeAviso(admissao, saida);
  let diasProjecao = 0;
  let avisoValor = 0;

  if (regra.aviso === 'patrao' && !avisoCumprido) {
    diasProjecao = diasAvisoCheio;
    avisoValor = centavos((base * diasAvisoCheio) / 30);
    proventos.push({
      rotulo: `Aviso prévio indenizado — ${diasAvisoCheio} dia(s)`,
      detalhe: `30 dias + 3 por ano de casa (Lei 12.506/2011), ${base.toFixed(2)} ÷ 30 × ${diasAvisoCheio}`,
      valor: avisoValor,
    });
  } else if (regra.aviso === 'metade' && !avisoCumprido) {
    const metade = Math.ceil(diasAvisoCheio / 2);
    diasProjecao = metade;
    avisoValor = centavos((base * metade) / 30);
    proventos.push({
      rotulo: `Aviso prévio pela metade — ${metade} dia(s)`,
      detalhe: `metade dos ${diasAvisoCheio} dias, como manda o acordo do art. 484-A`,
      valor: avisoValor,
    });
  } else if (regra.aviso === 'funcionario' && !avisoCumprido) {
    // Pedido de demissão sem cumprir o aviso: o patrão pode descontar 30 dias.
    // São 30, e não os 30+3 por ano — o acréscimo é direito só do funcionário.
    avisoValor = centavos(base);
    descontos.push({
      rotulo: 'Aviso prévio não cumprido — 30 dias',
      detalhe: `${base.toFixed(2)} ÷ 30 × 30, descontado por ele não ter cumprido o aviso`,
      valor: avisoValor,
    });
  }

  // Data até onde o contrato conta para 13º e férias proporcionais.
  const fimContado = diasProjecao > 0 ? somarDias(saida, diasProjecao) : saida;

  // --- 13º proporcional: avos deste ano.
  if (regra.decimo_terceiro) {
    const inicioAno = `${fimContado.slice(0, 4)}-01-01`;
    const de = admissao && admissao > inicioAno ? admissao : inicioAno;
    const meses = avos(de, fimContado);
    if (meses > 0) {
      const valor = centavos((base * meses) / 12);
      proventos.push({
        rotulo: `13º proporcional — ${meses}/12`,
        detalhe: `${base.toFixed(2)} ÷ 12 × ${meses}${diasProjecao ? ' (contando a projeção do aviso)' : ''}`,
        valor,
      });
    }
  }

  // --- Férias vencidas: período inteiro que ele tinha direito e não gozou.
  // Quantos dias são, só o dono sabe — o sistema não guarda o histórico de
  // férias. São devidas em qualquer motivo, justa causa inclusive.
  const vencidas = Number(feriasVencidasDias) || 0;
  if (vencidas > 0) {
    const valor = centavos((base * vencidas) / 30);
    const terco = centavos(valor / 3);
    proventos.push({
      rotulo: `Férias vencidas — ${vencidas} dia(s)`,
      detalhe: `${base.toFixed(2)} ÷ 30 × ${vencidas} — devidas mesmo na justa causa`,
      valor,
    });
    proventos.push({ rotulo: 'Um terço sobre as férias vencidas', detalhe: `${valor.toFixed(2)} ÷ 3`, valor: terco });
  }

  // --- Férias proporcionais: avos do período aquisitivo ainda aberto.
  const periodo = periodoEmAberto(admissao, saida);
  let mesesFerias = 0;
  if (regra.ferias_proporcionais && periodo) {
    mesesFerias = avos(periodo.de, fimContado);
    if (mesesFerias > 0) {
      const valor = centavos((base * mesesFerias) / 12);
      const terco = centavos(valor / 3);
      proventos.push({
        rotulo: `Férias proporcionais — ${mesesFerias}/12`,
        detalhe: `${base.toFixed(2)} ÷ 12 × ${mesesFerias}, do período aberto desde ${periodo.de}`,
        valor,
      });
      proventos.push({ rotulo: 'Um terço sobre as proporcionais', detalhe: `${valor.toFixed(2)} ÷ 3`, valor: terco });
    }
  }

  // --- Multa do FGTS. O sistema não tem o extrato do fundo, então só calcula
  // com o saldo que o dono informar. Sem ele, não inventa um número: avisa que
  // falta. Multa estimada por cima seria a conta mais fácil de errar aqui.
  const fgts = saldoFgts === null || saldoFgts === '' ? null : Number(saldoFgts);
  let multa = 0;
  if (regra.multa_fgts > 0 && fgts !== null && Number.isFinite(fgts) && fgts > 0) {
    multa = centavos((fgts * regra.multa_fgts) / 100);
    proventos.push({
      rotulo: `Multa de ${regra.multa_fgts}% do FGTS`,
      detalhe: `${fgts.toFixed(2)} × ${regra.multa_fgts}%`,
      valor: multa,
    });
  }

  const totalProventos = centavos(proventos.reduce((s, l) => s + l.valor, 0));
  const totalDescontos = centavos(descontos.reduce((s, l) => s + l.valor, 0));

  return {
    motivo,
    motivo_rotulo: regra.rotulo,
    base,
    dias_aviso: diasAvisoCheio,
    dias_projecao: diasProjecao,
    fim_contado: fimContado,
    periodo_aberto: periodo,
    meses_ferias_proporcionais: mesesFerias,
    // A tela precisa saber o que NÃO entrou, e por quê, para poder dizer.
    regra: {
      decimo_terceiro: regra.decimo_terceiro,
      ferias_proporcionais: regra.ferias_proporcionais,
      multa_fgts: regra.multa_fgts,
      fgts_informado: fgts !== null && Number.isFinite(fgts) && fgts > 0,
    },
    proventos,
    descontos,
    total_proventos: totalProventos,
    total_descontos: totalDescontos,
    total: centavos(totalProventos - totalDescontos),
  };
}

module.exports = { calcularRescisao, MOTIVOS, diasDeAviso, avos, diasEntre, periodoEmAberto };
