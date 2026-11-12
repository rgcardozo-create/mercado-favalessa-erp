const zlib = require('zlib');

// Leitura do "Relatório de Pagamentos Realizados" do Banco do Brasil (PDF).
//
// O site do BB só entrega esse relatório em PDF. O que ele gera pelo botão de
// download é um PDF de texto (feito com jsPDF): cada pedaço de texto vem com a
// posição na página, sem compressão. Isso dispensa uma biblioteca de PDF —
// basta achar os textos e montar as linhas pela posição.
//
// O mesmo relatório IMPRESSO ("Microsoft Print to PDF") vira imagem, sem texto
// nenhum. Esse não dá para ler, e a mensagem de erro diz como baixar certo.
//
// Layout de cada pagamento (duas linhas):
//   1   11/11/2026  NESTLE BRASIL LTDA.   Nosso Número: 2372190016712627100362130   R$ 377,52
//                   CNPJ: 60.409.075/0001-52   Boleto   Pagamento(Online)
// O "Nosso Número" do relatório é o campo livre do código de barras (as 25
// posições finais), e não o nosso número impresso no boleto. É por ele que o
// pagamento casa com o boleto lido pelo leitor no cadastro.

// Strings de PDF: \( \) \\ e octais (\351 = é em WinAnsi).
function decodificarString(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => {
    const especiais = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
    if (especiais[c] !== undefined) return especiais[c];
    return String.fromCharCode(parseInt(c, 8));
  });
}

// Conteúdo de cada stream, descomprimido quando vier com FlateDecode.
function streamsDoPdf(buffer) {
  const bruto = buffer.toString('latin1');
  const streams = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(bruto))) {
    const inicio = m.index + m[0].length;
    const fim = bruto.indexOf('endstream', inicio);
    if (fim < 0) break;
    let conteudo = buffer.subarray(inicio, fim);
    if (/FlateDecode/.test(m[1])) {
      try {
        conteudo = zlib.inflateSync(conteudo);
      } catch {
        continue; // imagem ou fonte embutida: não é texto
      }
    }
    streams.push(conteudo.toString('latin1'));
    re.lastIndex = fim;
  }
  return streams;
}

// Pedaços de texto com posição. Cada stream com texto é uma página, na ordem
// em que aparecem no arquivo.
function textosDoPdf(buffer) {
  const itens = [];
  let pagina = 0;
  for (const conteudo of streamsDoPdf(buffer)) {
    const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Td\s*\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g;
    let m;
    let achou = false;
    while ((m = re.exec(conteudo))) {
      achou = true;
      itens.push({ pagina, x: Number(m[1]), y: Number(m[2]), texto: decodificarString(m[3]).trim() });
    }
    if (achou) pagina += 1;
  }
  return itens.filter((i) => i.texto);
}

// Junta os pedaços em linhas: mesma página e mesma altura. De cima para baixo
// (no PDF o y cresce para cima), e da esquerda para a direita.
function linhasDe(itens) {
  const ordenados = [...itens].sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  const linhas = [];
  for (const item of ordenados) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && ultima.pagina === item.pagina && Math.abs(ultima.y - item.y) < 1) {
      ultima.itens.push(item);
    } else {
      linhas.push({ pagina: item.pagina, y: item.y, itens: [item] });
    }
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}

