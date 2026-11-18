const pool = require('../db/pool');
const { SELECT_CONTAS_COM_SALDO, TIPOS_VALIDOS } = require('../db/contasQuery');
const { lerRelatorioPagamentosBB } = require('../utils/relatorioPagamentosBB');
const { lerComprovantesPagamentoBB, linhasDoPdf, ehComprovante } = require('../utils/comprovantesPagamentoBB');
const { casarPagamentos } = require('../utils/casarPagamentos');
const { registrarAuditoria } = require('../utils/auditoria');

// Baixa dos boletos pelos PDFs de pagamentos do BB: o "Relatório de Pagamentos
// Realizados" (uma linha por pagamento) ou o "Extrato de pagamentos e
// transferências" (um comprovante por pagamento, com código de barras,
// vencimento, juros e desconto). O formato é reconhecido pelo próprio arquivo.
//
// O dono paga no banco e não lança nada no sistema. No fim do dia (ou da
// semana) baixa esse PDF e importa: cada pagamento acha o boleto cadastrado —
// pelo código de barras quando foi lido com o leitor, senão pelo CNPJ e valor —
// e a baixa sai com a data e o valor pagos de verdade, juros incluídos.
//
// Nada é gravado na análise. A tela mostra a proposta, ele confere, e só
// então grava — reenviando o arquivo, que é lido e casado de novo aqui. Assim
// o que se grava é sempre o que o relatório diz, e não o que veio da tela.

function arquivoDoCorpo(req) {
  const base64 = req.body && req.body.arquivo_base64;
  if (!base64) return null;
  return Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
}

const soDigitos = (t) => String(t ?? '').replace(/\D/g, '');

function formatarCnpj(d) {
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d;
}

// Contas que podem ter sido pagas por este relatório: todas as abertas, mais
// as que já têm baixa no período (para reconhecer pagamento baixado à mão) e
// as que têm o código de barras de algum pagamento (para dizer "já quitado"
// em vez de "não cadastrado").
async function contasParaCasar(cliente, leitura) {
  const nns = leitura.pagamentos.map((p) => p.nosso_numero).filter((n) => n && n.length === 25);
  const de = leitura.periodo ? leitura.periodo.de : leitura.pagamentos[0].data;
  const ate = leitura.periodo ? leitura.periodo.ate : leitura.pagamentos[leitura.pagamentos.length - 1].data;

  const { rows: contas } = await cliente.query(
    `SELECT t.id, t.tipo, t.fornecedor_id, t.fornecedor_nome, t.descricao, t.valor, t.saldo, t.quitado,
            t.codigo_barras, t.nosso_numero, fo.cnpj_cpf AS fornecedor_cnpj,
            to_char(t.vencimento, 'YYYY-MM-DD') AS vencimento
       FROM (${SELECT_CONTAS_COM_SALDO}) t
       LEFT JOIN fornecedores fo ON fo.id = t.fornecedor_id
      WHERE t.quitado = false
         OR t.id IN (SELECT conta_id FROM contas_pagamentos WHERE data_pagamento BETWEEN $1 AND $2)
         OR (t.codigo_barras IS NOT NULL AND substring(t.codigo_barras from 20) = ANY($3::text[]))`,
    [de, ate, nns]
  );

  const ids = contas.map((c) => c.id);
  const { rows: pagamentos } = ids.length
    ? await cliente.query(
        `SELECT conta_id, valor, to_char(data_pagamento, 'YYYY-MM-DD') AS data_pagamento
           FROM contas_pagamentos
          WHERE conta_id = ANY($1) AND data_pagamento BETWEEN $2 AND $3`,
        [ids, de, ate]
      )
    : { rows: [] };

  const porConta = new Map();
  for (const p of pagamentos) {
    if (!porConta.has(p.conta_id)) porConta.set(p.conta_id, []);
    porConta.get(p.conta_id).push(p);
  }
  return contas.map((c) => ({ ...c, pagamentos: porConta.get(c.id) || [] }));
}

// Qual dos dois PDFs do BB chegou. O de comprovantes é reconhecido pelo título
// de cada comprovante; o resto segue para o leitor do relatório, que diz com
// clareza quando o arquivo não é nenhum dos dois.
function lerPdfDePagamentos(buffer) {
  return ehComprovante(linhasDoPdf(buffer)) ? lerComprovantesPagamentoBB(buffer) : lerRelatorioPagamentosBB(buffer);
}

