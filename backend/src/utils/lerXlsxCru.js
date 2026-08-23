const JSZip = require('jszip');

// Leitor de .xlsx direto do zip, para os arquivos que o ExcelJS recusa.
//
// Um .xlsx é só um zip com XML dentro, e nem todo gerador escreve esse XML como
// o Excel escreveria. O extrato da Stone, por exemplo, omite o atributo `r` das
// células (a referência "C7"): as células valem pela ordem em que aparecem. O
// ExcelJS conta com esse atributo e quebra com "Cannot read properties of
// undefined (reading 'col')" — mensagem que não diz nada a quem só quer importar
// o extrato do mês.
//
// Por isso aqui a coluna sai do `r` quando ele existe e da ordem quando não
// existe. É o mesmo que o Excel faz ao abrir o arquivo.

const NUMERO_DE_SERIE_BASE = Date.UTC(1899, 11, 30);

// Formatos de data embutidos no padrão do Excel. Os personalizados são
// reconhecidos pelo código de formatação (d/m/y), como o "yyyy-mm-dd hh:mm:ss"
// que a Stone declara.
const FORMATOS_DATA_PADRAO = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function desescapar(texto) {
  return texto.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENTIDADES[e]);
}

function textoDasTags(xml) {
  const partes = xml.match(/<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
  return desescapar(partes.map((t) => t.replace(/<[^>]+>/g, '')).join(''));
}

function lerStringsCompartilhadas(xml) {
  if (!xml) return [];
  const itens = xml.match(/<si\b[^>]*\/>|<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
  return itens.map(textoDasTags);
}

// Descobre, para cada estilo de célula, se ele é de data. Sem isso um "28/07"
// gravado como número de série viraria 46231 na tela.
function lerEstilosDeData(xml) {
  if (!xml) return [];

  const personalizados = new Set();
  for (const fmt of xml.match(/<numFmt\b[^>]*\/?>/g) || []) {
    const id = Number((fmt.match(/numFmtId="(\d+)"/) || [])[1]);
    const codigo = desescapar((fmt.match(/formatCode="([^"]*)"/) || [])[1] || '');
    // O texto entre aspas e o que vem escapado com barra saem antes de olhar as
    // letras: senão o formato de moeda `"R$" #,##0.00` seria lido como data por
    // causa do "d" que não existe ali. Sobrando d, y ou h, é data ou hora.
    const semTexto = codigo.replace(/"[^"]*"/g, '').replace(/\\./g, '');
    if (/[dyh]/i.test(semTexto)) personalizados.add(id);
  }

  const bloco = (xml.match(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/) || [])[0] || '';
  return (bloco.match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || []).map((xf) => {
    const id = Number((xf.match(/numFmtId="(\d+)"/) || [])[1]);
    return FORMATOS_DATA_PADRAO.has(id) || personalizados.has(id);
  });
}

// "AC" -> 28 (índice zero).
function colunaDaReferencia(ref) {
  let n = 0;
  for (const letra of ref) n = n * 26 + (letra.charCodeAt(0) - 64);
  return n - 1;
}

function dataDoSerial(serial) {
  const dias = Number(serial);
  if (!Number.isFinite(dias) || dias <= 0) return null;
  return new Date(NUMERO_DE_SERIE_BASE + Math.round(dias * 86400000));
}

function valorDaCelula(celula, strings, estilosData) {
  const tipo = (celula.match(/\st="([^"]+)"/) || [])[1];

  if (tipo === 'inlineStr') {
    const inline = (celula.match(/<is>[\s\S]*?<\/is>/) || [])[0];
    return inline ? textoDasTags(inline) : '';
  }

  const bruto = (celula.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
  if (bruto === undefined || bruto === '') return '';

  if (tipo === 's') return strings[Number(bruto)] ?? '';
  if (tipo === 'str' || tipo === 'e') return desescapar(bruto);
  if (tipo === 'b') return bruto === '1';

  const numero = Number(bruto);
  if (!Number.isFinite(numero)) return desescapar(bruto);

  const estilo = Number((celula.match(/\ss="(\d+)"/) || [])[1] || 0);
  if (estilosData[estilo]) {
    const data = dataDoSerial(numero);
    if (data) return data;
  }

  return numero;
}

// Devolve as linhas como array de arrays, no mesmo formato que a leitura por
// ExcelJS entrega — quem chama não precisa saber por qual caminho o arquivo veio.
async function lerXlsxCru(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const nomePlanilha = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n))
    .sort()[0];
  if (!nomePlanilha) throw new Error('Arquivo sem planilha reconhecível.');

  const arquivoStrings = zip.file('xl/sharedStrings.xml');
  const strings = lerStringsCompartilhadas(arquivoStrings ? await arquivoStrings.async('string') : '');

  const arquivoEstilos = zip.file('xl/styles.xml');
  const estilosData = lerEstilosDeData(arquivoEstilos ? await arquivoEstilos.async('string') : '');

  const xml = await zip.file(nomePlanilha).async('string');
  const linhas = [];

  for (const linhaXml of xml.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) || []) {
    const valores = [];
    let proximaColuna = 0;

    // A célula vazia (<c ... />) vem primeiro na alternativa de propósito: se a
    // forma com conteúdo for testada antes, ela casa a abertura da célula vazia
    // e segue até o próximo </c>, engolindo as células seguintes da linha.
    for (const celula of linhaXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || []) {
      const ref = (celula.match(/\sr="([A-Z]+)\d+"/) || [])[1];
      const coluna = ref ? colunaDaReferencia(ref) : proximaColuna;
      proximaColuna = coluna + 1;
      valores[coluna] = valorDaCelula(celula, strings, estilosData);
    }

    for (let i = 0; i < valores.length; i += 1) {
      if (valores[i] === undefined) valores[i] = '';
    }
    if (valores.some((v) => v !== '' && v !== null && v !== undefined)) linhas.push(valores);
  }

  return linhas;
}

module.exports = { lerXlsxCru, dataDoSerial };