const paraISO = (br) => {
  const m = String(br).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const paraValor = (texto) => {
  const m = String(texto).match(/-?[\d.]+,\d{2}/);
  return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : null;
};

const soDigitos = (t) => String(t ?? '').replace(/\D/g, '');

const ERRO_IMAGEM =
  'Não encontrei texto neste PDF. Ele parece ter sido impresso como imagem ("Imprimir como PDF"). ' +
  'No site do BB, use o botão de baixar o relatório em PDF, e não o de imprimir.';

function lerRelatorioPagamentosBB(buffer) {
  const itens = textosDoPdf(buffer);
  if (!itens.length) throw new Error(ERRO_IMAGEM);

  const todoTexto = itens.map((i) => i.texto).join(' ');
  if (!/Pagamentos Realizados/i.test(todoTexto)) {
    throw new Error('Este PDF não é o "Relatório de Pagamentos Realizados" do Banco do Brasil.');
  }

  const periodo = todoTexto.match(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
  const qtdTotal = todoTexto.match(/QUANTIDADE DE PAGAMENTOS:\s*(\d+)/i);
  const valorTotal = todoTexto.match(/VALOR TOTAL:\s*R\$\s*([\d.]+,\d{2})/i);

  const linhas = linhasDe(itens);
  const pagamentos = [];

  for (let i = 0; i < linhas.length; i += 1) {
    const [seq, data, ...resto] = linhas[i].itens;
    if (!seq || !data || !/^\d+$/.test(seq.texto) || !/^\d{2}\/\d{2}\/\d{4}$/.test(data.texto)) continue;

    // Valor é o pedaço com "R$" (última coluna); nome e terceira coluna vêm
    // antes dele, na ordem da página.
    const valorItem = resto.find((r) => /R\$/.test(r.texto));
    const meio = resto.filter((r) => r !== valorItem);
    const colunaNN = meio.find((r) => /Nosso N[uú]mero/i.test(r.texto));
    // O nome é o primeiro pedaço do meio; a terceira coluna, quando não é
    // nosso número, é a descrição do convênio (DARF, Brasilprev, fatura...).
    const nome = meio[0] && meio[0] !== colunaNN ? meio[0].texto : '';
    const descricao = meio.filter((r) => r !== colunaNN && r.texto !== nome).map((r) => r.texto).join(' ');

    // Linha de baixo: CNPJ, tipo (Boleto, Convênio, Pix...) e modalidade.
    const prox = linhas[i + 1];
    const detalhe = prox && prox.pagina === linhas[i].pagina && linhas[i].y - prox.y < 15 ? prox.itens : [];
    const cnpjItem = detalhe.find((d) => /CNPJ/i.test(d.texto));
    const outros = detalhe.filter((d) => d !== cnpjItem).map((d) => d.texto);
    const cnpj = cnpjItem ? soDigitos(cnpjItem.texto) : '';

    pagamentos.push({
      seq: Number(seq.texto),
      data: paraISO(data.texto),
      nome,
      // CNPJ zerado é como o BB mostra pagamento sem beneficiário (fatura do cartão).
      cnpj: cnpj && !/^0+$/.test(cnpj) ? cnpj : null,
      nosso_numero: colunaNN ? soDigitos(colunaNN.texto) || null : null,
      descricao: descricao || null,
      tipo: outros[0] || null,
      modalidade: outros[1] || null,
      valor: valorItem ? paraValor(valorItem.texto) : null,
    });
  }

  if (!pagamentos.length) {
    throw new Error('Não encontrei nenhum pagamento neste relatório.');
  }

  // O rodapé diz quantos pagamentos e quanto somam. Leitura que não bate com
  // ele não é importada: é sinal de que o layout mudou e alguma linha escapou.
  const soma = Number(pagamentos.reduce((a, p) => a + (p.valor || 0), 0).toFixed(2));
  if (qtdTotal && Number(qtdTotal[1]) !== pagamentos.length) {
    throw new Error(
      `O relatório diz ${qtdTotal[1]} pagamentos e eu li ${pagamentos.length}. ` +
        'O layout do BB pode ter mudado: me mande o arquivo para eu ajustar a leitura.'
    );
  }
  if (valorTotal && Math.abs(paraValor(valorTotal[1]) - soma) > 0.009) {
    throw new Error(
      `O relatório soma R$ ${valorTotal[1]} e eu li R$ ${soma.toFixed(2).replace('.', ',')}. ` +
        'O layout do BB pode ter mudado: me mande o arquivo para eu ajustar a leitura.'
    );
  }

  return {
    periodo: periodo ? { de: paraISO(periodo[1]), ate: paraISO(periodo[2]) } : null,
    total: { quantidade: pagamentos.length, valor: soma },
    pagamentos,
  };
}

module.exports = { lerRelatorioPagamentosBB, textosDoPdf };
