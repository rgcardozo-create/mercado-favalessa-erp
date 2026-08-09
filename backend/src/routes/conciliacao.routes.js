const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { resumo, listarTransacoes } = require('../controllers/conciliacaoController');

const router = express.Router();

// Conciliação está na lista de acesso da Gerente, e o login "Loja" tem o mesmo
// nível dela por padrão (SPEC.md, seção 3) — por isso vale para os 3 perfis.
// Se a decisão final for restringir o Loja aqui, basta adicionar authorize().
router.use(authenticate);

router.get('/', asyncHandler(resumo));
router.get('/transacoes', asyncHandler(listarTransacoes));

module.exports = router;
