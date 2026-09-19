const crypto = require('crypto');
const pool = require('../db/pool');
const { lerArquivo } = require('../utils/lerPlanilha');
const { lerVendaPrazo } = require('../utils/vendaPrazoExtrato');
const { registrarAuditoria } = require('../utils/auditoria');

// Importa o "Contas a Receber" do PDV para dentro do caderno de fiado.
//
// Cada título do relatório vira uma COMPRA na data de emissão. Título com data
// de baixa vira também um PAGAMENTO naquela data, do mesmo valor — assim o saldo
// do cliente aqui fica igual ao do PDV, e o extrato mostra compra por compra,
// que é o que o dono quer ver quando o cliente pergunta de onde vem a dívida.

function arquivoDoCorpo(req) {
  const { arquivo, nome } = req.body || {};
  if (!arquivo) return null;
  const base64 = String(arquivo).includes(',') ? String(arquivo).split(',').pop() : String(arquivo);
  return { buffer: Buffer.from(base64, 'base64'), nome: nome || 'contas-a-receber.xlsx' };
}

// Identidade do lançamento, para reimportar atualizar em vez de duplicar. O
// número do documento é único no relatório; quando falta, a identidade vem do
// conteúdo (cliente, data e valor), que é estável entre duas exportações.
function identidade(codigo, titulo, ocorrencia, sufixo) {
  // Sem documento, a identidade vem do conteúdo — mais a ordem dentro do
  // cliente, porque duas compras do mesmo dia pelo mesmo valor existem e sem o
  // desempate uma comeria a outra.
  const base = titulo.documento
    ? `d${titulo.documento}`
    : `h${crypto
        .createHash('sha1')
        .update(`${codigo}|${titulo.emissao}|${titulo.valor}|${titulo.historico}|${ocorrencia}`)
        .digest('hex')
        .slice(0, 12)}`;
  return `prazo:${base}${sufixo}`;
}

async function analisar(req, res) {
  const arquivo = arquivoDoCorpo(req);
  if (!arquivo) return res.status(400).json({ error: 'Envie o arquivo do relatório.' });

  let leitura;
  try {
    leitura = lerVendaPrazo(await lerArquivo(arquivo.buffer, arquivo.nome));
  } catch (err) {
    return res.status(400).json({ error: `Não consegui ler a planilha: ${err.message}` });
  }

  if (!leitura.clientes.length) {
    return res.status(400).json({
      error: 'Não achei nenhum cliente neste arquivo. Ele precisa ser o relatório "Contas a Receber" do PDV.',
    });
  }

  // Quem já existe pelo código, e com que nome.
  const codigos = leitura.clientes.map((c) => c.codigo);
  const { rows: existentes } = await pool.query(
    'SELECT id, codigo, nome FROM clientes WHERE codigo = ANY($1::text[])',
    [codigos]
  );
  const porCodigo = new Map(existentes.map((c) => [c.codigo, c]));

  const novos = [];
  const renomeados = [];
  for (const c of leitura.clientes) {
    const achado = porCodigo.get(c.codigo);
    if (!achado) novos.push({ codigo: c.codigo, nome: c.nome, titulos: c.titulos.length });
    else if (achado.nome.trim().toLowerCase() !== c.nome.trim().toLowerCase()) {
      renomeados.push({ codigo: c.codigo, de: achado.nome, para: c.nome });
    }
  }

  return res.json({
    clientes: leitura.clientes.length,
    titulos: leitura.soma.titulos,
    soma: leitura.soma,
    geral: leitura.geral,
    // A tela decide se deixa importar. Não conferindo, não deixa.
    confere: leitura.confere,
    divergentes: leitura.divergentes.slice(0, 10),
    novos,
    renomeados,
    periodo: periodoDe(leitura.clientes),
  });
}

function periodoDe(clientes) {
  const datas = clientes.flatMap((c) => c.titulos.map((t) => t.emissao)).sort();
  return datas.length ? { de: datas[0], ate: datas[datas.length - 1] } : null;
}

