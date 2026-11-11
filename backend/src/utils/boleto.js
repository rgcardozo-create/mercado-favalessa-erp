// Leitura do código de um boleto: o que o leitor de código de barras do caixa
// devolve (44 números) ou a linha digitável copiada de um PDF (47 ou 48).
//
// Por que isto existe: o boleto chega em papel, grampeado na nota, e cruzar o
// pagamento com o cadastro pelo nome e pelo valor falha justamente onde mais
// importa — três parcelas iguais do mesmo fornecedor, uma delas paga atrasada,
// com juros. O código de barras é único por boleto e já traz o valor, o
// vencimento e o nosso número. Passar o leitor custa um segundo; digitar o
// número de 47 dígitos, ninguém faria.
//
// Também aceita um número curto (o final do nosso número, digitado olhando o
// papel), para quando não houver leitor à mão. Esse não traz valor nem
// vencimento: é só a chave para achar o pagamento depois.

const BANCOS = {
  '001': 'Banco do Brasil',
  '004': 'Banco do Nordeste',
  '021': 'Banestes',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Inter',
  '104': 'Caixa',
  '136': 'Unicred',
  '208': 'BTG Pactual',
  '237': 'Bradesco',
  '260': 'Nubank',
  '290': 'PagSeguro',
  '323': 'Mercado Pago',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '380': 'PicPay',
  '403': 'Cora',
  '422': 'Safra',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

const soDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');

// Módulo 10: pesos 2 e 1 da direita para a esquerda, somando os algarismos
// de cada produto. É o dígito de cada campo da linha digitável.
function modulo10(numero) {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

// Módulo 11 com pesos de 2 a 9, da direita para a esquerda.
function somaModulo11(numero) {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma;
}

// Dígito geral do boleto bancário (posição 5 do código de barras). Resto que
// daria 0, 10 ou 11 vira 1 — é a regra da Febraban, sem exceção.
function dvBoleto(numero) {
  const dv = 11 - (somaModulo11(numero) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

// Dígito das contas de consumo e tributos (código que começa com 8), quando a
// referência é módulo 11: resto 0 ou 1 vira 0, resto 10 vira 1.
function dvArrecadacao11(numero) {
  const resto = somaModulo11(numero) % 11;
  if (resto === 0 || resto === 1) return 0;
  if (resto === 10) return 1;
  return 11 - resto;
}

const DIA_MS = 24 * 60 * 60 * 1000;

function somarDias(dataISO, dias) {
  const d = new Date(`${dataISO}T00:00:00Z`);
  return new Date(d.getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

// O fator de vencimento conta dias desde 07/10/1997 e chegou a 9999 em
// 21/02/2025. No dia seguinte recomeçou em 1000. O mesmo fator vale, então,
// para duas datas a 9000 dias uma da outra (uns 24 anos): fica a que estiver
// mais perto de hoje, que é sempre a do boleto que está na mão.
function vencimentoDoFator(fator, hojeISO) {
  if (!fator) return null; // fator zero: boleto sem vencimento
  const antiga = somarDias('1997-10-07', fator);
  const nova = fator >= 1000 ? somarDias('2025-02-22', fator - 1000) : null;
  if (!nova) return antiga;
  const hoje = new Date(`${hojeISO}T00:00:00Z`).getTime();
  const distancia = (iso) => Math.abs(new Date(`${iso}T00:00:00Z`).getTime() - hoje);
  return distancia(nova) <= distancia(antiga) ? nova : antiga;
}

// Onde cada banco guarda o nosso número dentro do campo livre (as 25 posições
// finais do código de barras, que o banco usa como quer). Banco que não está
// aqui continua funcionando: o cruzamento usa o código inteiro, e o nosso
// número é só para mostrar e para achar o boleto pelo final digitado.
function nossoNumeroDoCampoLivre(banco, campoLivre) {
  switch (banco) {
    case '001':
      // Convênio de 7 dígitos: seis zeros, convênio + sequência (17), carteira.
      // Convênio de 4 ou 6: nosso número (11), agência, conta, carteira.
      return campoLivre.startsWith('000000') ? campoLivre.slice(6, 23) : campoLivre.slice(0, 11);
    case '237':
      // Agência (4), carteira (2), nosso número (11), conta (7), zero.
      return campoLivre.slice(6, 17);
    case '341':
      // Carteira (3), nosso número (8), dígito, agência, conta...
      return campoLivre.slice(3, 11);
    case '033':
      // 9, código do beneficiário (7), nosso número (13), IOF, carteira.
      return campoLivre.slice(8, 21);
    case '756':
      // Carteira (1), agência (4), modalidade (2), cliente (7), nosso número (8).
      return campoLivre.slice(14, 22);
    default:
      return null;
  }
}

// Linha digitável de boleto bancário (47) para código de barras (44). Também
// confere o dígito de cada um dos três primeiros campos: um número digitado
// errado é pego aqui, e não lá na frente como "pagamento não encontrado".
function linhaParaCodigoBancario(linha) {
  const campos = [
    [linha.slice(0, 9), linha[9]],
    [linha.slice(10, 20), linha[20]],
    [linha.slice(21, 31), linha[31]],
  ];
  for (const [corpo, dv] of campos) {
    if (modulo10(corpo) !== Number(dv)) return null;
  }
  return (
    linha.slice(0, 4) + linha[32] + linha.slice(33, 47) +
    linha.slice(4, 9) + linha.slice(10, 20) + linha.slice(21, 31)
  );
}

// Linha digitável de arrecadação (48): quatro blocos de 11 números, cada um com
// o seu dígito no fim.
function linhaParaCodigoArrecadacao(linha) {
  const usa10 = linha[2] === '6' || linha[2] === '7';
  let codigo = '';
  for (let i = 0; i < 4; i += 1) {
    const corpo = linha.slice(i * 12, i * 12 + 11);
    const dv = Number(linha[i * 12 + 11]);
    const esperado = usa10 ? modulo10(corpo) : dvArrecadacao11(corpo);
    if (esperado !== dv) return null;
    codigo += corpo;
  }
  return codigo;
}

function lerBancario(codigo, hojeISO) {
  const dvInformado = Number(codigo[4]);
  if (dvBoleto(codigo.slice(0, 4) + codigo.slice(5)) !== dvInformado) return null;

  const banco = codigo.slice(0, 3);
  const campoLivre = codigo.slice(19, 44);
  const fator = Number(codigo.slice(5, 9));
  const valor = Number(codigo.slice(9, 19)) / 100;

  return {
    tipo: 'boleto',
    codigo_barras: codigo,
    banco,
    banco_nome: BANCOS[banco] || null,
    vencimento: vencimentoDoFator(fator, hojeISO),
    // Valor zero no código quer dizer "boleto sem valor fixo": quem cadastra
    // informa o valor. Não é um boleto de R$ 0,00.
    valor: valor > 0 ? valor : null,
    campo_livre: campoLivre,
    nosso_numero: nossoNumeroDoCampoLivre(banco, campoLivre),
  };
}

function lerArrecadacao(codigo) {
  const referencia = codigo[2];
  const usa10 = referencia === '6' || referencia === '7';
  const semDv = codigo.slice(0, 3) + codigo.slice(4);
  const esperado = usa10 ? modulo10(semDv) : dvArrecadacao11(semDv);
  if (esperado !== Number(codigo[3])) return null;

  // Só nas referências 6 e 8 o campo de valor é o valor em reais; nas outras
  // é uma quantidade em outra moeda ou índice.
  const valorEmReais = referencia === '6' || referencia === '8';
  const valor = Number(codigo.slice(4, 15)) / 100;

  return {
    tipo: 'arrecadacao',
    codigo_barras: codigo,
    banco: null,
    banco_nome: null,
    // Conta de consumo e tributo não têm vencimento em lugar fixo do código.
    vencimento: null,
    valor: valorEmReais && valor > 0 ? valor : null,
    campo_livre: null,
    nosso_numero: null,
  };
}

const MINIMO_NOSSO_NUMERO = 3;

// Lê o que vier no campo: leitor, linha digitável ou número curto.
// Devolve { erro } quando parece um código mas não confere — o leitor errou ou
// a pessoa digitou um número trocado. Melhor recusar do que gravar errado.
function lerCodigoBoleto(texto, hojeISO = new Date().toISOString().slice(0, 10)) {
  const digitos = soDigitos(texto);
  if (!digitos) return null;

  if (digitos.length === 44) {
    const lido = digitos[0] === '8' ? lerArrecadacao(digitos) : lerBancario(digitos, hojeISO);
    return lido || { erro: 'Código de barras com dígito verificador errado. Passe o leitor de novo.' };
  }

  if (digitos.length === 47) {
    const codigo = linhaParaCodigoBancario(digitos);
    const lido = codigo && lerBancario(codigo, hojeISO);
    return lido || { erro: 'Linha digitável não confere. Confira se algum número foi digitado trocado.' };
  }

  if (digitos.length === 48 && digitos[0] === '8') {
    const codigo = linhaParaCodigoArrecadacao(digitos);
    const lido = codigo && lerArrecadacao(codigo);
    return lido || { erro: 'Linha digitável não confere. Confira se algum número foi digitado trocado.' };
  }

  // Comprido demais para ser um nosso número e fora dos tamanhos de código:
  // é leitura pela metade ou número colado errado.
  if (digitos.length > 30) {
    return { erro: `O código tem ${digitos.length} números; o do boleto tem 44 (leitor) ou 47 (linha digitável).` };
  }

  if (digitos.length < MINIMO_NOSSO_NUMERO) {
    return { erro: 'Número curto demais para identificar o boleto.' };
  }

  // Número curto: o final do nosso número, digitado. Zeros à esquerda não
  // contam — "0000040273" e "40273" são o mesmo boleto.
  return {
    tipo: 'nosso_numero',
    codigo_barras: null,
    banco: null,
    banco_nome: null,
    vencimento: null,
    valor: null,
    campo_livre: null,
    nosso_numero: digitos.replace(/^0+(?=\d)/, ''),
  };
}

module.exports = { lerCodigoBoleto, vencimentoDoFator, modulo10, dvBoleto };
