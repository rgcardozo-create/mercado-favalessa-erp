// Leitor do "Relatórios Contas a Receber" do SGLinear — o caderno de fiado
// como o PDV o enxerga.
//
// O arquivo é um relatório impresso, não uma tabela: cada cliente é um bloco
// com cabeçalho próprio, e o exportador só emite célula preenchida. Por isso as
// colunas ESCORREGAM de linha para linha — um título com data de baixa empurra
// tudo o que vem depois. Ler por posição fixa daria certo numas linhas e errado
// noutras, que é exatamente o tipo de erro que passa despercebido.
//
// Aqui a leitura é estrutural: acha as datas, acha a cauda de números, e deduz o
// resto. E, o melhor, o próprio arquivo traz "Abertos/Baixados" por cliente e um
// total geral — dá para CONFERIR a leitura contra ele antes de gravar qualquer
// coisa.

const ehData = (v) => v instanceof Date && !Number.isNaN(v.getTime());
const iso = (v) => v.toISOString().slice(0, 10);

function paraNumero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

// "Digit." é a data de digitação e mora na coluna 8; emissão, vencimento,
// vencimento real e baixa ficam da 12 em diante. Descartar a de digitação é o
// que separa um título aberto (3 datas) de um baixado (4) — sem isso, um título
// aberto com data de digitação preenchida seria lido como pago.
const PRIMEIRA_COLUNA_DE_PERIODO = 11;

// A coluna do número do documento. Esta não escorrega: o deslocamento das
// outras começa depois dela.
const COLUNA_DOCUMENTO = 2;

function celulasUteis(linha) {
  return (linha || [])
    .map((c, i) => ({ i, c }))
    .filter((x) => x.c !== null && x.c !== undefined && String(x.c) !== '');
}

function textoDaLinha(celulas) {
  return celulas.map((x) => (ehData(x.c) ? iso(x.c) : String(x.c))).join(' ');
}

function lerTitulo(celulas) {
  const datas = celulas.filter((x) => ehData(x.c) && x.i >= PRIMEIRA_COLUNA_DE_PERIODO);
  if (datas.length < 3) return null;

  // A cauda é sempre Bruto, Desconto, Multa, Total — nessa ordem, no fim.
  const numeros = celulas.filter((x) => !ehData(x.c) && paraNumero(x.c) !== null);
  if (numeros.length < 4) return null;
  const cauda = numeros.slice(-4);

  const historico =
    celulas.map((x) => x.c).find((c) => typeof c === 'string' && /[A-Za-zÀ-ú]{3}/.test(c)) || '';

  // O documento mora na coluna 2 e só nela. Pegar "a segunda célula preenchida"
  // parecia equivalente e não é: o título sem documento tem a coluna 2 vazia, e
  // a segunda célula passa a ser a PARCELA — que vale 1 em todos eles. Nove
  // títulos viraram o mesmo "documento 1", se sobrescreveram na importação, e
  // R$ 712,58 sumiram do caderno sem nenhum erro aparecer.
  const doc = celulas.find((x) => x.i === COLUNA_DOCUMENTO);

  return {
    documento: doc ? String(doc.c).trim() : '',
    historico: String(historico).trim(),
    emissao: iso(datas[0].c),
    vencimento: iso(datas[1].c),
    // Quatro datas no período = a última é a baixa. Três = ainda em aberto.
    baixa: datas.length >= 4 ? iso(datas[datas.length - 1].c) : null,
    valor: paraNumero(cauda[3].c),
  };
}

function lerVendaPrazo(linhas) {
  const clientes = [];
  const porCodigo = new Map();
  let atual = null;
  let geral = null;

  for (const linha of linhas) {
    const celulas = celulasUteis(linha);
    if (!celulas.length) continue;
    const texto = textoDaLinha(celulas);

    // Total geral do relatório, no fim de tudo. Serve de conferência.
    const totalGeral = texto.match(/Total Abertos:\s*([\d.,]+).*?Total Baixados:\s*([\d.,]+)/);
    if (totalGeral) {
      geral = { abertos: paraNumero(totalGeral[1]), baixados: paraNumero(totalGeral[2]) };
      atual = null;
      continue;
    }

    const cabecalho = texto.match(/Cliente:\s*(\d+)\s*-\s*(.+?)(?:\s+Fone:|\s+Endereço:|$)/);
    if (cabecalho) {
      const codigo = cabecalho[1];
      // O relatório é paginado e repete o cabeçalho quando o bloco do cliente
      // atravessa a quebra de página. As partes são o mesmo cliente.
      if (porCodigo.has(codigo)) {
        atual = porCodigo.get(codigo);
      } else {
        atual = { codigo, nome: cabecalho[2].trim(), titulos: [], abertos: 0, baixados: 0 };
        porCodigo.set(codigo, atual);
        clientes.push(atual);
      }
      continue;
    }

    if (!atual) continue;

    const totais = texto.match(/Abertos:\s*([\d.,]*)\s*Baixados:\s*([\d.,]*)/);
    if (totais) {
      atual.abertos += paraNumero(totais[1]) || 0;
      atual.baixados += paraNumero(totais[2]) || 0;
      continue;
    }

    // Linha de título começa pela filial.
    if (!/^0*\d{1,3}$/.test(String(celulas[0].c))) continue;
    const titulo = lerTitulo(celulas);
    if (titulo && titulo.valor !== null) atual.titulos.push(titulo);
  }

  return { clientes, geral, ...conferir(clientes, geral) };
}

// Confere a leitura contra os totais que o próprio arquivo declara.
//
// Esta é a parte que importa mais que o resto: um relatório com colunas que
// escorregam é fácil de ler quase certo, e "quase certo" num caderno de fiado é
// cobrar do cliente errado. Se não bate, é para não importar.
function conferir(clientes, geral) {
  const divergentes = [];
  let abertos = 0;
  let baixados = 0;
  let titulos = 0;

  for (const c of clientes) {
    const ab = arredonda(c.titulos.filter((t) => !t.baixa).reduce((a, t) => a + t.valor, 0));
    const ba = arredonda(c.titulos.filter((t) => t.baixa).reduce((a, t) => a + t.valor, 0));
    c.lido = { abertos: ab, baixados: ba };
    abertos += ab;
    baixados += ba;
    titulos += c.titulos.length;

    if (Math.abs(ab - c.abertos) > 0.02 || Math.abs(ba - c.baixados) > 0.02) {
      divergentes.push({ codigo: c.codigo, nome: c.nome, lido: c.lido, arquivo: { abertos: c.abertos, baixados: c.baixados } });
    }
  }

  const soma = { abertos: arredonda(abertos), baixados: arredonda(baixados), titulos };
  const bateGeral =
    !geral ||
    (Math.abs(soma.abertos - geral.abertos) < 0.05 && Math.abs(soma.baixados - geral.baixados) < 0.05);

  return { soma, divergentes, confere: bateGeral && divergentes.length === 0 };
}

const arredonda = (n) => Math.round(n * 100) / 100;

module.exports = { lerVendaPrazo, PRIMEIRA_COLUNA_DE_PERIODO };
