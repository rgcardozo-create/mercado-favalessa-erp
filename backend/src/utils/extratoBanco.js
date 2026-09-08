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
  lancamento: ['lancamento', 'historico', 'tipo', 'descricao do lancamento'],
  detalhes: [
    'detalhes', 'detalhe', 'complemento', 'detalhamento hist', 'detalhamento historico',
    'descricao', 'destino', 'favorecido', 'beneficiario', 'contraparte',
  ],
  documento: ['n documento', 'no documento', 'numero documento', 'documento'],
  valor: ['valor', 'valor r', 'valor r$', 'vlr', 'vlr r'],
  // Diz se o lançamento é crédito ou débito, quando a coluna de valor não traz a
  // letra colada. Existe no extrato cru do Banco do Brasil.
  natureza: ['inf', 'natureza', 'd c', 'c d', 'movimentacao', 'movimento'],
  // Outros bancos não usam uma coluna de valor só: separam entrada e saída em
  // duas, com a saída em número negativo. É o caso do PagSeguro.
  entrada: ['entradas', 'entrada', 'credito', 'creditos'],
  saida: ['saidas', 'saida', 'debito', 'debitos'],
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

// Célula numérica vem como número e não tem ambiguidade. Só texto precisa de
// interpretação — e aí vale a regra brasileira, com a vírgula decimal.
function numeroDaCelula(bruto) {
  if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null;
  const t = String(bruto ?? '').trim();
  if (!t) return null;
  const negativo = /^-/.test(t);
  const limpo = t.replace(/[^\d.,]/g, '');
  if (!limpo) return null;
  const n = Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo);
  if (!Number.isFinite(n)) return null;
  return negativo ? -Math.abs(n) : n;
}

// Valor vem como texto: "1.067,79 C" no formato resumido, "1.067,79" no cru com
// a letra numa coluna à parte. `natureza` é essa coluna, quando ela existe.
//
// Sem letra em lugar nenhum não dá para saber se entrou ou saiu — e chutar aqui
// é transformar recebimento em despesa. Nesse caso devolve nulo e a linha fica
// de fora, contada como inválida.
function lerValor(bruto, natureza) {
  const texto = String(bruto ?? '').trim();
  const m = texto.match(/^(-?)\s*([\d.,]+)\s*([CD])?$/i);
  if (!m) return null;
  const valor = numeroDaCelula(m[2]);
  if (valor === null || !Number.isFinite(valor)) return null;

  // Ordem de confiança: a coluna de natureza, depois a letra colada no valor,
  // depois o sinal. O sinal vem por último porque é o mais frágil — mas em
  // extrato que só traz ele (a Stone é assim), é o que existe.
  const daColuna = String(natureza ?? '').trim().charAt(0).toUpperCase();
  const letra = ['C', 'D'].includes(daColuna) ? daColuna : (m[3] || '').toUpperCase();
  if (letra === 'C' || letra === 'D') return { valor: Math.abs(valor), saida: letra === 'D' };
  if (m[1] === '-') return { valor: Math.abs(valor), saida: true };
  // Positivo, sem letra e sem coluna de natureza: não dá para afirmar que saiu.
  // Fica de fora — dizer que é saída aqui inventaria despesa.
  return typeof bruto === 'number' && bruto < 0 ? { valor: Math.abs(valor), saida: true } : null;
}

// Quanto e para que lado. Cada banco conta de um jeito: coluna única com a letra
// colada, coluna única mais uma coluna de natureza, ou duas colunas separadas
// para entrada e saída. Os três chegam aqui e saem iguais.
function lerMovimento(linha, mapa) {
  if (mapa.saida !== undefined || mapa.entrada !== undefined) {
    const saiu = mapa.saida === undefined ? null : numeroDaCelula(linha[mapa.saida]);
    if (saiu) return { valor: Math.abs(saiu), saida: true };
    const entrou = mapa.entrada === undefined ? null : numeroDaCelula(linha[mapa.entrada]);
    if (entrou) return { valor: Math.abs(entrou), saida: false };
    return null;
  }
  return lerValor(linha[mapa.valor], mapa.natureza === undefined ? '' : linha[mapa.natureza]);
}

