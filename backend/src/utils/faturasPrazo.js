// Faturas do caderno: as compras de um cliente fechadas em competências mensais.
//
// Vem do sistema antigo, e a ideia é a do cartão de crédito: as compras do mês
// fecham num dia de corte e vencem num dia do mês seguinte. Sem isso, "quanto
// esse cliente me deve" era a única pergunta possível — e a que importa mesmo é
// "há quanto tempo ele deve", que é o que separa o freguês que compra toda
// semana e paga direito daquele que sumiu há três meses.

const centavos = (n) => Math.round(n * 100) / 100;

// As faixas de atraso que a tela mostra, em dias. Ficam aqui porque quem sabe
// somar fatura vencida é este arquivo; a tela só desenha o que ele devolve.
const FAIXAS = [30, 60, 90, 120];

function diasNoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

// A competência de uma compra: antes do dia de corte, ela ainda pertence ao mês
// anterior — é a fatura que já estava aberta quando ela aconteceu.
function competenciaDe(dataISO, diaCorte) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  let a = ano;
  let m = mes;
  if (dia < diaCorte) {
    m -= 1;
    if (m < 1) {
      m = 12;
      a -= 1;
    }
  }
  return `${a}-${String(m).padStart(2, '0')}`;
}

// Vence no mês seguinte ao do fechamento. Dia 31 em mês de 30 cai no último dia.
function vencimentoDaCompetencia(chave, diaVencimento) {
  const [ano, mes] = chave.split('-').map(Number);
  let a = ano;
  let m = mes + 1;
  if (m > 12) {
    m = 1;
    a += 1;
  }
  const dia = Math.min(diaVencimento, diasNoMes(a, m));
  return `${a}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function diasDesde(dataISO, hojeISO) {
  const dia = (s) => Date.UTC(...s.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.max(0, Math.round((dia(hojeISO) - dia(dataISO)) / 86400000));
}

// Os pagamentos abatem as faturas mais antigas primeiro. É como se faz no
// caderno de papel e é o que favorece o cliente: quita o que está vencendo antes
// de mexer no que ainda nem fechou.
function faturasAbertas(movimentos, { diaCorte, diaVencimento, hoje }) {
  const compras = movimentos.filter((m) => m.tipo === 'compra');
  const pago = movimentos
    .filter((m) => m.tipo === 'pagamento')
    .reduce((s, m) => s + Number(m.valor || 0), 0);

  const porCompetencia = new Map();
  for (const c of compras) {
    const chave = competenciaDe(c.data, diaCorte);
    porCompetencia.set(chave, centavos((porCompetencia.get(chave) || 0) + Number(c.valor || 0)));
  }

  let restante = pago;
  const faturas = [...porCompetencia.keys()]
    .sort()
    .map((chave) => {
      const total = porCompetencia.get(chave);
      const abatido = Math.min(total, Math.max(0, restante));
      restante = centavos(restante - abatido);
      const vencimento = vencimentoDaCompetencia(chave, diaVencimento);
      return {
        competencia: chave,
        total,
        saldo: centavos(Math.max(0, total - abatido)),
        vencimento,
        dias_vencida: vencimento < hoje ? diasDesde(vencimento, hoje) : 0,
      };
    })
    // Meio centavo de resto não é fatura em aberto: é arredondamento.
    .filter((f) => f.saldo > 0.004);

  // As faixas são cumulativas, como no sistema antigo: quem está cem dias
  // vencido aparece em 30, em 60 e em 90. Não é redundância — cada faixa
  // responde uma pergunta diferente ("quanto está podre" contra "quanto está
  // atrasado"), e um cliente pode ter uma fatura de 100 dias e outra de 40.
  const atrasos = {};
  for (const dias of FAIXAS) {
    atrasos[dias] = centavos(
      faturas.filter((f) => f.dias_vencida >= dias).reduce((s, f) => s + f.saldo, 0)
    );
  }

  return {
    faturas,
    atrasos,
    atraso_30: atrasos[30],
    // "Atrasado" é ter fatura vencida há 30 dias ou mais; "Devendo" é dever sem
    // ter chegado lá; "Em dia" é não dever nada.
    situacao: atrasos[30] > 0 ? 'atrasado' : faturas.length ? 'devendo' : 'em_dia',
  };
}

module.exports = { FAIXAS, faturasAbertas, competenciaDe, vencimentoDaCompetencia, diasNoMes, diasDesde };
