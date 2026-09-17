const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { taxas } = require('../controllers/taxasController');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const {
  resumo,
  listarTransacoes,
  analisarExtratoEnviado,
  importarExtrato,
  analisarVendasCaixa,
  importarVendasCaixa,
  listarDinheiro,
  criarDinheiro,
  atualizarDinheiro,
  deletarDinheiro,
  deletarTransacao,
} = require('../controllers/conciliacaoController');
const banco = require('../controllers/extratoBancoController');

const router = express.Router();

// Extratos chegam como planilha em base64; o corpo passa do limite global de 1 MB.
const corpoGrande = express.json({ limit: process.env.LIMITE_IMPORTACAO || '25mb' });

// O app precisa saber quais caminhos daqui trazem o próprio parser, para não
// rejeitar o corpo no limite apertado antes de a rota ser alcançada. A lista
// mora ao lado das rotas de propósito: em app.js ela envelheceria calada, e foi
// exatamente assim que os extratos ficaram presos em 1 MB enquanto a rota dizia
// 25 MB.
const CAMINHOS_COM_ARQUIVO = [
  '/extratos', '/extratos/analisar',
  '/vendas-caixa', '/vendas-caixa/analisar',
  '/extrato-banco', '/extrato-banco/analisar',
];

// Conciliação está na lista de acesso da Gerente, e o login "Loja" tem o mesmo
// nível dela por padrão (SPEC.md, seção 3) — por isso vale para os 3 perfis.
router.use(authenticate);
router.use(exigirTela('conciliacao'));

router.get('/', asyncHandler(resumo));
router.get('/transacoes', asyncHandler(listarTransacoes));

// Dinheiro do PDV na mão: cadastrar, corrigir e excluir. Até aqui a Conciliação
// só sabia receber arquivo, e o que entrava errado ficava errado para sempre.
// Quem está no caixa lança; corrigir e excluir ficam com Master e Gerente,
// porque mexem em número de faturamento já fechado.
router.get('/dinheiro', asyncHandler(listarDinheiro));
router.post('/dinheiro', asyncHandler(criarDinheiro));
router.put('/dinheiro/:id', authorize('master', 'gerente'), asyncHandler(atualizarDinheiro));
router.delete('/dinheiro/:id', authorize('master', 'gerente'), asyncHandler(deletarDinheiro));

// Transação de cartão que entrou errada. Reimportar o arquivo certo depois traz
// a linha de volta — a importação é idempotente, então isto não é caminho sem volta.
router.delete('/transacoes/:id', authorize('master', 'gerente'), asyncHandler(deletarTransacao));

// Análise das taxas das adquirentes por bandeira. Só lê; não grava nada.
router.get('/taxas', asyncHandler(taxas));

// Carregar extrato altera os números de faturamento, então fica com Master e
// Gerente — não entra no login compartilhado da loja.
router.post('/extratos/analisar', authorize('master', 'gerente'), corpoGrande, asyncHandler(analisarExtratoEnviado));
router.post('/extratos', authorize('master', 'gerente'), corpoGrande, asyncHandler(importarExtrato));

// Relatório de vendas por caixa: é ele que traz o dinheiro do dia.
router.post('/vendas-caixa/analisar', authorize('master', 'gerente'), corpoGrande, asyncHandler(analisarVendasCaixa));
router.post('/vendas-caixa', authorize('master', 'gerente'), corpoGrande, asyncHandler(importarVendasCaixa));


// Saídas do extrato bancário viram contas já pagas — mexe em despesa, então
// fica com Master e Gerente, como os outros extratos.
router.post('/extrato-banco/analisar', authorize('master', 'gerente'), corpoGrande, asyncHandler(banco.analisar));
router.post('/extrato-banco', authorize('master', 'gerente'), corpoGrande, asyncHandler(banco.importar));
router.get('/extrato-banco/regras', asyncHandler(banco.listarRegras));
router.delete('/extrato-banco/regras/:id', authorize('master', 'gerente'), asyncHandler(banco.deletarRegra));

router.caminhosComArquivo = CAMINHOS_COM_ARQUIVO;

module.exports = router;
