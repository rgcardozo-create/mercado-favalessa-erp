const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const recebimentos = require('../controllers/recebimentosController');

const router = express.Router();

router.use(authenticate);
router.use(exigirTela('recebimentos'));

router.get('/', asyncHandler(recebimentos.resumo));

// A taxa combinada é informação de contrato: quem altera é quem negocia.
router.get('/taxas-combinadas', asyncHandler(recebimentos.listarRegras));
router.post('/taxas-combinadas', authorize('master', 'gerente'), asyncHandler(recebimentos.salvarRegra));
router.delete('/taxas-combinadas/:id', authorize('master', 'gerente'), asyncHandler(recebimentos.deletarRegra));

module.exports = router;
