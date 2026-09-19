const { normalizar } = require('./lerPlanilha');

// Converte linhas cruas de um extrato em transações de conciliação.

// Datas vêm como Date (xlsx), "12/08/2026" ou "2026-08-12".
function paraDataISO(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    // O Excel guarda datas sem fuso; usar UTC evita o dia "voltar" um dia.
    return valor.toISOString().slice(0, 10);
  }

  const texto = String(valor ?? '').trim();
  if (!texto) return null;

  const br = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (br) {
    const [, d, m, a] = br;
    const ano = a.length === 2 ? `20${a}` : a;
    return `${ano}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  return null;
}

function paraHora(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(11, 16);
  }
  const texto = String(valor ?? '').trim();
  const m = texto.match(/(\d{1,2}):(\d{2})(:(\d{2}))?/);
  return m ? m[0] : null;
}

// "R$ 1.234,56" e "1234.56" precisam dar o mesmo número.
function paraValor(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;

  let texto = String(valor ?? '').replace(/[R$\s]/gi, '').trim();
  if (!texto) return 0;

  const negativo = /^-/.test(texto) || /\(.*\)/.test(texto);
  texto = texto.replace(/[()-]/g, '');

  // Se tem vírgula, ela é o separador decimal (padrão brasileiro).
  if (texto.includes(',')) {
    texto = texto.replace(/\./g, '').replace(',', '.');
  }

  const n = Number(texto);
  if (!Number.isFinite(n)) return 0;
  return negativo ? -n : n;
}

// Célula vazia e célula com traço são a mesma coisa: "ainda não tem valor".
//
// A Rede escreve "-" em `valor líquido` enquanto não fecha o MDR do dia — o
// próprio arquivo avisa que "pode sofrer alterações durante o dia". Lendo isso
// como zero, o líquido virava zero e a taxa virava a venda inteira: 100%. Num
// extrato do mês, com parte das linhas já liquidada e parte ainda em traço, a
// média por bandeira dava aqueles 30% e 45% que não existem no mercado.
//
// Vale para qualquer coluna: melhor não saber do que saber errado.
const SEM_VALOR = new Set(['', '-', '--', '---', 'n/a', 'na', 'n/d', 'nd', 'null', 'nulo', '—', '–']);

function temNumero(valor) {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'number') return Number.isFinite(valor);
  const texto = String(valor).trim().toLowerCase();
  if (SEM_VALOR.has(texto)) return false;
  // Texto que não tem nenhum algarismo não é número nenhum.
  return /\d/.test(texto);
}

// Voucher/ticket vai para a tela de Tickets independentemente do arquivo de
// origem — é assim que o sistema atual separa, e foi confirmado nos dados reais:
// dentro do extrato da Stone e da Rede, as linhas de voucher aparecem em Tickets.
const MARCAS_TICKET = [
  'voucher', 'ticket', 'alelo', 'pluxee', 'sodexo', 'vr ', 'vr,', 'upbrasil',
  'up brasil', 'policard', 'good card', 'rede compras', 'ben visa', 'multibenef',
];

function ehTicket(forma, bandeira) {
  const f = normalizar(forma);
  const b = normalizar(bandeira);
  if (f.includes('voucher')) return true;
  return MARCAS_TICKET.some((m) => b.includes(m.trim()));
}

// A mesma venda precisa sair sempre com o mesmo nome de forma, senão a impressão
// digital muda e recarregar o período duplica em vez de atualizar. A Stone chama
// o PIX de "Pix QRcode" no extrato de hoje; o sistema antigo gravou "Pix". É a
// mesma coisa, e é como PIX que ele entra no fechamento — então vira "Pix".
function normalizarForma(forma) {
  const texto = String(forma ?? '').trim();
  if (!texto) return null;
  return normalizar(texto).includes('pix') ? 'Pix' : texto;
}

function valorDe(linha, mapa, campo) {
  const i = mapa[campo];
  return i === undefined || i === null ? '' : linha[i];
}

// Transforma as linhas do arquivo em transações prontas para gravar.
// `adquirente` é o que o usuário escolheu; linhas de voucher são desviadas
// para 'tickets'.
function converterLinhas(linhas, mapa, adquirente, nomeArquivo) {
  const transacoes = [];
  const ignoradas = [];

  for (const linha of linhas) {
    const data = paraDataISO(valorDe(linha, mapa, 'data'));
    if (!data) {
      // Sem data não dá para conciliar: normalmente é linha de total ou rodapé.
      if (linha.some((c) => c !== '' && c !== null && c !== undefined)) {
        ignoradas.push(linha);
      }
      continue;
    }

    const forma = normalizarForma(valorDe(linha, mapa, 'forma'));
    // PIX não tem bandeira de cartão, e extrato que deixa a coluna vazia geraria
    // uma impressão digital diferente da do mesmo PIX vindo de outro arquivo.
    const bandeira =
      String(valorDe(linha, mapa, 'bandeira') ?? '').trim() || (forma === 'Pix' ? 'Pix' : null);
    const bruto = paraValor(valorDe(linha, mapa, 'valorBruto'));
    const liquidoLido = valorDe(linha, mapa, 'valorLiquido');
    const temLiquido = temNumero(liquidoLido);
    const tarifaLida = valorDe(linha, mapa, 'tarifa');

    // A taxa é o que não chegou: bruto menos líquido. Contar a coluna de desconto
    // sozinha erra sempre que o adquirente divide a taxa em várias — a Stone tem
    // "desconto de MDR", "de antecipação" e "unificado", e na maioria das vendas o
    // valor está só no unificado. Só quando não há líquido a coluna de taxa manda,
    // porque aí ela é a única informação existente.
    //
    // Sem líquido e sem taxa, a taxa é ZERO e o líquido é o bruto inteiro. Não é
    // afirmar que não houve taxa: é dizer que o arquivo não disse qual foi. A
    // tela de Taxas separa essas linhas como "sem taxa no extrato" justamente
    // para elas não baixarem a média das que têm.
    const tarifa = temLiquido
      ? Number((bruto - paraValor(liquidoLido)).toFixed(6))
      : Math.abs(paraValor(temNumero(tarifaLida) ? tarifaLida : 0));

    const liquido = Number((bruto - tarifa).toFixed(6));

    const ticket = ehTicket(forma, bandeira);

    transacoes.push({
      adquirente: ticket ? 'tickets' : adquirente,
      data,
      // Extrato que junta data e hora numa coluna só (Stone: "28/07/2026 10:08")
      // não tem coluna de hora para mapear — a hora sai da própria data.
      hora: paraHora(valorDe(linha, mapa, 'hora')) || paraHora(valorDe(linha, mapa, 'data')),
      forma,
      bandeira,
      valorBruto: bruto,
      tarifa,
      valorLiquido: liquido,
      categoria: ticket ? 'ticket' : 'cartao',
      status: String(valorDe(linha, mapa, 'status') ?? '').trim() || 'Aprovada',
      arquivo: nomeArquivo || null,
    });
  }

  return { transacoes, ignoradas: ignoradas.length };
}

module.exports = { converterLinhas, paraDataISO, paraHora, paraValor, ehTicket, normalizarForma };