function lerData(bruto) {
  if (bruto instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${bruto.getFullYear()}-${p(bruto.getMonth() + 1)}-${p(bruto.getDate())}`;
  }
  // A hora pode vir junto ("30/06/2026 21:00") e é descartada: o lançamento é do
  // dia, e guardar a hora só criaria diferença entre extratos do mesmo dinheiro.
  const t = String(bruto ?? '').trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})\b/);
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
function impressaoDigital({ data, valor, documento, chave, ocorrencia = 1, bancoId = 0 }) {
  const doc = String(documento || '').replace(/^0+/, '');
  // Com número de documento, ele basta: é o identificador que o próprio banco dá
  // à transação, e data+valor+documento não repete dentro de um extrato. A
  // descrição fica DE FORA de propósito — o banco escreve o mesmo lançamento de
  // um jeito no arquivo do computador e de outro no do celular ("Impostos" x
  // "Pagamento de Impostos"), e incluí-la faria o mesmo pagamento parecer dois.
  //
  // Sem documento não há o que fazer além de usar a descrição, e aí vale a pena:
  // duas saídas no mesmo dia pelo mesmo valor existem.
  // O banco entra na identidade: um pagamento de R$ 500 no mesmo dia, saindo do
  // Banco do Brasil e da Stone, são dois pagamentos e não um.
  const conta = `${bancoId || 0}`;
  const base = doc
    ? `${conta}|${data}|${valor.toFixed(2)}|${doc}`
    : `${conta}|${data}|${valor.toFixed(2)}||${chave}`;
  // Pagamento repetido no mesmo dia, para o mesmo lugar e pelo mesmo valor
  // existe: o extrato do PagSeguro tem dois de R$ 565,53 para Laticínios
  // Conquista em 25/06. Sem número de documento eles seriam a mesma linha e um
  // sumiria calado. A ordem dentro do arquivo os separa, e é estável: o mesmo
  // arquivo lido de novo dá a mesma ordem.
  const conteudo = ocorrencia > 1 ? `${base}#${ocorrencia}` : base;
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

async function lerExtratoBanco(buffer, nomeArquivo, bancoId = 0) {
  const todas = await lerArquivo(buffer, nomeArquivo);
  if (!todas.length) throw new Error('Não foi possível ler nenhuma linha da planilha.');

  const cabecalho = acharCabecalho(todas);
  // O mínimo para reconhecer: uma data e algum jeito de saber o valor — seja uma
  // coluna de valor, seja a dupla entrada/saída de quem separa as duas.
  const temValor =
    cabecalho.mapa.valor !== undefined ||
    cabecalho.mapa.saida !== undefined ||
    cabecalho.mapa.entrada !== undefined;
  if (cabecalho.mapa.data === undefined || !temValor) {
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
  // Conta quantas vezes a mesma linha já apareceu, para separar repetição
  // legítima de reimportação.
  const jaVistas = new Map();
  // `rodape` separa o que nunca foi lançamento — o bloco de juros, IOF e resgate
  // automático que o banco põe no fim, e as linhas em branco. Contá-las como
  // "inválidas" faria parecer que se perdeu pagamento, quando não se perdeu nada.
  const ignoradas = { saldo: 0, entrada: 0, invalida: 0, rodape: 0 };

  for (const linha of linhas) {
    const lancamento = String(linha[mapa.lancamento] ?? '').trim();
    if (EH_SALDO.test(lancamento)) { ignoradas.saldo += 1; continue; }

    const data = lerData(linha[mapa.data]);
    const v = lerMovimento(linha, mapa);
    if (!data && !v) { ignoradas.rodape += 1; continue; }
    if (!data || !v || !v.valor) { ignoradas.invalida += 1; continue; }
    if (!v.saida) { ignoradas.entrada += 1; continue; }

    const detalhes = String(linha[mapa.detalhes] ?? '').trim();
    const documento = String(linha[mapa.documento] ?? '').trim();
    const chave = chaveDe(lancamento, detalhes);

    const identidade = `${data}|${v.valor.toFixed(2)}|${documento.replace(/^0+/, '')}|${chave}`;
    const ocorrencia = (jaVistas.get(identidade) || 0) + 1;
    jaVistas.set(identidade, ocorrencia);

    saidas.push({
      data,
      lancamento,
      detalhes,
      documento,
      valor: v.valor,
      forma: formaDe(lancamento),
      chave,
      impressao: impressaoDigital({ data, valor: v.valor, documento, chave, ocorrencia, bancoId }),
    });
  }

  // O site do banco oferece agrupar os Pix, e o agrupamento vale também para os
  // Pix ENVIADOS, que são saída. Dois Pix de um dia viram uma linha só, com o
  // número do documento zerado — mesmo dinheiro, linhas diferentes, identidades
  // diferentes. Importar o mesmo mês de um jeito e depois do outro duplicaria.
  //
  // Por isso o modo do arquivo sai daqui: é com ele que a importação recusa a
  // mistura.
  const agrupado = saidas.some((s) => /agrupad/i.test(s.lancamento));

  return {
    reconhecido: true,
    mapa,
    modo: agrupado ? 'agrupado' : 'detalhado',
    linha_cabecalho: cabecalho.indice,
    colunas: (todas[cabecalho.indice] || []).map((c, i) => ({ indice: i, titulo: String(c ?? '') })),
    saidas,
    ignoradas,
  };
}

module.exports = { lerExtratoBanco, chaveDe, formaDe, lerValor, lerData, impressaoDigital };
