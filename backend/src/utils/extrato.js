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

    const forma = String(valorDe(linha, mapa, 'forma') ?? '').trim() || null;
    const bandeira = String(valorDe(linha, mapa, 'bandeira') ?? '').trim() || null;
    const bruto = paraValor(valorDe(linha, mapa, 'valorBruto'));
    const tarifa = Math.abs(paraValor(valorDe(linha, mapa, 'tarifa')));
    const liquidoLido = valorDe(linha, mapa, 'valorLiquido');

    const ticket = ehTicket(forma, bandeira);

    transacoes.push({
      adquirente: ticket ? 'tickets' : adquirente,
      data,
      hora: paraHora(valorDe(linha, mapa, 'hora')),
      forma,
      bandeira,
      valorBruto: bruto,
      tarifa,
      // Quando o extrato não traz o líquido, derivamos do bruto menos a tarifa.
      valorLiquido: liquidoLido === '' || liquidoLido === null || liquidoLido === undefined
        ? Number((bruto - tarifa).toFixed(6))
        : paraValor(liquidoLido),
      categoria: ticket ? 'ticket' : 'cartao',
      status: String(valorDe(linha, mapa, 'status') ?? '').trim() || 'Aprovada',
      arquivo: nomeArquivo || null,
    });
  }

  return { transacoes, ignoradas: ignoradas.length };
}

module.exports = { converterLinhas, paraDataISO, paraHora, paraValor, ehTicket };