// Onde cada beneficiário costuma entrar: o que foi aprendido nas importações
// anteriores e, para quem ainda não tem regra, o cadastro de fornecedores (o
// CNPJ de um fornecedor da Ceasa é Ceasa; o de outro fornecedor, Fornecedores).
async function sugestoesPorCnpj(cliente, pagamentos) {
  const cnpjs = [...new Set(pagamentos.map((p) => soDigitos(p.cnpj)).filter((c) => c.length >= 11))];
  if (!cnpjs.length) return new Map();
  const { rows: regras } = await cliente.query(
    'SELECT cnpj, tipo, categoria, vezes FROM regras_beneficiario WHERE cnpj = ANY($1::text[])',
    [cnpjs]
  );
  const mapa = new Map(regras.map((r) => [r.cnpj, { tipo: r.tipo, categoria: r.categoria, aprendido: true, vezes: r.vezes }]));
  const faltam = cnpjs.filter((c) => !mapa.has(c));
  if (faltam.length) {
    const { rows: fornecedores } = await cliente.query(
      `SELECT regexp_replace(coalesce(cnpj_cpf, ''), '\\D', '', 'g') AS cnpj, bool_or(coalesce(ceasa, false)) AS ceasa
         FROM fornecedores
        WHERE regexp_replace(coalesce(cnpj_cpf, ''), '\\D', '', 'g') = ANY($1::text[])
        GROUP BY 1`,
      [faltam]
    );
    for (const f of fornecedores) mapa.set(f.cnpj, { tipo: f.ceasa ? 'ceasa' : 'fornecedor', categoria: null, aprendido: false });
  }
  return mapa;
}

async function analisarRelatorio(cliente, buffer) {
  const leitura = lerPdfDePagamentos(buffer);
  const contas = await contasParaCasar(cliente, leitura);

  // As referências saem do próprio casamento; a primeira passada só serve
  // para saber quais procurar entre as já importadas.
  const refs = casarPagamentos(leitura.pagamentos, contas).map((i) => i.ref);
  const { rows } = await cliente.query(
    'SELECT ref_externa FROM contas_pagamentos WHERE ref_externa = ANY($1)',
    [refs]
  );
  const itens = casarPagamentos(leitura.pagamentos, contas, new Set(rows.map((r) => r.ref_externa)));
  const sugestoes = await sugestoesPorCnpj(cliente, leitura.pagamentos);
  for (const i of itens) i.sugestao = sugestoes.get(soDigitos(i.pagamento.cnpj)) || null;
  return { leitura, itens };
}

function resumoDe(itens) {
  const resumo = {};
  for (const i of itens) {
    resumo[i.situacao] = resumo[i.situacao] || { quantidade: 0, valor: 0 };
    resumo[i.situacao].quantidade += 1;
    resumo[i.situacao].valor = Number((resumo[i.situacao].valor + i.pagamento.valor).toFixed(2));
  }
  return resumo;
}

function lerOuResponder(req, res) {
  const buffer = arquivoDoCorpo(req);
  if (!buffer) {
    res.status(400).json({ error: 'Envie o PDF do relatório de pagamentos.' });
    return null;
  }
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    res.status(400).json({ error: 'O arquivo não é um PDF. Baixe o relatório de pagamentos do BB em PDF.' });
    return null;
  }
  return buffer;
}

async function analisar(req, res) {
  const buffer = lerOuResponder(req, res);
  if (!buffer) return undefined;

  let resultado;
  try {
    resultado = await analisarRelatorio(pool, buffer);
  } catch (err) {
    if (err.code) throw err; // erro do banco de dados, não do arquivo
    return res.status(400).json({ error: err.message });
  }

  // O banco do relatório: o cadastro que tem "Brasil" no nome, se houver.
  const { rows: bancos } = await pool.query('SELECT id, nome FROM bancos ORDER BY padrao DESC, nome');
  const sugerido = bancos.find((b) => /brasil|\bbb\b/i.test(b.nome));

  return res.json({
    formato: resultado.leitura.formato || 'relatorio',
    nao_lidos: resultado.leitura.nao_lidos || [],
    periodo: resultado.leitura.periodo,
    total: resultado.leitura.total,
    itens: resultado.itens,
    resumo: resumoDe(resultado.itens),
    banco_sugerido: sugerido ? sugerido.id : null,
  });
}

const SITUACOES_QUE_GRAVAM = new Set(['codigo', 'nosso_numero', 'cnpj_valor', 'juros', 'escolher', 'pelo_nome']);

