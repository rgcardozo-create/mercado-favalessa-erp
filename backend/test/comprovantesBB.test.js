const zlib = require('zlib');
const { lerComprovantesPagamentoBB, ehComprovante, linhasDoPdf } = require('../src/utils/comprovantesPagamentoBB');
const { casarPagamentos } = require('../src/utils/casarPagamentos');
const { modulo10, dvBoleto } = require('../src/utils/boleto');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };

// ── Um PDF de mentira no formato do BB ─────────────────────────────────────
// Dados fictícios. O arquivo de verdade não entra no repositório: é
// movimentação bancária real.

// Boleto bancário válido: código de barras de 44 com o DV geral, e a linha
// digitável de 47 com o DV de cada campo — o leitor confere os dois.
function boleto(banco, fator, valorCentavos, campoLivre) {
  const semDv = `${banco}9${String(fator).padStart(4, '0')}${String(valorCentavos).padStart(10, '0')}${campoLivre}`;
  const codigo = semDv.slice(0, 4) + dvBoleto(semDv) + semDv.slice(4);
  const c1 = codigo.slice(0, 4) + codigo.slice(19, 24);
  const c2 = codigo.slice(24, 34);
  const c3 = codigo.slice(34, 44);
  const linha = `${c1}${modulo10(c1)}${c2}${modulo10(c2)}${c3}${modulo10(c3)}${codigo[4]}${codigo.slice(5, 19)}`;
  return { codigo, linha };
}

function comprovante({ banco, linha, beneficiario, cnpj, doc, venc, pago, valorDoc, juros, desconto, cobrado, aut }) {
  return [
    '17/11/2026    -  BANCO  DO  BRASIL  -   23:07:51',
    '429204292                                   0001',
    '                                               ',
    '     COMPROVANTE DE PAGAMENTO DE TITULOS       ',
    'CLIENTE: MERCADO TESTE LTDA                    ',
    'AGENCIA: 1234-5          CONTA:         67.890-1',
    '================================================',
    banco,
    '------------------------------------------------',
    linha,
    'BENEFICIARIO:',
    beneficiario.slice(0, 29),
    'NOME FANTASIA:',
    beneficiario,
    `CNPJ:  ${cnpj}`,
    'BENEFICIARIO FINAL:',
    beneficiario.slice(0, 29),
    `CNPJ:  ${cnpj}`,
    'PAGADOR:',
    'MERCADO TESTE LTDA',
    'CNPJ:  11.222.333/0001-81',
    '------------------------------------------------',
    `NR. DOCUMENTO                             ${doc}`,
    `DATA DE VENCIMENTO                     ${venc}`,
    `DATA DO PAGAMENTO                      ${pago}`,
    `VALOR DO DOCUMENTO                     ${valorDoc}`,
    ...(juros ? [`JUROS/MULTA                            ${juros}`] : []),
    ...(desconto ? [`DESCONTO/ABATIMENTO                    ${desconto}`] : []),
    `VALOR COBRADO                          ${cobrado}`,
    '================================================',
    `NR.AUTENTICACAO           ${aut}`,
    '================================================',
    'Central de Atendimento BB',
  ];
}

// Monta o PDF como o iText: cada linha num `Tm (texto)Tj`, uma página por
// comprovante, com o conteúdo comprimido (FlateDecode).
function pdfDe(paginas, { comprimir = true } = {}) {
  const esc = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let corpo = '%PDF-1.4\n';
  paginas.forEach((linhas, n) => {
    const conteudo = [
      'BT /F1 12 Tf 1 0 0 1 131.59 767.51 Tm (Consultas - Extrato de pagamentos e transfer\\352ncias)Tj ET',
      ...linhas.map((l, i) => `BT /F3 8.25 Tf 1 0 0 1 54.75 ${(728 - i * 9).toFixed(2)} Tm (${esc(l)})Tj ET`),
    ].join('\n');
    const dados = comprimir ? zlib.deflateSync(Buffer.from(conteudo, 'latin1')) : Buffer.from(conteudo, 'latin1');
    corpo += `${n + 1} 0 obj\n<< /Length ${dados.length}${comprimir ? ' /Filter /FlateDecode' : ''} >>\nstream\n`;
    corpo = Buffer.concat([Buffer.from(corpo, 'latin1'), dados, Buffer.from('\nendstream\nendobj\n', 'latin1')]).toString('latin1');
  });
  return Buffer.from(`${corpo}%%EOF\n`, 'latin1');
}

const B1 = boleto('021', 1650, 55000, '0331154100014542047402135');
const B2 = boleto('756', 1621, 43952, '1301001028599441138811001');
const B3 = boleto('237', 1633, 27119, '2372190017276967700052730');

const PAGINAS = [
  comprovante({ banco: 'BCO BANESTES S.A.', linha: B1.linha, beneficiario: 'TRANSPORTE URBANO TESTE', cnpj: '08.179.496/0001-14',
    doc: '111.701', venc: '04/12/2026', pago: '17/11/2026', valorDoc: '550,00', cobrado: '550,00', aut: '9.3E7.694.446.243.A95' }),
  comprovante({ banco: 'BANCO SICOOB S.A.', linha: B2.linha, beneficiario: 'PLANO DE SAUDE COOPERATIVA DE TRABALHO', cnpj: '27.578.434/0001-20',
    doc: '111.702', venc: '05/11/2026', pago: '17/11/2026', valorDoc: '439,52', juros: '10,54', cobrado: '450,06', aut: '4.EB0.0BD.CF3.DBC.FB3' }),
  comprovante({ banco: 'BCO BRADESCO S.A.', linha: B3.linha, beneficiario: 'FRIGORIFICO TESTE SA', cnpj: '01.838.723/0001-27',
    doc: '111.705', venc: '17/11/2026', pago: '17/11/2026', valorDoc: '271,19', desconto: '8,29', cobrado: '262,90', aut: 'A.82B.4D4.01B.3D2.333' }),
  [
    '17/11/2026    -  BANCO  DO  BRASIL  -   23:07:51',
    '     COMPROVANTE DE TRANSFERENCIA              ',
    'VALOR                                    120,00',
  ],
];

