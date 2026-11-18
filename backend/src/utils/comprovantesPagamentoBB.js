const { streamsDoPdf, decodificarString, ERRO_IMAGEM } = require('./relatorioPagamentosBB');
const { lerCodigoBoleto } = require('./boleto');

// Leitura do "Consultas - Extrato de pagamentos e transferências" do Banco do
// Brasil (PDF): um comprovante por boleto pago, um atrás do outro.
//
// É o arquivo mais completo que o BB entrega sobre um pagamento. Cada
// comprovante traz, além do que o "Relatório de Pagamentos Realizados" tem:
// - a linha digitável inteira, de onde sai o código de barras do boleto;
// - o vencimento e o valor do boleto, separados do valor cobrado;
// - os juros/multa ou o desconto/abatimento, quando houve;
// - o beneficiário e o beneficiário final, com CNPJ;
// - o número de autenticação do pagamento.
//
// Com isso, um boleto que nunca foi cadastrado pode ser cadastrado ali mesmo,
// já certo — vencimento e valor originais, código de barras —, e o pagamento
// com desconto fecha a conta, em vez de deixar a diferença em aberto.
//
// O PDF é gerado pelo iText, com cada linha do comprovante num pedaço de texto
// (`1 0 0 1 x y Tm (texto)Tj`), na ordem da página, em fonte de largura fixa.
// Basta ler os pedaços em ordem: cada um é uma linha.
//
//   17/11/2026    -  BANCO  DO  BRASIL  -   23:07:51
//        COMPROVANTE DE PAGAMENTO DE TITULOS
//   CLIENTE: FAVALESSA M EIRELI
//   AGENCIA: 4292-7          CONTA:         14.369-3
//   BCO BANESTES S.A.
//   02190331155410001454420474021357116500000055000
//   BENEFICIARIO:
//   GV-BUS
//   ...
//   NR. DOCUMENTO                             111.701
//   DATA DE VENCIMENTO                     04/12/2026
//   DATA DO PAGAMENTO                      17/11/2026
//   VALOR DO DOCUMENTO                         550,00
//   VALOR COBRADO                              550,00
//   NR.AUTENTICACAO           9.3E7.694.446.243.A95

const soDigitos = (t) => String(t ?? '').replace(/\D/g, '');

