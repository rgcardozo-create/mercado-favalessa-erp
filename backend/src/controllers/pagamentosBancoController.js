const pool = require('../db/pool');
const { SELECT_CONTAS_COM_SALDO } = require('../db/contasQuery');
const { lerRelatorioPagamentosBB } = require('../utils/relatorioPagamentosBB');
const { casarPagamentos } = require('../utils/casarPagamentos');
const { registrarAuditoria } = require('../utils/auditoria');

// Baixa dos boletos pelo "Relatório de Pagamentos Realizados" do BB.
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

async function analisarRelatorio(cliente, buffer) {
  const leitura = lerRelatorioPagamentosBB(buffer);
  const contas = await contasParaCasar(cliente, leitura);

  // As referências saem do próprio casamento; a primeira passada só serve
  // para saber quais procurar entre as já importadas.
  const refs = casarPagamentos(leitura.pagamentos, contas).map((i) => i.ref);
  const { rows } = await cliente.query(
    'SELECT ref_externa FROM contas_pagamentos WHERE ref_externa = ANY($1)',
    [refs]
  );
  const itens = casarPagamentos(leitura.pagamentos, contas, new Set(rows.map((r) => r.ref_externa)));
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
    periodo: resultado.leitura.periodo,
    total: resultado.leitura.total,
    itens: resultado.itens,
    resumo: resumoDe(resultado.itens),
    banco_sugerido: sugerido ? sugerido.id : null,
  });
}

const SITUACOES_QUE_GRAVAM = new Set(['codigo', 'nosso_numero', 'cnpj_valor', 'juros', 'escolher', 'pelo_nome']);

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
    const contasUsadas = new Set();

    for (const escolha of escolhas) {
      const item = porRef.get(escolha.ref);
      const contaId = Number(escolha.conta_id);
      const recusar = (motivo) => recusados.push({ ref: escolha.ref, motivo });

      if (!item) { recusar('Pagamento não encontrado no relatório.'); continue; }
      if (!SITUACOES_QUE_GRAVAM.has(item.situacao)) { recusar(item.motivo); continue; }
      // Só as contas que o casamento ofereceu: a tela não pode mandar baixar
      // um boleto qualquer com o dinheiro deste pagamento.
      if (!item.opcoes.some((o) => o.id === contaId)) { recusar('Conta fora das opções deste pagamento.'); continue; }
      if (contasUsadas.has(contaId)) { recusar('A mesma conta foi escolhida para dois pagamentos.'); continue; }

      const p = item.pagamento;
      const { rows: conta } = await cliente.query(
        `SELECT c.id, c.fornecedor_id, f.cnpj_cpf
           FROM contas c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
          WHERE c.id = $1 FOR UPDATE OF c`,
        [contaId]
      );
      if (!conta[0]) { recusar('Conta não existe mais.'); continue; }
      contasUsadas.add(contaId);

      const observacao = [
        'Baixa pelo relatório de pagamentos do BB',
        p.nome ? `— ${p.nome}` : '',
        p.nosso_numero ? `· nosso número ${p.nosso_numero}` : '',
      ].filter(Boolean).join(' ');

      const { rows } = await cliente.query(
        `INSERT INTO contas_pagamentos
           (conta_id, valor, data_pagamento, forma_pagamento, banco_id, origem, observacoes, pago_por, ref_externa)
         VALUES ($1, $2, $3, $4, $5, 'relatorio-bb', $6, $7, $8)
         ON CONFLICT (ref_externa) WHERE ref_externa IS NOT NULL DO NOTHING
         RETURNING *`,
        [contaId, p.valor, p.data, p.tipo === 'Boleto' ? 'Boleto' : p.tipo, bancoId, observacao, req.user.id, item.ref]
      );
      if (!rows[0]) { recusar('Já importado.'); continue; }
      gravados.push({ ...rows[0], fornecedor_nome: p.nome });

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
  });
}

module.exports = { analisar, importar };
