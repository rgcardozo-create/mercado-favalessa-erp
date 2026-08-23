const JSZip = require('jszip');

// Leitor do relatório "Finalizadoras Analítico - Por Caixa" (SGLinear), que é de
// onde sai o dinheiro do dia — o único valor que extrato de adquirente nunca sabe.
//
// O arquivo não é uma tabela: é um relatório impresso em planilha. Ele se repete
// em blocos, um por caixa e por dia:
//
//   Caixa: 101   Data: 46235          <- data em número de série do Excel
//   Código  Descrição  Percentual  Qtd.  Valor
//   1       Dinheiro   100,00%     44    743.43
//   Total: 743.43
//
// Por isso a leitura é por estado (guarda o último "Caixa:/Data:" visto), não por
// coluna fixa: as colunas mudam de posição conforme a largura do relatório.
//
// O ExcelJS não abre este arquivo — devolve zero abas, provavelmente por causa do
// [Content_Types].xml duplicado que o gerador escreve. Como o formato interno de
// um .xlsx é só um zip com XML, lemos direto: menos mágica e nada que dependa de
// o gerador do relatório ser bem-comportado.

const NUMERO_DE_SERIE_BASE = Date.UTC(1899, 11, 30);

function dataDoSerial(serial) {
  const dias = Number(serial);
  if (!Number.isFinite(dias) || dias <= 0) return null;
  return new Date(NUMERO_DE_SERIE_BASE + dias * 86400000).toISOString().slice(0, 10);
}

function textoDaTag(xml) {
  return xml.replace(/<[^>]+>/g, '');
}