const paraISO = (br) => {
  const m = String(br || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const paraValor = (texto) => {
  const m = String(texto || '').match(/-?[\d.]+,\d{2}/);
  return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : null;
};

// As linhas de texto do PDF, na ordem em que aparecem.
function linhasDoPdf(buffer) {
  const linhas = [];
  for (const conteudo of streamsDoPdf(buffer)) {
    const re = /\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g;
    let m;
    while ((m = re.exec(conteudo))) linhas.push(decodificarString(m[1]).replace(/\s+$/, ''));
  }
  return linhas;
}

const ehComprovante = (linhas) => linhas.some((l) => /^\s*COMPROVANTE DE /.test(l));

// "NR. DOCUMENTO                             111.701" → ['NR. DOCUMENTO', '111.701'].
// O rótulo e o valor são separados por dois ou mais espaços.
function rotuloEValor(linha) {
  const m = String(linha).trim().match(/^(.+?)\s{2,}(\S.*)$/);
  return m ? [m[1].trim().toUpperCase(), m[2].trim()] : [String(linha).trim().toUpperCase(), ''];
}

// O nome vem na linha de baixo do rótulo ("BENEFICIARIO:" / "GV-BUS"), e o CNPJ
// numa linha "CNPJ:" logo depois. Lê os dois a partir do rótulo.
function pessoaApos(linhas, i) {
  const nome = (linhas[i + 1] || '').trim();
  const cnpjLinha = linhas.slice(i + 1, i + 4).find((l) => /^\s*(CNPJ|CPF)\s*:/i.test(l));
  return { nome: /^\s*(CNPJ|CPF)\s*:/i.test(nome) ? '' : nome, cnpj: cnpjLinha ? soDigitos(cnpjLinha) : '' };
}

// Lê um comprovante de pagamento de título (boleto). `linhas` vai do título
// até antes do próximo comprovante.
function lerTitulo(linhas) {
  const campos = {};
  const pessoas = {};
  let linhaDigitavel = null;
  let bancoBeneficiario = null;
  let conta = null;

  linhas.forEach((linha, i) => {
    const t = linha.trim();
    const conta_ = t.match(/AGENCIA:\s*([\d-]+)\s+CONTA:\s*([\d.-]+)/i);
    if (conta_) conta = { agencia: conta_[1], conta: conta_[2] };

    // A linha digitável: 47 números (boleto bancário) ou 48 (arrecadação).
    const digitos = soDigitos(t);
    if (!linhaDigitavel && /^[\d .]+$/.test(t) && (digitos.length === 47 || digitos.length === 48)) {
      linhaDigitavel = digitos;
      // O banco de quem emitiu o boleto vem na linha de cima, entre os
      // separadores ("BCO BANESTES S.A.").
      const acima = linhas.slice(0, i).reverse().find((l) => l.trim() && !/^[-=\s]+$/.test(l));
      if (acima && !/AGENCIA:/i.test(acima)) bancoBeneficiario = acima.trim();
    }

    const rotulo = t.toUpperCase();
    if (['BENEFICIARIO:', 'NOME FANTASIA:', 'BENEFICIARIO FINAL:', 'PAGADOR:'].includes(rotulo)) {
      pessoas[rotulo] = pessoaApos(linhas, i);
      return;
    }
    const [r, v] = rotuloEValor(t);
    if (v) campos[r] = v;
  });

  const beneficiario = pessoas['BENEFICIARIO:'] || { nome: '', cnpj: '' };
  const fantasia = pessoas['NOME FANTASIA:'] || { nome: '', cnpj: '' };
  const final = pessoas['BENEFICIARIO FINAL:'] || { nome: '', cnpj: '' };

  // Quem recebe de verdade é o beneficiário final: num boleto emitido por uma
  // plataforma de cobrança, o "beneficiário" é a plataforma. O nome mais
  // completo é o fantasia — o beneficiário vem cortado ("UNIMED VITORIA
  // COOPERATIVA DE" × "UNIMED VITORIA COOPERATIVA DE TRABA").
  const cnpj = final.cnpj || beneficiario.cnpj || null;
  const nome = [fantasia.nome, final.nome, beneficiario.nome].filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';

  const codigo = linhaDigitavel ? lerCodigoBoleto(linhaDigitavel) : null;
  const valido = codigo && !codigo.erro ? codigo : null;

  const valor = paraValor(campos['VALOR COBRADO']);
  const valorDocumento = paraValor(campos['VALOR DO DOCUMENTO']);
  const juros = paraValor(campos['JUROS/MULTA']) || 0;
  const desconto = paraValor(campos['DESCONTO/ABATIMENTO']) || 0;

  return {
    data: paraISO(campos['DATA DO PAGAMENTO']),
    nome,
    cnpj: cnpj && !/^0+$/.test(cnpj) ? cnpj : null,
    beneficiario: beneficiario.nome || null,
    beneficiario_cnpj: beneficiario.cnpj || null,
    banco_beneficiario: bancoBeneficiario,
    // O "nosso número" do relatório do BB é o campo livre do código de barras.
    // Guardado igual aqui, o mesmo pagamento tem a mesma referência venha ele
    // pelo relatório ou pelo comprovante, e não é baixado duas vezes.
    nosso_numero: valido && valido.campo_livre ? valido.campo_livre : null,
    codigo_barras: valido ? valido.codigo_barras : null,
    linha_digitavel: linhaDigitavel,
    linha_digitavel_invalida: Boolean(linhaDigitavel && !valido),
    numero_documento: campos['NR. DOCUMENTO'] || null,
    autenticacao: campos['NR.AUTENTICACAO'] || campos['NR. AUTENTICACAO'] || null,
    vencimento: paraISO(campos['DATA DE VENCIMENTO']),
    valor_documento: valorDocumento,
    juros,
    desconto,
    valor,
    conta_pagadora: conta,
    tipo: 'Boleto',
    descricao: bancoBeneficiario ? `Boleto ${bancoBeneficiario}` : null,
  };
}

function lerComprovantesPagamentoBB(buffer) {
  const linhas = linhasDoPdf(buffer);
  if (!linhas.length) throw new Error(ERRO_IMAGEM);
  if (!ehComprovante(linhas)) {
    throw new Error('Este PDF não é o extrato de comprovantes de pagamento do Banco do Brasil.');
  }

  // Cada comprovante começa no título "COMPROVANTE DE ...". O cabeçalho dele
  // (data e hora da emissão) fica na linha de cima, e não importa.
  const inicios = [];
  linhas.forEach((l, i) => { if (/^\s*COMPROVANTE DE /.test(l)) inicios.push(i); });

  const pagamentos = [];
  const naoLidos = [];
  inicios.forEach((inicio, k) => {
    const bloco = linhas.slice(inicio, inicios[k + 1] === undefined ? linhas.length : inicios[k + 1]);
    const titulo = bloco[0].trim();
    if (!/PAGAMENTO DE TITULOS/.test(titulo)) {
      // Pix, transferência, tributo, convênio: ainda sem leitura. Vai contado,
      // para a pessoa saber que existe e não achar que se perdeu.
      naoLidos.push({ titulo, valor: paraValor(bloco.find((l) => /VALOR/.test(l))) });
      return;
    }
    const p = lerTitulo(bloco);
    if (!p.data || !p.valor) {
      naoLidos.push({ titulo, valor: p.valor, motivo: 'Sem data ou valor do pagamento.' });
      return;
    }
    pagamentos.push({ seq: pagamentos.length + 1, ...p });
  });

  if (!pagamentos.length) {
    throw new Error(
      naoLidos.length
        ? `Li ${naoLidos.length} comprovante(s), mas nenhum é de pagamento de boleto (${naoLidos[0].titulo}).`
        : 'Não encontrei nenhum comprovante de pagamento neste PDF.'
    );
  }

  // Conferência da própria leitura: valor do documento + juros − desconto tem
  // de dar o valor cobrado. Se não der, o layout mudou e algum número foi lido
  // da linha errada — melhor parar do que gravar conta errada.
  for (const p of pagamentos) {
    if (p.valor_documento !== null) {
      const esperado = Number((p.valor_documento + p.juros - p.desconto).toFixed(2));
      if (Math.abs(esperado - p.valor) > 0.009) {
        throw new Error(
          `No comprovante de ${p.nome || 'um boleto'} (${p.data}), documento + juros − desconto não dá o valor cobrado. ` +
            'O layout do BB pode ter mudado: me mande o arquivo para eu ajustar a leitura.'
        );
      }
    }
  }

  const datas = pagamentos.map((p) => p.data).sort();
  const soma = Number(pagamentos.reduce((a, p) => a + p.valor, 0).toFixed(2));
  return {
    formato: 'comprovantes',
    periodo: { de: datas[0], ate: datas[datas.length - 1] },
    total: { quantidade: pagamentos.length, valor: soma },
    pagamentos,
    nao_lidos: naoLidos,
    conta_pagadora: pagamentos[0].conta_pagadora || null,
  };
}

module.exports = { lerComprovantesPagamentoBB, linhasDoPdf, ehComprovante, lerTitulo };
