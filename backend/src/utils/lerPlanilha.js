const ExcelJS = require('exceljs');
const { lerXlsxCru } = require('./lerXlsxCru');

// Leitura de extratos de adquirente (.xlsx / .csv).
//
// Cada adquirente entrega um layout diferente, e os arquivos costumam ter linhas
// de título antes do cabeçalho real. Em vez de fixar posições, procuramos a linha
// que parece ser o cabeçalho e mapeamos as colunas pelo nome — com o usuário
// confirmando na tela antes de gravar.

// Sinônimos observados nos extratos brasileiros (Cielo, Stone, Rede...).
const SINONIMOS = {
  data: ['data da venda', 'data venda', 'data', 'data transacao', 'data da transação', 'data transação', 'dt venda'],
  hora: ['hora', 'hora da venda', 'horario', 'horário', 'hora transacao'],
  forma: ['forma de pagamento', 'tipo de transacao', 'tipo de transação', 'modalidade', 'produto', 'tipo', 'forma'],
  bandeira: ['bandeira', 'bandeira do cartao', 'bandeira do cartão', 'rede', 'emissor'],
  valorBruto: ['valor bruto', 'valor da venda', 'valor venda', 'vl bruto', 'valor', 'bruto', 'valor total'],
  tarifa: ['taxa', 'tarifa', 'valor da taxa', 'desconto', 'comissao', 'comissão', 'valor taxa'],
  valorLiquido: ['valor liquido', 'valor líquido', 'vl liquido', 'liquido', 'líquido', 'valor a receber'],
  status: ['status', 'situacao', 'situação'],
};

const CAMPOS = Object.keys(SINONIMOS);

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function valorDaCelula(celula) {
  if (celula === null || celula === undefined) return '';
  const v = celula.value !== undefined ? celula.value : celula;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.text !== undefined) return v.text; // hyperlink / rich text
    if (v.result !== undefined) return v.result; // fórmula
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  }
  return v;
}

// Cabeçalho = a primeira linha em que pelo menos dois campos conhecidos aparecem.
function acharCabecalho(linhas) {
  const limite = Math.min(linhas.length, 30);
  let melhor = { indice: -1, acertos: 0, mapa: {} };

  for (let i = 0; i < limite; i += 1) {
    const mapa = {};
    let acertos = 0;

    linhas[i].forEach((celula, coluna) => {
      const texto = normalizar(celula);
      if (!texto) return;
      for (const campo of CAMPOS) {
        if (mapa[campo] !== undefined) continue;
        if (SINONIMOS[campo].some((s) => texto === s || texto.startsWith(`${s} `) || texto.includes(s))) {
          mapa[campo] = coluna;
          acertos += 1;
          break;
        }
      }
    });

    if (acertos > melhor.acertos) melhor = { indice: i, acertos, mapa };
  }

  // Havendo bruto e líquido, a taxa é a diferença entre os dois e a coluna de
  // desconto não é usada — então ela também não fica no mapa, senão a tela diria
  // que entendeu como "taxa" uma coluna que não entra em conta nenhuma. A Stone,
  // por exemplo, divide a taxa em MDR, antecipação e unificado: qualquer uma
  // delas sozinha seria a resposta errada.
  if (melhor.mapa.valorBruto !== undefined && melhor.mapa.valorLiquido !== undefined) {
    delete melhor.mapa.tarifa;
  }

  return melhor;
}

async function lerComExcelJS(buffer, ehCsv) {
  const workbook = new ExcelJS.Workbook();

  if (ehCsv) {
    const { Readable } = require('stream');
    await workbook.csv.read(Readable.from(buffer.toString('utf8')));
  } else {
    await workbook.xlsx.load(buffer);
  }

  const planilha = workbook.worksheets[0];
  if (!planilha) return [];

  const linhas = [];
  planilha.eachRow({ includeEmpty: false }, (row) => {
    const valores = [];
    row.eachCell({ includeEmpty: true }, (celula, coluna) => {
      valores[coluna - 1] = valorDaCelula(celula);
    });
    linhas.push(valores);
  });

  return linhas;
}

// O ExcelJS dá conta da maioria dos extratos, mas não de todos: o da Stone vem
// sem o atributo `r` nas células e ele quebra com um erro que não diz nada. Em
// vez de mandar o usuário converter o arquivo à mão, a leitura crua entra como
// segunda tentativa — o mesmo arquivo, lido direto do zip.
async function lerArquivo(buffer, nomeArquivo) {
  const ehCsv = /\.csv$/i.test(nomeArquivo || '');

  let linhas = [];
  let falhaExcelJS = null;
  try {
    linhas = await lerComExcelJS(buffer, ehCsv);
  } catch (err) {
    falhaExcelJS = err;
  }

  if (linhas.length || ehCsv) {
    if (!linhas.length) throw falhaExcelJS || new Error('A planilha está vazia.');
    return linhas;
  }

  try {
    linhas = await lerXlsxCru(buffer);
  } catch (err) {
    throw falhaExcelJS || err;
  }

  if (!linhas.length) throw falhaExcelJS || new Error('A planilha está vazia.');
  return linhas;
}

// Analisa o arquivo e devolve o que foi detectado, sem gravar nada.
async function analisarExtrato(buffer, nomeArquivo) {
  const linhas = await lerArquivo(buffer, nomeArquivo);
  if (!linhas.length) throw new Error('Não foi possível ler nenhuma linha da planilha.');

  const cabecalho = acharCabecalho(linhas);
  if (cabecalho.indice < 0 || cabecalho.acertos < 2) {
    return {
      reconhecido: false,
      colunas: (linhas[0] || []).map((c, i) => ({ indice: i, titulo: String(c ?? '') })),
      amostra: linhas.slice(0, 5),
      total_linhas: linhas.length,
    };
  }

  const titulos = linhas[cabecalho.indice];
  const dados = linhas.slice(cabecalho.indice + 1).filter((l) => l.some((c) => c !== '' && c !== null && c !== undefined));

  return {
    reconhecido: true,
    linha_cabecalho: cabecalho.indice,
    mapa: cabecalho.mapa,
    colunas: titulos.map((c, i) => ({ indice: i, titulo: String(c ?? '') })),
    amostra: dados.slice(0, 5),
    total_linhas: dados.length,
  };
}

module.exports = { lerArquivo, analisarExtrato, normalizar, valorDaCelula, SINONIMOS, CAMPOS };
