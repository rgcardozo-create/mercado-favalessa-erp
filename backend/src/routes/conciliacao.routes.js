const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const {
  resumo,
  listarTransacoes,
  analisarExtratoEnviado,
  importarExtrato,
} = require('../controllers/conciliacaoController');

const router = express.Router();

// Extratos chegam como planilha em base64; o corpo passa do limite global de 1 MB.
const corpoGrande = express.json({ limit: process.env.LIMITE_IMPORTACAO || '25mb' });

// Conciliação está na lista de acesso da Gerente, e o login "Loja" tem o mesmo
// nível dela por padrão (SPEC.md, seção 3) — por isso vale para os 3 perfis.
router.use(authenticate);

router.get('/', asyncHandler(resumo));
router.get('/transacoes', asyncHandler(listarTransacoes));

// Carregar extrato altera os números de faturamento, então fica com Master e
// Gerente — não entra no login compartilhado da loja.
router.post('/extratos/analisar', authorize('master', 'gerente'), corpoGrande, asyncHandler(analisarExtratoEnviado));
router.post('/extratos', authorize('master', 'gerente'), corpoGrande, asyncHandler(importarExtrato));

module.exports = router;
