const pool = require('../db/pool');
const { analisarExtrato, lerArquivo } = require('../utils/lerPlanilha');
const { lerVendasPorCaixa } = require('../utils/vendasCaixa');
const { converterLinhas } = require('../utils/extrato');
const { impressaoDigital } = require('../db/importarBackup');
const { registrarAuditoria } = require('../utils/auditoria');

const ADQUIRENTES = ['cielo', 'stone', 'itau', 'tickets'];

// Grava as transações lidas de um extrato. Usa a mesma impressão digital da
// importação de backup, então reimportar o mesmo período (ou um extrato que se
// sobrepõe a outro já carregado) atualiza em vez de duplicar.
async function gravarTransacoes(transacoes) {
  const client = await pool.connect();
  const vistos = new Map();

  const impressoes = transacoes.map((t) =>
    impressaoDigital(vistos, [
      t.adquirente, t.data, t.hora, Number(t.valorBruto).toFixed(2), t.bandeira, t.forma,
    ])
  );
  let jaExistiam = new Set();

  try {
    await client.query('BEGIN');

    // O que já está no banco, para distinguir novidade de recarga.
    const { rows: existentes } = await client.query(
      'SELECT impressao_digital FROM conciliacao_transacoes WHERE impressao_digital = ANY($1)',
      [impressoes]
    );
    jaExistiam = new Set(existentes.map((r) => r.impressao_digital));

    for (let i = 0; i < transacoes.length; i += 1) {
      const t = transacoes[i];
      await client.query(
        `INSERT INTO conciliacao_transacoes
           (adquirente, data, hora, forma, bandeira, valor_bruto, tarifa, valor_liquido,
            categoria, status, arquivo, importado_em, impressao_digital)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
         ON CONFLICT (impressao_digital) DO UPDATE
           SET tarifa = EXCLUDED.tarifa,
               valor_liquido = EXCLUDED.valor_liquido,
               categoria = EXCLUDED.categoria,
               status = EXCLUDED.status,
               arquivo = EXCLUDED.arquivo,
               importado_em = EXCLUDED.importado_em`,
        [
          t.adquirente, t.data, t.hora, t.forma, t.bandeira, t.valorBruto, t.tarifa,
          t.valorLiquido, t.categoria, t.status, t.arquivo, impressoes[i],
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Separar novas de atualizadas mostra ao usuário se ele carregou um período
  // que já estava no sistema — a diferença entre "importei 500 vendas novas" e
  // "recarreguei as mesmas 500".
  const porTipo = {};
  let novas = 0;
  let atualizadas = 0;

  transacoes.forEach((t, i) => {
    porTipo[t.adquirente] = (porTipo[t.adquirente] || 0) + 1;
    if (jaExistiam.has(impressoes[i])) atualizadas += 1;
    else novas += 1;
  });

  return { total: transacoes.length, novas, atualizadas, por_tipo: porTipo };
}

const ROTULOS = {
  cielo: 'Cielo',
  stone: 'Stone',
  itau: 'Itaú',
  tickets: 'Tickets / Rede Compras',
};

// Período padrão quando o usuário não informa: mês corrente no fuso da loja.
function periodoDaQuery(query) {
  const { de, ate } = query;
  return {
    de: de || null,
    ate: ate || null,
  };
}

function filtroPeriodo(de, ate, params, coluna = 'data') {
  const partes = [];
  if (de) {
    params.push(de);
    partes.push(`${coluna} >= $${params.length}`);
  }
  if (ate) {
    params.push(ate);
    partes.push(`${coluna} <= $${params.length}`);
  }
  return partes;
}

// Resumo por adquirente no período + total de dinheiro conferido por PDV.
async function resumo(req, res) {
  const { de, ate } = periodoDaQuery(req.query);

  const paramsCartao = [];
  const condicoesCartao = filtroPeriodo(de, ate, paramsCartao);
  const whereCartao = condicoesCartao.length ? `WHERE ${condicoesCartao.join(' AND ')}` : '';

  const { rows: porAdquirente } = await pool.query(
    `SELECT adquirente,
            count(*)::int AS transacoes,
            COALESCE(sum(valor_bruto), 0) AS bruto,
            COALESCE(sum(tarifa), 0) AS tarifa,
            COALESCE(sum(valor_liquido), 0) AS liquido,
            min(data) AS primeira_data,
            max(data) AS ultima_data
       FROM conciliacao_transacoes
       ${whereCartao}
      GROUP BY adquirente`,
    paramsCartao
  );

  const paramsDinheiro = [];
  const condicoesDinheiro = filtroPeriodo(de, ate, paramsDinheiro);
  const whereDinheiro = condicoesDinheiro.length ? `WHERE ${condicoesDinheiro.join(' AND ')}` : '';

  const { rows: dinheiroRows } = await pool.query(
    `SELECT pdv, count(*)::int AS lancamentos, COALESCE(sum(valor), 0) AS total
       FROM conciliacao_dinheiro
       ${whereDinheiro}
      GROUP BY pdv
      ORDER BY pdv`,
    paramsDinheiro
  );

  const porAdquirenteCompleto = ADQUIRENTES.map((a) => {
    const achado = porAdquirente.find((r) => r.adquirente === a);
    return {
      adquirente: a,
      rotulo: ROTULOS[a],
      transacoes: achado ? achado.transacoes : 0,
      bruto: achado ? Number(achado.bruto) : 0,
      tarifa: achado ? Number(achado.tarifa) : 0,
      liquido: achado ? Number(achado.liquido) : 0,
      primeira_data: achado ? achado.primeira_data : null,
      ultima_data: achado ? achado.ultima_data : null,
    };
  });

  const somar = (campo) => porAdquirenteCompleto.reduce((acc, a) => acc + a[campo], 0);

  return res.json({
    periodo: { de, ate },
    por_adquirente: porAdquirenteCompleto,
    totais_cartao: {
      transacoes: somar('transacoes'),
      bruto: somar('bruto'),
      tarifa: somar('tarifa'),
      liquido: somar('liquido'),
    },
    dinheiro: {
      por_pdv: dinheiroRows.map((r) => ({
        pdv: r.pdv,
        lancamentos: r.lancamentos,
        total: Number(r.total),
      })),
      total: dinheiroRows.reduce((acc, r) => acc + Number(r.total), 0),
    },
  });
}

// Listagem paginada — a conciliação tem milhares de linhas, então nunca devolve tudo.
async function listarTransacoes(req, res) {
  const { de, ate } = periodoDaQuery(req.query);
  const { adquirente } = req.query;

  const limite = Math.min(Number(req.query.limite) || 100, 500);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);

  const params = [];
  const condicoes = filtroPeriodo(de, ate, params);

  if (adquirente) {
    if (!ADQUIRENTES.includes(adquirente)) {
      return res.status(400).json({ error: `adquirente inválido. Use um de: ${ADQUIRENTES.join(', ')}.` });
    }
    params.push(adquirente);
    condicoes.push(`adquirente = $${params.length}`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const { rows: totalRows } = await pool.query(
    `SELECT count(*)::int AS total FROM conciliacao_transacoes ${where}`,
    params
  );
  const total = totalRows[0].total;

  params.push(limite, (pagina - 1) * limite);
  const { rows } = await pool.query(
    `SELECT * FROM conciliacao_transacoes ${where}
      ORDER BY data DESC, hora DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return res.json({
    total,
    pagina,
    limite,
    paginas: Math.ceil(total / limite) || 1,
    transacoes: rows,
  });
}

// ── Importação de extrato ─────────────────────────────────────────────────────
//
// Dois passos de propósito: primeiro o sistema lê o arquivo e mostra o que
// entendeu (quais colunas, quantas linhas, uma amostra); só depois de o usuário
// conferir é que grava. Cada adquirente entrega um layout diferente, então
// gravar direto seria apostar que a leitura saiu certa.

// Erros de leitura de planilha vêm em inglês e falando de zip — sem sentido para
// quem só quer carregar o extrato do banco.
function mensagemDeLeitura(err) {
  const m = String(err && err.message);
  if (/zip|central directory|corrupt/i.test(m)) {
    return 'Não consegui abrir este arquivo como planilha. Confira se é o .xlsx (ou .csv) baixado do adquirente e se ele não está corrompido.';
  }
  if (/vazia/i.test(m)) return m;
  return `Não foi possível ler a planilha: ${m}`;
}

function arquivoDoCorpo(req) {
  const { arquivo_base64: base64, nome_arquivo: nome } = req.body || {};
  if (!base64) return null;
  return { buffer: Buffer.from(base64, 'base64'), nome: nome || 'extrato.xlsx' };
}

async function analisarExtratoEnviado(req, res) {
  const arquivo = arquivoDoCorpo(req);
  if (!arquivo) {
    return res.status(400).json({ error: 'Envie o arquivo do extrato.' });
  }

  let analise;
  try {
    analise = await analisarExtrato(arquivo.buffer, arquivo.nome);
  } catch (err) {
    return res.status(400).json({ error: mensagemDeLeitura(err) });
  }

  // Prévia do que seria importado, com o mapa detectado (ou o que o usuário mandou).
  const mapa = req.body.mapa || analise.mapa || {};
  const adquirente = req.body.adquirente;

  if (adquirente && !ADQUIRENTES.includes(adquirente)) {
    return res.status(400).json({ error: `adquirente inválido. Use um de: ${ADQUIRENTES.join(', ')}.` });
  }

  let previa = null;
  if (analise.reconhecido && adquirente) {
    const linhas = await lerArquivo(arquivo.buffer, arquivo.nome);
    const dados = linhas.slice(analise.linha_cabecalho + 1);
    const { transacoes, ignoradas } = converterLinhas(dados, mapa, adquirente, arquivo.nome);

    const porTipo = {};
    for (const t of transacoes) {
      porTipo[t.adquirente] = porTipo[t.adquirente] || { quantidade: 0, bruto: 0 };
      porTipo[t.adquirente].quantidade += 1;
      porTipo[t.adquirente].bruto += t.valorBruto;
    }

    previa = {
      total: transacoes.length,
      ignoradas,
      por_tipo: porTipo,
      periodo: transacoes.length
        ? { de: transacoes.reduce((a, t) => (t.data < a ? t.data : a), transacoes[0].data),
            ate: transacoes.reduce((a, t) => (t.data > a ? t.data : a), transacoes[0].data) }
        : null,
      primeiras: transacoes.slice(0, 8),
    };
  }

  return res.json({ ...analise, mapa, previa });
}

async function importarExtrato(req, res) {
  const arquivo = arquivoDoCorpo(req);
  const { adquirente } = req.body || {};

  if (!arquivo) return res.status(400).json({ error: 'Envie o arquivo do extrato.' });
  if (!ADQUIRENTES.includes(adquirente)) {
    return res.status(400).json({ error: `Escolha o adquirente. Use um de: ${ADQUIRENTES.join(', ')}.` });
  }

  let analise;
  try {
    analise = await analisarExtrato(arquivo.buffer, arquivo.nome);
  } catch (err) {
    return res.status(400).json({ error: mensagemDeLeitura(err) });
  }

  const mapa = req.body.mapa || analise.mapa || {};
  if (mapa.data === undefined || mapa.valorBruto === undefined) {
    return res.status(400).json({
      error: 'Não consegui identificar as colunas de data e valor. Confira o mapeamento antes de importar.',
    });
  }

  const linhas = await lerArquivo(arquivo.buffer, arquivo.nome);
  const dados = linhas.slice((analise.linha_cabecalho ?? -1) + 1);
  const { transacoes, ignoradas } = converterLinhas(dados, mapa, adquirente, arquivo.nome);

  if (!transacoes.length) {
    return res.status(400).json({ error: 'Nenhuma transação encontrada no arquivo.' });
  }

  const resultado = await gravarTransacoes(transacoes);

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'importacao',
    entidade: 'conciliacao',
    entidadeId: 0,
    dados: { arquivo: arquivo.nome, adquirente, ...resultado },
  });

  return res.json({ ...resultado, ignoradas });
}

// ── Vendas por caixa (dinheiro do PDV) ───────────────────────────────────────
// O relatório de finalizadoras do sistema de frente de caixa é a única fonte do
// dinheiro do dia: extrato de adquirente não vê venda em espécie. Importado
// aqui, ele preenche sozinho a coluna Dinheiro do fechamento em lote.

async function analisarVendasCaixa(req, res) {
  const arquivo = arquivoDoCorpo(req);
  if (!arquivo) return res.status(400).json({ error: 'Envie o relatório de vendas por caixa.' });

  let leitura;
  try {
    leitura = await lerVendasPorCaixa(arquivo.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Quais dias já têm dinheiro lançado: reimportar substitui, e quem confere
  // precisa saber disso antes de clicar, não depois.
  const { rows: existentes } = await pool.query(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data, count(*)::int AS registros,
            COALESCE(sum(valor), 0) AS total
       FROM conciliacao_dinheiro
      WHERE data BETWEEN $1 AND $2
      GROUP BY 1`,
    [leitura.periodo.de, leitura.periodo.ate]
  );

  const porDia = new Map();
  for (const linha of leitura.linhas) {
    const dia = porDia.get(linha.data) || { data: linha.data, caixas: [], total: 0 };
    dia.caixas.push({ pdv: linha.pdv, valor: linha.valor });
    dia.total = Math.round((dia.total + linha.valor) * 100) / 100;
    porDia.set(linha.data, dia);
  }

  return res.json({
    periodo: leitura.periodo,
    caixas: leitura.caixas,
    descricoes: leitura.descricoes,
    total: leitura.total,
    dias: [...porDia.values()].map((dia) => {
      const jaTem = existentes.find((e) => e.data === dia.data);
      return { ...dia, ja_lancado: jaTem ? Number(jaTem.total) : null };
    }),
  });
}

async function importarVendasCaixa(req, res) {
  const arquivo = arquivoDoCorpo(req);
  if (!arquivo) return res.status(400).json({ error: 'Envie o relatório de vendas por caixa.' });

  let leitura;
  try {
    leitura = await lerVendasPorCaixa(arquivo.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const cliente = await pool.connect();
  let substituidos = 0;
  try {
    await cliente.query('BEGIN');

    for (const linha of leitura.linhas) {
      // Um fechamento por caixa e por dia. Reimportar o mesmo período substitui
      // o valor em vez de somar outro — foi o mesmo caixa, no mesmo dia, e o
      // relatório novo é a versão boa.
      const { rowCount } = await cliente.query(
        'DELETE FROM conciliacao_dinheiro WHERE data = $1 AND pdv IS NOT DISTINCT FROM $2',
        [linha.data, linha.pdv]
      );
      substituidos += rowCount;

      await cliente.query(
        `INSERT INTO conciliacao_dinheiro (data, pdv, valor, impressao_digital)
         VALUES ($1, $2, $3, $4)`,
        [linha.data, linha.pdv, linha.valor, `${linha.data}|${linha.pdv}|${linha.valor.toFixed(2)}`]
      );
    }

    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'importacao',
    entidade: 'conciliacao_dinheiro',
    entidadeId: 0,
    dados: { arquivo: arquivo.nome, periodo: leitura.periodo, linhas: leitura.linhas.length },
  });

  return res.status(201).json({
    gravados: leitura.linhas.length,
    substituidos,
    periodo: leitura.periodo,
    total: leitura.total,
    caixas: leitura.caixas,
  });
}

module.exports = {
  analisarVendasCaixa,
  importarVendasCaixa,
  resumo,
  listarTransacoes,
  analisarExtratoEnviado,
  importarExtrato,
  ADQUIRENTES,
};