async function importar(req, res) {
  const arquivo = arquivoDoCorpo(req);
  if (!arquivo) return res.status(400).json({ error: 'Envie o arquivo do relatório.' });

  let leitura;
  try {
    leitura = lerVendaPrazo(await lerArquivo(arquivo.buffer, arquivo.nome));
  } catch (err) {
    return res.status(400).json({ error: `Não consegui ler a planilha: ${err.message}` });
  }

  // Não bateu com os totais do próprio arquivo, não entra.
  //
  // O relatório tem colunas que escorregam de linha para linha; ler quase certo
  // é fácil, e quase certo num caderno de fiado é cobrar do cliente errado. O
  // arquivo declara os próprios totais — se a leitura não reproduz, o problema é
  // da leitura, e importar seria gravar erro com cara de dado.
  if (!leitura.confere) {
    return res.status(400).json({
      error:
        'A leitura não bateu com os totais declarados no próprio arquivo. Não vou importar: ' +
        'melhor não ter o dado do que ter o dado errado. Me mande o arquivo para eu acertar a leitura.',
      divergentes: leitura.divergentes.slice(0, 10),
    });
  }

  const cliente = await pool.connect();
  const resultado = { clientes_novos: [], renomeados: [], compras: 0, pagamentos: 0, atualizados: 0 };

  try {
    await cliente.query('BEGIN');

    for (const c of leitura.clientes) {
      // Cadastra o cliente novo em vez de recusar o título dele. O relatório já
      // traz código e nome; exigir cadastro manual antes seria pedir ao dono
      // para digitar o que o arquivo já disse.
      const { rows } = await cliente.query(
        `INSERT INTO clientes (codigo, nome) VALUES ($1, $2)
         ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING id, nome, (xmax = 0) AS criado`,
        [c.codigo, c.nome]
      );
      const registro = rows[0];
      if (registro.criado) resultado.clientes_novos.push({ codigo: c.codigo, nome: c.nome });

      let ordem = 0;
      for (const t of c.titulos) {
        ordem += 1;
        const observacao = t.historico || null;

        const compra = await cliente.query(
          `INSERT INTO mov_prazo (cliente_id, tipo, valor, data, observacoes, legado_id, criado_por)
           VALUES ($1, 'compra', $2, $3, $4, $5, $6)
           ON CONFLICT (legado_id) DO UPDATE
             SET valor = EXCLUDED.valor, data = EXCLUDED.data, observacoes = EXCLUDED.observacoes
           RETURNING (xmax = 0) AS criado`,
          [registro.id, t.valor, t.emissao, observacao, identidade(c.codigo, t, ordem, ''), req.user.id]
        );
        if (compra.rows[0].criado) resultado.compras += 1;
        else resultado.atualizados += 1;

        if (t.baixa) {
          const pago = await cliente.query(
            `INSERT INTO mov_prazo (cliente_id, tipo, valor, data, observacoes, legado_id, criado_por)
             VALUES ($1, 'pagamento', $2, $3, $4, $5, $6)
             ON CONFLICT (legado_id) DO UPDATE
               SET valor = EXCLUDED.valor, data = EXCLUDED.data
             RETURNING (xmax = 0) AS criado`,
            [registro.id, t.valor, t.baixa, 'Baixa do PDV', identidade(c.codigo, t, ordem, ':b'), req.user.id]
          );
          if (pago.rows[0].criado) resultado.pagamentos += 1;
        }
      }
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
    acao: 'importar-contas-a-receber',
    entidade: 'mov_prazo',
    dados: {
      arquivo: arquivo.nome,
      clientes: leitura.clientes.length,
      titulos: leitura.soma.titulos,
      ...resultado,
    },
  });

  return res.json({ ...resultado, soma: leitura.soma, titulos: leitura.soma.titulos });
}

module.exports = { analisar, importar };
