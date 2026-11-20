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

// O BB entrega o "Extrato de pagamentos e transferências" em dois desenhos,
// às vezes misturados no mesmo arquivo:
// - comprovante completo, em texto corrido de largura fixa ("COMPROVANTE DE
//   PAGAMENTO DE TITULOS", com beneficiário, CNPJ e vencimento), e o do SISBB
//   (Pix, débito automático);
// - ficha resumida, em duas colunas: "Agência", "Conta corrente", o tipo
//   ("Títulos/Cobrança", "Convênio") e pares rótulo/valor. A ficha de boleto
//   não traz o nome nem o CNPJ de quem recebeu.
const ehFichaResumida = (linhas, i) =>
  String(linhas[i] || '').trim() === 'Agência' && String(linhas[i + 2] || '').trim() === 'Conta corrente';

const ehComprovante = (linhas) =>
  linhas.some((l, i) => /^\s*COMPROVANTE DE /.test(l) || /^\s*SISBB\b/.test(l) || ehFichaResumida(linhas, i));

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

// Rótulos das fichas resumidas, como o BB escreve. A leitura vai de rótulo em
// rótulo: um valor vazio não desalinha o resto.
const ROTULOS_FICHA = new Set([
  'Banco', 'Código de barras', 'Documento', 'Data da arrecadação', 'Data do pagamento', 'Valor documento',
  'Desc./abatimentos', 'Outras deduções', 'Juros/multa', 'Outros acréscimos', 'Valor cobrado', 'Convênio', 'Valor',
]);

function camposDaFicha(tokens) {
  const campos = {};
  for (let i = 0; i < tokens.length; i += 1) {
    if (ROTULOS_FICHA.has(tokens[i]) && i + 1 < tokens.length && !ROTULOS_FICHA.has(tokens[i + 1])) {
      if (campos[tokens[i]] === undefined) campos[tokens[i]] = tokens[i + 1];
      i += 1;
    }
  }
  return campos;
}

// Ficha resumida de boleto ("Títulos/Cobrança"). Sem beneficiário: o que
// identifica o boleto é o código de barras, de onde saem também o vencimento e
// o valor original.
function lerFichaTitulo(campos, conta) {
  const codigo = lerCodigoBoleto(campos['Código de barras'] || '');
  const valido = codigo && !codigo.erro ? codigo : null;
  const valorDocumento = paraValor(campos['Valor documento']);
  const desconto = Number(((paraValor(campos['Desc./abatimentos']) || 0) + (paraValor(campos['Outras deduções']) || 0)).toFixed(2));
  const juros = Number(((paraValor(campos['Juros/multa']) || 0) + (paraValor(campos['Outros acréscimos']) || 0)).toFixed(2));
  const banco = (campos.Banco || '').trim() || null;
  return {
    data: paraISO(campos['Data da arrecadação'] || campos['Data do pagamento']),
    nome: '',
    cnpj: null,
    banco_beneficiario: banco,
    nosso_numero: valido && valido.campo_livre ? valido.campo_livre : null,
    codigo_barras: valido ? valido.codigo_barras : null,
    linha_digitavel: soDigitos(campos['Código de barras']) || null,
    linha_digitavel_invalida: Boolean(campos['Código de barras'] && !valido),
    numero_documento: campos.Documento || null,
    autenticacao: null,
    // A ficha não traz o vencimento; o código de barras traz.
    vencimento: valido ? valido.vencimento : null,
    valor_documento: valorDocumento,
    juros,
    desconto,
    valor: paraValor(campos['Valor cobrado']),
    conta_pagadora: conta,
    tipo: 'Boleto',
    descricao: banco ? `Boleto ${banco}` : 'Boleto',
  };
}

// Ficha resumida de convênio: DARF, conta de consumo, tributo. O nome do
// convênio ("RFB-DARF CODIGO DE BARRAS") é quem recebe.
function lerFichaConvenio(campos, conta) {
  const codigo = lerCodigoBoleto(campos['Código de barras'] || '');
  const valido = codigo && !codigo.erro ? codigo : null;
  const nome = (campos['Convênio'] || '').trim();
  const valor = paraValor(campos.Valor);
  return {
    data: paraISO(campos['Data do pagamento'] || campos['Data da arrecadação']),
    nome,
    cnpj: null,
    banco_beneficiario: null,
    nosso_numero: null,
    codigo_barras: valido ? valido.codigo_barras : null,
    linha_digitavel: soDigitos(campos['Código de barras']) || null,
    linha_digitavel_invalida: Boolean(campos['Código de barras'] && !valido),
    numero_documento: campos.Documento || null,
    autenticacao: null,
    vencimento: null,
    valor_documento: valor,
    juros: 0,
    desconto: 0,
    valor,
    conta_pagadora: conta,
    tipo: 'Convênio',
    descricao: nome || 'Convênio',
  };
}

// Comprovante Pix do SISBB. Ainda não vira lançamento: é contado à parte, e o
// Pix para uma conta da própria empresa (o PagSeguro, por exemplo) é dito
// como tal — é dinheiro mudando de lugar, não despesa.
function lerPix(bloco) {
  const texto = bloco.map((l) => l.trim());
  const valorDe = (rotulo) => {
    const l = texto.find((t) => t.toUpperCase().startsWith(rotulo));
    return l ? l.slice(rotulo.length).replace(/^[:\s]+/, '').trim() : '';
  };
  const pagador = soDigitos(valorDe('CNPJ DO PAGADOR'));
  const recebedor = soDigitos((texto.find((t) => /^(CNPJ|CPF):/i.test(t)) || '').replace(/^(CNPJ|CPF):/i, ''));
  return {
    valor: paraValor(valorDe('VALOR')),
    tarifa: paraValor(valorDe('TARIFA')) || 0,
    data: paraISO(valorDe('DATA')),
    para: valorDe('PAGO PARA'),
    instituicao: valorDe('INSTITUICAO').replace(/^\d+\s*/, ''),
    propria_conta: Boolean(pagador && recebedor && pagador === recebedor),
  };
}