function lerStringsCompartilhadas(xml) {
  if (!xml) return [];
  const itens = xml.match(/<si\b[^>]*\/>|<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
  return itens.map((si) => {
    const partes = si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
    return partes
      .map((t) => textoDaTag(t))
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  });
}

// Devolve as células de uma linha como { COLUNA: valor }, já resolvendo string
// compartilhada. Coluna é a letra ("AC"), porque é assim que o relatório
// identifica onde cada coisa está.
function celulasDaLinha(xmlLinha, strings) {
  const celulas = {};
  // A célula vazia (<c ... />) vem primeiro na alternativa de propósito: se a
  // forma com conteúdo for testada antes, ela casa a abertura da célula vazia e
  // segue até o próximo </c>, engolindo as células seguintes da linha.
  const encontradas = xmlLinha.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || [];

  for (const celula of encontradas) {
    const ref = (celula.match(/\sr="([A-Z]+)\d+"/) || [])[1];
    if (!ref) continue;
    const tipo = (celula.match(/\st="([^"]+)"/) || [])[1];
    const valorBruto = (celula.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    const inline = (celula.match(/<is>[\s\S]*?<\/is>/) || [])[0];

    let valor = valorBruto;
    if (valor === undefined && inline) valor = textoDaTag(inline);
    if (valor === undefined || valor === '') continue;
    if (tipo === 's') valor = strings[Number(valor)] ?? '';

    celulas[ref] = String(valor).trim();
  }

  return celulas;
}

const soNumero = (v) => Number(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));

// Aceita tanto "1234.56" quanto "1.234,56": o relatório grava o valor cru, mas
// versões do gerador já apareceram com máscara.
function paraValor(texto) {
  const cru = String(texto).trim();
  if (/^-?\d+(\.\d+)?$/.test(cru)) return Number(cru);
  return soNumero(cru);
}

// A finalizadora vem escrita pelo operador do PDV ("Dinheiro", "VENDA PRAZO"),
// então a classificação é pelo texto e não pelo código — código de finalizadora
// muda de loja para loja, o nome não.
function grupoDaFinalizadora(descricao) {
  const texto = String(descricao || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (texto.includes('dinheiro') || texto.includes('especie')) return 'dinheiro';
  if (texto.includes('prazo') || texto.includes('fiado') || texto.includes('crediario')) {
    return 'venda_prazo';
  }
  return null;
}

async function lerVendasPorCaixa(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const nomePlanilha = Object.keys(zip.files).find((n) => /^xl\/worksheets\/.+\.xml$/.test(n));
  if (!nomePlanilha) {
    throw new Error('Arquivo sem planilha reconhecível. Exporte o relatório em Excel (.xls/.xlsx).');
  }

  const arquivoStrings = zip.file('xl/sharedStrings.xml');
  const strings = lerStringsCompartilhadas(arquivoStrings ? await arquivoStrings.async('string') : '');
  const xml = await zip.file(nomePlanilha).async('string');

  const linhas = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];

  let caixa = null;
  let data = null;
  const registros = [];
  const descricoesVistas = new Set();

  for (const linha of linhas) {
    const celulas = celulasDaLinha(linha, strings);
    const valores = Object.values(celulas);

    // Cabeçalho do bloco: "Caixa:" e "Data:" na mesma linha. O número do caixa e
    // a data vêm nas células seguintes, cuja letra varia de relatório para
    // relatório — por isso procuramos pela posição relativa, não pela coluna.
    const indiceCaixa = valores.findIndex((v) => /^caixa:?$/i.test(v));
    if (indiceCaixa >= 0) {
      caixa = valores[indiceCaixa + 1] || null;
      const indiceData = valores.findIndex((v) => /^data:?$/i.test(v));
      data = indiceData >= 0 ? dataDoSerial(valores[indiceData + 1]) : null;
      continue;
    }

    // Linha de valor: tem descrição e valor, e não é o cabeçalho da tabelinha.
    const descricao = celulas.E;
    const valor = celulas.AC;
    if (!caixa || !data || !descricao || valor === undefined) continue;
    if (/^descri/i.test(descricao) || /^total:?$/i.test(descricao)) continue;

    descricoesVistas.add(descricao);
    registros.push({ data, pdv: caixa, descricao, valor: paraValor(valor) });
  }

  if (!registros.length) {
    throw new Error(
      'Nenhum lançamento encontrado. Esperado o relatório "Finalizadoras Analítico - Por Caixa".'
    );
  }

  // Um registro por dia e caixa, com as finalizadoras separadas. Somar tudo numa
  // coluna só jogaria a venda a prazo dentro do dinheiro — e ela não é dinheiro:
  // é venda que sai da loja hoje e entra no caixa daqui a trinta dias.
  const porDiaCaixa = new Map();
  const ignoradas = new Map();

  for (const r of registros) {
    const grupo = grupoDaFinalizadora(r.descricao);
    if (!grupo) {
      // Cartão e PIX também podem estar configurados como finalizadora no PDV,
      // mas eles vêm do extrato do adquirente. Contá-los aqui duplicaria a venda,
      // então ficam de fora — e são devolvidos para a tela poder dizer isso.
      ignoradas.set(r.descricao, (ignoradas.get(r.descricao) || 0) + r.valor);
      continue;
    }
    const chave = `${r.data}|${r.pdv}`;
    const linha = porDiaCaixa.get(chave) || { data: r.data, pdv: r.pdv, dinheiro: 0, venda_prazo: 0 };
    linha[grupo] += r.valor;
    porDiaCaixa.set(chave, linha);
  }

  if (!porDiaCaixa.size) {
    throw new Error(
      'O relatório não traz nenhuma finalizadora de dinheiro ou venda a prazo. ' +
        `Encontrei: ${[...descricoesVistas].join(', ')}.`
    );
  }

  const arredondar = (n) => Math.round(n * 100) / 100;
  const linhasFinais = [...porDiaCaixa.values()]
    .map((l) => ({ ...l, dinheiro: arredondar(l.dinheiro), venda_prazo: arredondar(l.venda_prazo) }))
    .sort((a, b) => (a.data === b.data ? a.pdv.localeCompare(b.pdv) : a.data.localeCompare(b.data)));

  const datas = linhasFinais.map((l) => l.data);
  const somar = (campo) => arredondar(linhasFinais.reduce((a, l) => a + l[campo], 0));

  return {
    linhas: linhasFinais,
    descricoes: [...descricoesVistas],
    ignoradas: [...ignoradas.entries()].map(([descricao, valor]) => ({
      descricao,
      valor: arredondar(valor),
    })),
    caixas: [...new Set(linhasFinais.map((l) => l.pdv))].sort(),
    periodo: { de: datas[0], ate: datas[datas.length - 1] },
    totais: { dinheiro: somar('dinheiro'), venda_prazo: somar('venda_prazo') },
    total: arredondar(somar('dinheiro') + somar('venda_prazo')),
  };
}

module.exports = { lerVendasPorCaixa, dataDoSerial, grupoDaFinalizadora };