// Pagamento sem boleto no sistema pode virar boleto ali mesmo: a funcionária
// esqueceu de cadastrar, o dono pagou, e o relatório já tem quase tudo —
// fornecedor, CNPJ, nosso número, valor e data. Também vale quando o
// fornecedor tem outros boletos em aberto, mas nenhum é este ("escolher").
const SITUACOES_QUE_CADASTRAM = new Set(['sem_cadastro', 'escolher', 'pelo_nome']);
const TIPOS_CADASTRO = TIPOS_VALIDOS;
const TIPOS_COM_FORNECEDOR = new Set(['fornecedor', 'ceasa']);

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// O fornecedor do pagamento: pelo CNPJ; senão pelo nome igual, ainda sem CNPJ
// (e aí ele aprende o CNPJ); senão é criado com o nome e o CNPJ do relatório.
async function fornecedorDoPagamento(cliente, p) {
  const cnpj = soDigitos(p.cnpj);
  if (cnpj) {
    const { rows } = await cliente.query(
      `SELECT id FROM fornecedores
        WHERE regexp_replace(coalesce(cnpj_cpf, ''), '\\D', '', 'g') = $1
        ORDER BY id LIMIT 1`,
      [cnpj]
    );
    if (rows[0]) return { id: rows[0].id, criado: false };
  }

  const nome = String(p.nome || '').trim();
  if (!nome) return { id: null, criado: false };

  const { rows: mesmoNome } = await cliente.query(
    `SELECT id, cnpj_cpf FROM fornecedores
      WHERE upper(btrim(nome)) = upper($1) AND coalesce(ceasa, false) = false
      ORDER BY id LIMIT 1`,
    [nome]
  );
  if (mesmoNome[0]) {
    if (cnpj.length === 14 && !soDigitos(mesmoNome[0].cnpj_cpf)) {
      await cliente.query('UPDATE fornecedores SET cnpj_cpf = $2 WHERE id = $1', [mesmoNome[0].id, formatarCnpj(cnpj)]);
    }
    return { id: mesmoNome[0].id, criado: false };
  }

  const { rows: novo } = await cliente.query(
    'INSERT INTO fornecedores (nome, cnpj_cpf) VALUES ($1, $2) RETURNING id',
    [nome, cnpj ? formatarCnpj(cnpj) : null]
  );
  return { id: novo[0].id, criado: true };
}

// Cria o boleto que faltava. O valor do boleto é o que o dono informar; sem
// isso, o do comprovante (o valor do documento, sem juros nem desconto) ou, no
// relatório, o valor pago. O vencimento, idem: o informado, o do comprovante ou
// o dia do pagamento. Do comprovante vem também o código de barras inteiro —
// o boleto fica cadastrado igual a um lido com o leitor.
async function cadastrarConta(cliente, p, novo, usuarioId) {
  const tipo = TIPOS_CADASTRO.includes(novo.tipo) ? novo.tipo : 'fornecedor';
  const informado = novo.valor !== undefined && novo.valor !== null && novo.valor !== '';
  const valor = informado ? Number(novo.valor) : p.valor_documento || p.valor;
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('Valor do boleto inválido.');
  const vencimento = DATA_ISO.test(String(novo.vencimento || '')) ? novo.vencimento : p.vencimento || p.data;
  const descricao = String(novo.descricao || p.nome || p.descricao || 'Pagamento do relatório do banco').trim().slice(0, 200);
  const categoria = TIPOS_COM_FORNECEDOR.has(tipo) ? null : String(novo.categoria || '').trim().slice(0, 60) || null;

  const fornecedor = TIPOS_COM_FORNECEDOR.has(tipo) ? await fornecedorDoPagamento(cliente, p) : { id: null, criado: false };
  if (tipo === 'ceasa' && fornecedor.id) {
    await cliente.query('UPDATE fornecedores SET ceasa = true WHERE id = $1 AND ceasa = false', [fornecedor.id]);
  }
  // O nosso número do relatório é o campo livre do código de barras: guardado,
  // acha este boleto pela busca e casa com ele se o relatório vier de novo.
  const nossoNumero = p.nosso_numero ? soDigitos(p.nosso_numero).replace(/^0+(?=\d)/, '').slice(0, 30) : null;
  // Código de barras já usado por outra conta é cadastro repetido: nesse caso o
  // boleto novo fica sem ele, em vez de a gravação inteira falhar.
  let codigo = p.codigo_barras && p.codigo_barras.length === 44 ? p.codigo_barras : null;
  if (codigo) {
    const { rows: usado } = await cliente.query('SELECT 1 FROM contas WHERE codigo_barras = $1', [codigo]);
    if (usado[0]) codigo = null;
  }

  const { rows } = await cliente.query(
    `INSERT INTO contas (tipo, categoria, fornecedor_id, descricao, valor, vencimento, forma_prevista,
                         nosso_numero, codigo_barras, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, 'Boleto', $7, $8, $9) RETURNING *`,
    [tipo, categoria, fornecedor.id, descricao, valor, vencimento, nossoNumero || null, codigo, usuarioId]
  );
  return { conta: rows[0], fornecedorCriado: fornecedor.criado };
}