function lerComprovantesPagamentoBB(buffer) {
  const linhas = linhasDoPdf(buffer);
  if (!linhas.length) throw new Error(ERRO_IMAGEM);
  if (!ehComprovante(linhas)) {
    throw new Error('Este PDF não é o extrato de comprovantes de pagamento do Banco do Brasil.');
  }

  // Onde começa cada comprovante, em qualquer dos desenhos. O título que fica
  // dentro de um comprovante do SISBB ("COMPROVANTE DE DEBITO AUTOMATICO") é
  // parte dele, e não o começo de outro.
  const inicios = [];
  let dentroSisbb = -1;
  linhas.forEach((l, i) => {
    if (/^\s*SISBB\b/.test(l)) { inicios.push({ i, tipo: 'sisbb' }); dentroSisbb = i; return; }
    if (ehFichaResumida(linhas, i)) { inicios.push({ i, tipo: 'ficha' }); dentroSisbb = -1; return; }
    if (/^\s*COMPROVANTE DE /.test(l) && !(dentroSisbb >= 0 && i - dentroSisbb < 8)) inicios.push({ i, tipo: 'completo' });
  });

  const pagamentos = [];
  const naoLidos = [];
  inicios.forEach((inicio, k) => {
    const bloco = linhas.slice(inicio.i, k + 1 < inicios.length ? inicios[k + 1].i : linhas.length);

    if (inicio.tipo === 'ficha') {
      const tokens = bloco.map((l) => l.trim()).filter(Boolean);
      const contaTexto = tokens[3] || '';
      const conta = { agencia: tokens[1] || null, conta: (contaTexto.match(/^[\d.-]+/) || [null])[0] };
      const tipo = tokens[4] || '';
      const campos = camposDaFicha(tokens.slice(5));
      let p = null;
      if (/T[ií]tulos|Cobran/i.test(tipo)) p = lerFichaTitulo(campos, conta);
      else if (/Conv[eê]nio/i.test(tipo)) p = lerFichaConvenio(campos, conta);
      if (!p) { naoLidos.push({ titulo: tipo || 'Ficha sem tipo', valor: paraValor(campos['Valor cobrado'] || campos.Valor) }); return; }
      if (!p.data || !p.valor) { naoLidos.push({ titulo: tipo, valor: p.valor, motivo: 'Sem data ou valor do pagamento.' }); return; }
      pagamentos.push(p);
      return;
    }

    if (inicio.tipo === 'sisbb') {
      const titulo = (bloco.slice(1, 8).map((l) => l.trim()).find((t) => /^comprovante/i.test(t)) || 'Comprovante').trim();
      if (/pix/i.test(titulo)) {
        const pix = lerPix(bloco);
        naoLidos.push({
          titulo: 'Pix',
          valor: pix.valor,
          data: pix.data,
          para: pix.para,
          motivo: pix.propria_conta
            ? `transferência para conta da própria empresa${pix.instituicao ? ` (${pix.instituicao})` : ''} — não é despesa`
            : 'Pix ainda não é lançado por aqui',
        });
      } else {
        naoLidos.push({ titulo, valor: paraValor(bloco.find((l) => /VALOR/i.test(l))) });
      }
      return;
    }

    const titulo = bloco[0].trim();
    if (!/PAGAMENTO DE TITULOS/.test(titulo)) {
      // Transferência, tributo, convênio em texto corrido: ainda sem leitura.
      // Vai contado, para a pessoa saber que existe e não achar que se perdeu.
      naoLidos.push({ titulo, valor: paraValor(bloco.find((l) => /VALOR/.test(l))) });
      return;
    }
    const p = lerTitulo(bloco);
    if (!p.data || !p.valor) {
      naoLidos.push({ titulo, valor: p.valor, motivo: 'Sem data ou valor do pagamento.' });
      return;
    }
    pagamentos.push(p);
  });

  if (!pagamentos.length) {
    throw new Error(
      naoLidos.length
        ? `Li ${naoLidos.length} comprovante(s), mas nenhum é de boleto ou convênio (${naoLidos[0].titulo}).`
        : 'Não encontrei nenhum comprovante de pagamento neste PDF.'
    );
  }

  // Conferência da própria leitura: valor do documento + juros − desconto tem
  // de dar o valor cobrado. Se não der, o layout mudou e algum número foi lido
  // da linha errada — melhor parar do que gravar conta errada.
  for (const p of pagamentos) {
    if (p.valor_documento !== null && p.valor_documento !== undefined) {
      const esperado = Number((p.valor_documento + p.juros - p.desconto).toFixed(2));
      if (Math.abs(esperado - p.valor) > 0.009) {
        throw new Error(
          `No comprovante de ${p.nome || p.descricao || 'um boleto'} (${p.data}), documento + juros − desconto não dá o valor cobrado. ` +
            'O layout do BB pode ter mudado: me mande o arquivo para eu ajustar a leitura.'
        );
      }
    }
  }

  pagamentos.forEach((p, i) => { p.seq = i + 1; });
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
