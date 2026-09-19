const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const c = require('../controllers/vendaPrazoController');
const importar = require('../controllers/vendaPrazoImportController');

const router = express.Router();

// Venda a prazo está na lista de acesso da Gerente, e o login "Loja" tem o mesmo
// nível dela por padrão — quem está no caixa precisa lançar a compra do fiado.
router.use(authenticate);
router.use(exigirTela('venda-prazo'));

router.get('/', asyncHandler(c.resumo));

// Aviso do painel: quem passou de 30 dias vencido e precisa ser bloqueado.
router.get('/alertas', asyncHandler(c.alertas));

// Importar o "Contas a Receber" do PDV. O corpo traz a planilha em base64 e
// passa do limite global de 1 MB, então a rota traz o próprio parser.
const corpoGrande = express.json({ limit: process.env.LIMITE_IMPORTACAO || '25mb' });
const CAMINHOS_COM_ARQUIVO = ['/importar/analisar', '/importar'];

router.post('/importar/analisar', authorize('master', 'gerente'), corpoGrande, asyncHandler(importar.analisar));
router.post('/importar', authorize('master', 'gerente'), corpoGrande, asyncHandler(importar.importar));

// Dia de corte e vencimento do caderno: regra da casa, então Master e Gerente.
router.put('/config', authorize('master', 'gerente'), asyncHandler(c.salvarConfigPrazo));
router.get('/clientes/:id', asyncHandler(c.extratoCliente));
router.post('/movimentos', asyncHandler(c.criarMovimento));
router.delete('/movimentos/:id', authorize('master', 'gerente'), asyncHandler(c.deletarMovimento));

router.caminhosComArquivo = CAMINHOS_COM_ARQUIVO;

module.exports = router;
