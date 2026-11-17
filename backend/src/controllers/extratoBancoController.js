const pool = require('../db/pool');
const { lerExtratoBanco } = require('../utils/extratoBanco');
const { converterLancamentos } = require('../utils/extratoBancoApi');
const { lerConfig, criarCliente, ErroBB } = require('../utils/bbExtratosApi');
const { montarGrupos, conflitoDeModo, validarRegra, gravarSaidas } = require('../utils/saidasBanco');
const { executarBusca, statusIntegracao, bancoConfigurado } = require('../jobs/extratoBbDiario');
const { registrarAuditoria } = require('../utils/auditoria');

// Importação das SAÍDAS do extrato bancário.
//
// O desenho vem do jeito como o dono trabalha: ele olha a lista, joga fora o que
// é transferência entre as contas dele, diz quem é o resto — e a partir daí o
// sistema não pergunta de novo. Por isso o que ele ensina é guardado por chave,
// e não por linha: um Pix da noite ensinado classifica os vinte e cinco.
//
// Nada é gravado na análise. A tela mostra, ele decide, e só então grava.
//
// O extrato chega por duas portas: o arquivo baixado do banco, ou a busca
// direta na API Extratos do Banco do Brasil (`origem: 'api'`, com um período).
// As duas viram a mesma lista de saídas e seguem o mesmo caminho.

// De qual conta é o extrato. É obrigatório: sem saber o banco, a mesma descrição
// em contas diferentes disputa a mesma regra, e a trava contra misturar formatos
// olharia o período de todos juntos.
async function bancoDoCorpo(req) {
  const id = Number(req.body.banco_id);
  if (!id) return { erro: 'Escolha de qual conta é este extrato.' };
  const { rows } = await pool.query('SELECT id, nome FROM bancos WHERE id = $1', [id]);
  if (!rows[0]) return { erro: 'Conta não encontrada no cadastro de Bancos.' };
  return { banco: rows[0] };
}

function arquivoDoCorpo(req) {
  const base64 = req.body.arquivo_base64;
  if (!base64) return null;
  return Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
// Um trimestre por vez: a API aceita 31 dias por consulta e o cliente junta as
// janelas, mas a tela não precisa de mais que isso, e um período enorme
// deixaria a pessoa esperando sem ver nada.
const MAX_DIAS_TELA = 92;

// Lê o extrato pela porta que veio no pedido. Devolve { lido } ou { erro, status }.
async function lerExtrato(req, banco) {
  if (req.body.origem === 'api') {
    const { de, ate } = req.body;
    if (!DATA_ISO.test(de || '') || !DATA_ISO.test(ate || '') || de > ate) {
      return { erro: 'Informe o período: data inicial e final, a inicial antes da final.', status: 400 };
    }
    const dias = (new Date(`${ate}T12:00:00Z`) - new Date(`${de}T12:00:00Z`)) / 86400000 + 1;
    if (dias > MAX_DIAS_TELA) {
      return { erro: `Busque no máximo ${MAX_DIAS_TELA} dias por vez.`, status: 400 };
    }
    // A API devolve o extrato de UMA conta, a configurada no servidor. Aceitar
    // outra conta da tela gravaria o extrato do BB com as regras de outro banco.
    const configurado = await bancoConfigurado();
    if (!configurado || configurado.id !== banco.id) {
      return {
        erro: `A busca pela API só vale para a conta "${configurado ? configurado.nome : 'Banco do Brasil'}".`,
        status: 400,
      };
    }
    try {
      const lancamentos = await criarCliente(lerConfig()).buscarExtrato({ de, ate });
      return { lido: converterLancamentos(lancamentos, banco.id) };
    } catch (err) {
      if (err instanceof ErroBB) return { erro: err.message, status: 502 };
      throw err;
    }
  }

  const buffer = arquivoDoCorpo(req);
  if (!buffer) return { erro: 'Envie o arquivo do extrato.', status: 400 };
  return { lido: await lerExtratoBanco(buffer, req.body.nome_arquivo || 'extrato.xlsx', banco.id) };
}

async function analisar(req, res) {
  const { banco, erro } = await bancoDoCorpo(req);
  if (erro) return res.status(400).json({ error: erro });

  const leitura = await lerExtrato(req, banco);
  if (leitura.erro) return res.status(leitura.status).json({ error: leitura.erro });
  const { lido } = leitura;
  if (!lido.reconhecido) {
    return res.json({ reconhecido: false, colunas: lido.colunas, amostra: lido.amostra });
  }

  const grupos = await montarGrupos(lido.saidas, banco.id);
  return res.json({
    reconhecido: true,
    origem: lido.origem || 'arquivo',
    banco,
    colunas: lido.colunas,
    modo: lido.modo,
    conflito: await conflitoDeModo(lido, banco),
    ignoradas: lido.ignoradas,
    total_saidas: lido.saidas.length,
    total_valor: lido.saidas.reduce((a, s) => a + s.valor, 0),
    grupos,
  });
}

async function importar(req, res) {
  const regras = Array.isArray(req.body.regras) ? req.body.regras : [];
  for (const r of regras) {
    const erro = validarRegra(r);
    if (erro) return res.status(400).json({ error: erro });
  }

  const { banco, erro } = await bancoDoCorpo(req);
  if (erro) return res.status(400).json({ error: erro });

  const leitura = await lerExtrato(req, banco);
  if (leitura.erro) return res.status(leitura.status).json({ error: leitura.erro });
  const { lido } = leitura;
  if (!lido.reconhecido) return res.status(400).json({ error: 'Não reconheci as colunas deste extrato.' });

  const conflito = await conflitoDeModo(lido, banco);
  if (conflito) return res.status(409).json({ error: conflito.mensagem, conflito });

  const resultado = await gravarSaidas({ lido, banco, regras, usuarioId: req.user.id });

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: lido.origem === 'api' ? 'importar-extrato-banco-api' : 'importar-extrato-banco',
    entidade: 'contas',
    dados: resultado,
  });

  return res.status(201).json(resultado);
}

async function listarRegras(req, res) {
  const { rows } = await pool.query(
    `SELECT r.*, f.nome AS fornecedor_nome, b.nome AS banco_nome
       FROM regras_extrato r
       LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
       LEFT JOIN bancos b ON b.id = r.banco_id
      ORDER BY b.nome, r.vezes DESC, r.chave`
  );
  return res.json(rows);
}

async function deletarRegra(req, res) {
  const { rows } = await pool.query('DELETE FROM regras_extrato WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Regra não encontrada.' });
  return res.status(204).send();
}

// Situação da integração com a API do BB: se está configurada, o que falta, e
// as últimas buscas. Nunca devolve credencial: só o nome do que falta.
async function statusApi(req, res) {
  return res.json(await statusIntegracao());
}

// "Buscar agora": a mesma busca da madrugada, disparada da tela. Útil para
// conferir a configuração sem esperar o dia seguinte.
async function buscarAgora(req, res) {
  try {
    const r = await executarBusca({ origem: 'manual', usuarioId: req.user.id });
    return res.status(201).json(r);
  } catch (err) {
    return res.status(err instanceof ErroBB ? 502 : 400).json({ error: err.message });
  }
}

module.exports = { analisar, importar, listarRegras, deletarRegra, statusApi, buscarAgora };
