const { lerArquivo } = require('./lerPlanilha');

// Leitura do extrato de conta corrente, para lançar o que SAIU.
//
// Duas coisas aprendidas lendo um extrato de verdade (docs/extrato-banco.md):
//
// 1. A coluna "Tipo Lançamento" diz "Entrada" para todas as linhas, inclusive
//    Pix Enviado e Pagamento de Boleto. Confiar nela faria todo pagamento entrar
//    como recebimento. Quem separa é a letra C ou D no fim do Valor.
//
// 2. Boleto traz o nome do fornecedor; Pix enviado não traz nada além de um
//    horário. Por isso a classificação não pode depender de adivinhar o nome —
//    depende de o dono ensinar uma vez e o sistema lembrar.

const COLUNAS = {
  data: ['data', 'data do lancamento', 'dt'],
  lancamento: ['lancamento', 'historico', 'descricao'],
  detalhes: ['detalhes', 'detalhe', 'complemento'],
  documento: ['n documento', 'no documento', 'numero documento', 'documento'],
  valor: ['valor'],
};

const semAcento = (t) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

const normalizar = (t) => semAcento(t).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

// A chave do aprendizado: o que sobra da descrição depois de tirar tudo que muda
// de um lançamento para o outro — data, hora, CNPJ, número de documento.
//
// É ela que faz "Tar. agrupadas - ocorrencia 29/05/2026" e "... 03/06/2026"
// virarem a mesma coisa, e os vinte e cinco Pix da noite virarem uma regra só.
function chaveDe(lancamento, detalhes) {
  const limpo = semAcento(detalhes)
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  const natureza = semAcento(lancamento).replace(/\s+/g, ' ').trim().toUpperCase();
  return limpo ? `${natureza} | ${limpo}` : natureza;
}

// Valor vem como texto, "1.067,79 C". A letra é o que importa.
function lerValor(bruto) {
  const m = String(bruto ?? '').trim().match(/^([\d.,]+)\s*([CD])?$/i);
  if (!m) return null;
  const valor = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(valor)) return null;
  return { valor, saida: String(m[2] || '').toUpperCase() === 'D' };
}

function lerData(bruto) {
  if (bruto instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${bruto.getFullYear()}-${p(bruto.getMonth() + 1)}-${p(bruto.getDate())}`;
  }
  const t = String(bruto ?? '').trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

// Linha de saldo não é movimento: entra no meio do extrato e estragaria
// qualquer soma se virasse lançamento.
const EH_SALDO = /^\s*s\s*a\s*l\s*d\s*o|saldo (anterior|do dia)/i;

// A forma de pagamento sai da natureza do lançamento, que o banco já diz. Cai em
// Transferência quando não é nenhuma das conhecidas — melhor genérico do que
// errado.
function formaDe(lancamento) {
  const n = normalizar(lancamento);
  if (n.includes('pix')) return 'PIX';
  if (n.includes('boleto')) return 'Boleto';
  if (n.includes('cartao')) return 'Cartão';
  return 'Transferência';
}

// O cabeçalho não está sempre na primeira linha: o extrato traz título e período
// antes. Procuramos a linha que mais parece cabeçalho pelos nomes das colunas.
function acharCabecalho(linhas) {
  let melhor = { indice: -1, acertos: 0, mapa: {} };
  const campos = Object.keys(COLUNAS);

  for (let i = 0; i < Math.min(linhas.length, 25); i += 1) {
    const titulos = (linhas[i] || []).map(normalizar);
    const mapa = {};
    let acertos = 0;
    for (const campo of campos) {
      const idx = titulos.findIndex((t) => t && COLUNAS[campo].includes(t));
      if (idx >= 0) { mapa[campo] = idx; acertos += 1; }
    }
    if (acertos > melhor.acertos) melhor = { indice: i, acertos, mapa };
  }
  return melhor;
}

async function lerExtratoBanco(buffer, nomeArquivo) {
  const todas = await lerArquivo(buffer, nomeArquivo);
  if (!todas.length) throw new Error('Não foi possível ler nenhuma linha da planilha.');

  const cabecalho = acharCabecalho(todas);
  // Sem data e sem valor não há extrato nenhum: é o mínimo para reconhecer.
  if (cabecalho.mapa.data === undefined || cabecalho.mapa.valor === undefined) {
    return {
      reconhecido: false,
      colunas: (todas[0] || []).map((c, i) => ({ indice: i, titulo: String(c ?? '') })),
    };
  }

  const mapa = cabecalho.mapa;
  const linhas = todas.slice(cabecalho.indice + 1);
  const saidas = [];
  const ignoradas = { saldo: 0, entrada: 0, invalida: 0 };

  for (const linha of linhas) {
    const lancamento = String(linha[mapa.lancamento] ?? '').trim();
    if (EH_SALDO.test(lancamento)) { ignoradas.saldo += 1; continue; }

    const data = lerData(linha[mapa.data]);
    const v = lerValor(linha[mapa.valor]);
    if (!data || !v || !v.valor) { ignoradas.invalida += 1; continue; }
    if (!v.saida) { ignoradas.entrada += 1; continue; }

    const detalhes = String(linha[mapa.detalhes] ?? '').trim();
    const documento = String(linha[mapa.documento] ?? '').trim();

    saidas.push({
      data,
      lancamento,
      detalhes,
      documento,
      valor: v.valor,
      forma: formaDe(lancamento),
      chave: chaveDe(lancamento, detalhes),
      // Identidade da linha no extrato, para reimportar não duplicar. Entra o
      // documento porque dois pagamentos iguais no mesmo dia existem.
      impressao: `banco:${data}:${v.valor.toFixed(2)}:${documento}:${chaveDe(lancamento, detalhes)}`.slice(0, 40),
    });
  }

  return {
    reconhecido: true,
    mapa,
    linha_cabecalho: cabecalho.indice,
    colunas: (todas[cabecalho.indice] || []).map((c, i) => ({ indice: i, titulo: String(c ?? '') })),
    saidas,
    ignoradas,
  };
}

module.exports = { lerExtratoBanco, chaveDe, formaDe, lerValor, lerData };