console.log('=== leitura do PDF ===');
const pdf = pdfDe(PAGINAS);
ok('reconhece o formato de comprovantes', ehComprovante(linhasDoPdf(pdf)));
const r = lerComprovantesPagamentoBB(pdf);
ok('três pagamentos de boleto', r.pagamentos.length === 3);
ok('a transferência fica de fora, contada', r.nao_lidos.length === 1 && /TRANSFERENCIA/.test(r.nao_lidos[0].titulo) && r.nao_lidos[0].valor === 120);
ok('total soma o cobrado', r.total.valor === 1262.96 && r.total.quantidade === 3);
ok('período', r.periodo.de === '2026-11-17' && r.periodo.ate === '2026-11-17');
ok('conta pagadora', r.conta_pagadora.agencia === '1234-5' && r.conta_pagadora.conta === '67.890-1');

const [p1, p2, p3] = r.pagamentos;
ok('código de barras sai da linha digitável', p1.codigo_barras === B1.codigo && p3.codigo_barras === B3.codigo);
ok('nosso número é o campo livre (casa com o relatório)', p1.nosso_numero === '0331154100014542047402135');
ok('vencimento e data do pagamento', p1.vencimento === '2026-12-04' && p1.data === '2026-11-17');
ok('nome completo vem do nome fantasia', p2.nome === 'PLANO DE SAUDE COOPERATIVA DE TRABALHO');
ok('CNPJ do beneficiário final, só dígitos', p1.cnpj === '08179496000114');
ok('banco de quem emitiu', p1.banco_beneficiario === 'BCO BANESTES S.A.');
ok('juros lidos', p2.juros === 10.54 && p2.valor_documento === 439.52 && p2.valor === 450.06);
ok('desconto lido', p3.desconto === 8.29 && p3.valor_documento === 271.19 && p3.valor === 262.9);
ok('sem juros nem desconto: zero', p1.juros === 0 && p1.desconto === 0);
ok('número do documento e autenticação', p1.numero_documento === '111.701' && p1.autenticacao === '9.3E7.694.446.243.A95');

ok('PDF sem compressão também é lido', lerComprovantesPagamentoBB(pdfDe(PAGINAS, { comprimir: false })).pagamentos.length === 3);

let erro = null;
const errado = PAGINAS[0].map((l) => (l.startsWith('VALOR COBRADO') ? 'VALOR COBRADO                          555,00' : l));
try { lerComprovantesPagamentoBB(pdfDe([errado])); } catch (e) { erro = e; }
ok('documento + juros − desconto que não dá o cobrado: recusa', erro && /layout do BB/.test(erro.message));

erro = null;
try { lerComprovantesPagamentoBB(pdfDe([PAGINAS[3]])); } catch (e) { erro = e; }
ok('só transferência: avisa que não há boleto', erro && /nenhum é de pagamento de boleto/.test(erro.message));

const digitada = PAGINAS[0].map((l) => (l === B1.linha ? `${B1.linha.slice(0, 5)}9${B1.linha.slice(6)}` : l));
const lida = lerComprovantesPagamentoBB(pdfDe([digitada])).pagamentos[0];
ok('linha digitável com dígito errado não vira código de barras', !lida.codigo_barras && lida.linha_digitavel_invalida);

console.log('=== casamento com as contas ===');
const conta = (x) => ({ fornecedor_id: 1, fornecedor_nome: 'X', descricao: 'boleto', quitado: false, pagamentos: [], codigo_barras: null, nosso_numero: null, ...x });
const contas = [
  conta({ id: 10, fornecedor_cnpj: '01.838.723/0001-27', valor: 271.19, saldo: 271.19, vencimento: '2026-11-17' }),
  conta({ id: 11, fornecedor_cnpj: '27.578.434/0001-20', valor: 439.52, saldo: 439.52, vencimento: '2026-11-05', codigo_barras: B2.codigo }),
];
const itens = casarPagamentos(r.pagamentos, contas);
ok('boleto sem cadastro fica "sem_cadastro"', itens[0].situacao === 'sem_cadastro');
ok('pelo código de barras acha a conta mesmo com juros', itens[1].situacao === 'codigo' && itens[1].conta_id === 11);
ok('com desconto, casa pelo valor do documento e CNPJ', itens[2].situacao === 'cnpj_valor' && itens[2].conta_id === 10);
ok('desconto não aparece como diferença', itens[2].opcoes[0].diferenca === 0);
ok('juros aparecem como diferença', itens[1].opcoes[0].diferenca === 10.54);

const outroFormato = { ...r.pagamentos[0], valor_documento: undefined };
ok('referência igual à do relatório para o mesmo pagamento',
   casarPagamentos([outroFormato], [])[0].ref === casarPagamentos([{ data: '2026-11-17', nosso_numero: '0331154100014542047402135', valor: 550 }], [])[0].ref);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
