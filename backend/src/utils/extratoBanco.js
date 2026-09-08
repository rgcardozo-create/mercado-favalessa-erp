const crypto = require('crypto');
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

// O mesmo banco exporta em dois formatos. O resumido traz seis colunas, com o
// C/D colado no valor ("1.067,79 C"). O cru traz onze, com a natureza numa
// coluna à parte chamada "Inf." e a coluna de valor chamada "Valor R$".
// Os dois precisam funcionar: o dono baixa ora um, ora outro.
const COLUNAS = {
  data: ['data', 'data do lancamento', 'data lancamento', 'dt'],
  lancamento: ['lancamento', 'historico', 'descricao', 'descricao do lancamento'],
  detalhes: ['detalhes', 'detalhe', 'complemento', 'detalhamento hist', 'detalhamento historico'],
  documento: ['n documento', 'no documento', 'numero documento', 'documento'],
  valor: ['valor', 'valor r', 'valor r$', 'vlr', 'vlr r'],
  // Opcional: existe só no formato cru. Quando existe, é ela que diz se o
  // lançamento é crédito ou débito.
  natureza: ['inf', 'natureza', 'd c', 'c d', 'tipo'],
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
  // "Pagamento de Impostos" e "Impostos" são o mesmo lançamento com dois nomes,
  // conforme o extrato venha do computador ou do celular. Tirar o "Pagamento de"
  // junta os dois, para não ser preciso ensinar a mesma coisa duas vezes.
  const natureza = semAcento(lancamento)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/^PAGAMENTO DE /, '');

  // Quando o detalhe só repete a natureza, ele não acrescenta nada e ainda
  // atrapalha: "BB Rende Fácil" vem ora com o detalhe "Rende Facil", ora sem
  // detalhe nenhum, e viraria duas regras para a mesma coisa.
  const repete = limpo && (natureza.includes(limpo) || limpo.includes(natureza));
  return limpo && !repete ? `${natureza} | ${limpo}` : natureza;
}

// Valor vem como texto: "1.067,79 C" no formato resumido, "1.067,79" no cru com
// a letra numa coluna à parte. `natureza` é essa coluna, quando ela existe.
//
// Sem letra em lugar nenhum não dá para saber se entrou ou saiu — e chutar aqui
// é transformar recebimento em despesa. Nesse caso devolve nulo e a linha fica
// de fora, contada como inválida.
function lerValor(bruto, natureza) {
  const m = String(bruto ?? '').trim().match(/^([\d.,]+)\s*([CD])?$/i);
  if (!m) return null;
  const valor = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(valor)) return null;

  const letra = (m[2] || String(natureza ?? '').trim().charAt(0) || '').toUpperCase();
  if (letra !== 'C' && letra !== 'D') return null;
  return { valor, saida: letra === 'D' };
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

// Identidade da linha no extrato — é ela que faz reimportar não duplicar.
//
// Dois cuidados aprendidos na marra. O número do documento vem com zeros à
// esquerda num formato e sem eles no outro, então os zeros saem: o mesmo
// pagamento baixado pelo computador e pelo celular tem que dar a mesma
// identidade, senão importar o mês pelos dois caminhos duplicaria tudo.
//
// E o resultado é um resumo de tamanho fixo, não o texto cortado. legado_id tem
// 40 caracteres; um documento longo empurrava o resto para fora e duas linhas
// diferentes podiam virar a mesma — uma delas sumiria calada.
function impressaoDigital({ data, valor, documento, chave }) {
  const doc = String(documento || '').replace(/^0+/, '');
  // Com número de documento, ele basta: é o identificador que o próprio banco dá
  // à transação, e data+valor+documento não repete dentro de um extrato. A
  // descrição fica DE FORA de propósito — o banco escreve o mesmo lançamento de
  // um jeito no arquivo do computador e de outro no do celular ("Impostos" x
  // "Pagamento de Impostos"), e incluí-la faria o mesmo pagamento parecer dois.
  //
  // Sem documento não há o que fazer além de usar a descrição, e aí vale a pena:
  // duas saídas no mesmo dia pelo mesmo valor existem.
  const conteudo = doc ? `${data}|${valor.toFixed(2)}|${doc}` : `${data}|${valor.toFixed(2)}||${chave}`;
  return `banco:${crypto.createHash('sha1').update(conteudo).digest('hex').slice(0, 24)}`;
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
    // Mostrar só a primeira linha não ajuda: nestes extratos ela é o título da
    // planilha, e o cabeçalho de verdade está mais abaixo. Vai a linha que mais
    // pareceu cabeçalho e as primeiras linhas, para dar o que olhar.
    const candidata = cabecalho.indice >= 0 ? todas[cabecalho.indice] : todas[0];
    return {
      reconhecido: false,
      colunas: (candidata || []).map((c, i) => ({ indice: i, titulo: String(c ?? '') })),
      amostra: todas
        .slice(0, 8)
        .map((l) => (l || []).map((c) => String(c ?? '').slice(0, 24)))
        .filter((l) => l.some((c) => c !== '')),
    };
  }

  const mapa = cabecalho.mapa;
  const linhas = todas.slice(cabecalho.indice + 1);
  const saidas = [];
  // `rodape` separa o que nunca foi lançamento — o bloco de juros, IOF e resgate
  // automático que o banco põe no fim, e as linhas em branco. Contá-las como
  // "inválidas" faria parecer que se perdeu pagamento, quando não se perdeu nada.
  const ignoradas = { saldo: 0, entrada: 0, invalida: 0, rodape: 0 };

  for (const linha of linhas) {
    const lancamento = String(linha[mapa.lancamento] ?? '').trim();
    if (EH_SALDO.test(lancamento)) { ignoradas.saldo += 1; continue; }

    const data = lerData(linha[mapa.data]);
    const v = lerValor(linha[mapa.valor], mapa.natureza === undefined ? '' : linha[mapa.natureza]);
    if (!data && !v) { ignoradas.rodape += 1; continue; }
    if (!data || !v || !v.valor) { ignoradas.invalida += 1; continue; }
    if (!v.saida) { ignoradas.entrada += 1; continue; }

    const detalhes = String(linha[mapa.detalhes] ?? '').trim();
    const documento = String(linha[mapa.documento] ?? '').trim();
    const chave = chaveDe(lancamento, detalhes);

    saidas.push({
      data,
      lancamento,
      detalhes,
      documento,
      valor: v.valor,
      forma: formaDe(lancamento),
      chave,
      impressao: impressaoDigital({ data, valor: v.valor, documento, chave }),
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

module.exports = { lerExtratoBanco, chaveDe, formaDe, lerValor, lerData, impressaoDigital };