// Guarda onde o boleto deste beneficiário entrou. É o "ele aprende": na
// próxima importação o mesmo CNPJ já vem com o lugar marcado.
async function aprenderBeneficiario(cliente, p, conta) {
  const cnpj = soDigitos(p.cnpj);
  if (cnpj.length < 11 || !conta.tipo) return;
  await cliente.query(
    `INSERT INTO regras_beneficiario (cnpj, nome, tipo, categoria, vezes)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (cnpj) DO UPDATE
        SET nome = EXCLUDED.nome, tipo = EXCLUDED.tipo, categoria = EXCLUDED.categoria,
            vezes = regras_beneficiario.vezes + 1, atualizado_em = now()`,
    [cnpj, String(p.nome || '').slice(0, 160) || null, conta.tipo, conta.categoria || null]
  );
}

async function importar(req, res) {
  const buffer = lerOuResponder(req, res);
  if (!buffer) return undefined;

  const escolhas = Array.isArray(req.body.escolhas) ? req.body.escolhas : [];
  if (!escolhas.length) return res.status(400).json({ error: 'Marque pelo menos um pagamento para dar baixa.' });

  const bancoId = req.body.banco_id ? Number(req.body.banco_id) : null;
  if (bancoId) {
    const { rows } = await pool.query('SELECT id FROM bancos WHERE id = $1', [bancoId]);
    if (!rows[0]) return res.status(400).json({ error: 'Banco não encontrado.' });
  }

  const cliente = await pool.connect();
  const gravados = [];
  const recusados = [];
  const cadastradas = [];
  let fornecedoresCriados = 0;
  try {
    await cliente.query('BEGIN');

    let analise;
    try {
      analise = await analisarRelatorio(cliente, buffer);
    } catch (err) {
      if (err.code) throw err;
      await cliente.query('ROLLBACK');
      return res.status(400).json({ error: err.message });
    }
    const porRef = new Map(analise.itens.map((i) => [i.ref, i]));
    const comprovantes = analise.leitura.formato === 'comprovantes';
    const contasUsadas = new Set();

    for (const escolha of escolhas) {
      const item = porRef.get(escolha.ref);
      let contaId = Number(escolha.conta_id);
      const recusar = (motivo) => recusados.push({ ref: escolha.ref, motivo });

      if (!item) { recusar('Pagamento não encontrado no relatório.'); continue; }

      if (escolha.conta_id === 'novo') {
        if (!SITUACOES_QUE_CADASTRAM.has(item.situacao)) { recusar(item.motivo || 'Este pagamento não pode virar boleto novo.'); continue; }
        // Ponto de retorno: se a baixa não entrar, o boleto criado sai junto.
        await cliente.query('SAVEPOINT novo_boleto');
        try {
          const { conta, fornecedorCriado } = await cadastrarConta(cliente, item.pagamento, escolha.novo || {}, req.user.id);
          contaId = conta.id;
          cadastradas.push(conta);
          if (fornecedorCriado) fornecedoresCriados += 1;
          item.opcoes = [{ id: conta.id }];
        } catch (err) {
          await cliente.query('ROLLBACK TO SAVEPOINT novo_boleto');
          if (err.code) throw err;
          recusar(err.message);
          continue;
        }
      } else if (!SITUACOES_QUE_GRAVAM.has(item.situacao)) { recusar(item.motivo); continue; }
      // Só as contas que o casamento ofereceu: a tela não pode mandar baixar
      // um boleto qualquer com o dinheiro deste pagamento.
      if (!item.opcoes.some((o) => o.id === contaId)) { recusar('Conta fora das opções deste pagamento.'); continue; }
      if (contasUsadas.has(contaId)) { recusar('A mesma conta foi escolhida para dois pagamentos.'); continue; }

      const p = item.pagamento;
      await cliente.query('SELECT 1 FROM contas WHERE id = $1 FOR UPDATE', [contaId]);
      const { rows: conta } = await cliente.query(
        `SELECT t.id, t.tipo, t.categoria, t.fornecedor_id, t.codigo_barras, t.saldo, f.cnpj_cpf
           FROM (${SELECT_CONTAS_COM_SALDO}) t LEFT JOIN fornecedores f ON f.id = t.fornecedor_id
          WHERE t.id = $1`,
        [contaId]
      );
      if (!conta[0]) { recusar('Conta não existe mais.'); continue; }
      contasUsadas.add(contaId);

      const doComprovante = comprovantes;
      const observacao = [
        doComprovante ? 'Baixa pelo comprovante de pagamento do BB' : 'Baixa pelo relatório de pagamentos do BB',
        p.nome ? `— ${p.nome}` : '',
        p.numero_documento ? `· documento ${p.numero_documento}` : '',
        p.autenticacao ? `· autenticação ${p.autenticacao}` : (p.nosso_numero ? `· nosso número ${p.nosso_numero}` : ''),
      ].filter(Boolean).join(' ');

      // O desconto só abate o que falta pagar: numa conta cadastrada já com o
      // valor descontado, ele não pode deixar o saldo negativo.
      const falta = Number(conta[0].saldo) - p.valor;
      const desconto = Number(Math.max(0, Math.min(Number(p.desconto) || 0, falta)).toFixed(2));

      const { rows } = await cliente.query(
        `INSERT INTO contas_pagamentos
           (conta_id, valor, data_pagamento, forma_pagamento, banco_id, origem, observacoes, pago_por, ref_externa,
            juros, desconto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (ref_externa) WHERE ref_externa IS NOT NULL DO NOTHING
         RETURNING *`,
        [contaId, p.valor, p.data, p.tipo === 'Boleto' ? 'Boleto' : p.tipo, bancoId,
         doComprovante ? 'comprovante-bb' : 'relatorio-bb', observacao, req.user.id, item.ref,
         Number(p.juros) || 0, desconto]
      );
      if (!rows[0]) {
        if (escolha.conta_id === 'novo') {
          await cliente.query('ROLLBACK TO SAVEPOINT novo_boleto');
          cadastradas.pop();
        }
        recusar('Já importado.');
        continue;
      }
      gravados.push({ ...rows[0], fornecedor_nome: p.nome });

      // Cruzar as informações: a conta achada pelo CNPJ e valor, cadastrada sem
      // código de barras, ganha o do comprovante — e da próxima vez é achada
      // por ele, sem dúvida nenhuma.
      if (p.codigo_barras && !conta[0].codigo_barras) {
        await cliente.query(
          `UPDATE contas SET codigo_barras = $2
            WHERE id = $1 AND codigo_barras IS NULL
              AND NOT EXISTS (SELECT 1 FROM contas WHERE codigo_barras = $2)`,
          [contaId, p.codigo_barras]
        );
      }
      await aprenderBeneficiario(cliente, p, conta[0]);

      // O banco diz como foi pago: a conta sem "como costuma pagar" ganha a forma.
      if (p.tipo === 'Boleto') {
        await cliente.query(
          "UPDATE contas SET forma_prevista = 'Boleto' WHERE id = $1 AND (forma_prevista IS NULL OR btrim(forma_prevista) = '')",
          [contaId]
        );
      }

      // O fornecedor sem CNPJ aprende o CNPJ na primeira baixa confirmada: da
      // próxima vez, o casamento é pelo CNPJ, e não mais pelo nome.
      const cnpj = soDigitos(p.cnpj);
      if (cnpj.length === 14 && conta[0].fornecedor_id && !soDigitos(conta[0].cnpj_cpf)) {
        await cliente.query(
          `UPDATE fornecedores SET cnpj_cpf = $2
            WHERE id = $1 AND (cnpj_cpf IS NULL OR btrim(cnpj_cpf) = '')`,
          [conta[0].fornecedor_id, formatarCnpj(cnpj)]
        );
      }
    }

    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  for (const conta of cadastradas) {
    await registrarAuditoria({
      usuarioId: req.user.id,
      acao: 'create',
      entidade: 'contas',
      entidadeId: conta.id,
      dados: { ...conta, origem: 'pagamentos-bb' },
    });
  }

  if (gravados.length) {
    await registrarAuditoria({
      usuarioId: req.user.id,
      acao: 'importacao',
      entidade: 'contas_pagamentos',
      entidadeId: 0,
      dados: {
        origem: 'relatorio-bb',
        quantidade: gravados.length,
        valor: Number(gravados.reduce((a, g) => a + Number(g.valor), 0).toFixed(2)),
        pagamentos: gravados.map((g) => ({ conta_id: g.conta_id, valor: g.valor, data: g.data_pagamento })),
      },
    });
  }

  return res.json({
    gravados: gravados.length,
    valor: Number(gravados.reduce((a, g) => a + Number(g.valor), 0).toFixed(2)),
    recusados,
    cadastradas: cadastradas.length,
    fornecedores_criados: fornecedoresCriados,
  });
}

module.exports = { analisar, importar };
