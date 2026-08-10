const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/vendaPrazoController');

const router = express.Router();

// Venda a prazo está na lista de acesso da Gerente, e o login "Loja" tem o mesmo
// nível dela por padrão — quem está no caixa precisa lançar a compra do fiado.
router.use(authenticate);

router.get('/', asyncHandler(c.resumo));
router.get('/clientes/:id', asyncHandler(c.extratoCliente));
router.post('/movimentos', asyncHandler(c.criarMovimento));
router.delete('/movimentos/:id', authorize('master', 'gerente'), asyncHandler(c.deletarMovimento));

module.exports = router;
