const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const pessoais = require('../controllers/pessoaisController');

const router = express.Router();

// Master e mais ninguém. Não passa por `exigirTela`: contas pessoais não são
// uma tela concedível — não há caixa de marcação na Administração que libere
// isto para gerente ou loja, e é assim de propósito.
router.use(authenticate, authorize('master'));

// Antes de /:id para o caminho literal não virar id.
router.get('/pendencias', asyncHandler(pessoais.pendencias));

router.get('/', asyncHandler(pessoais.listar));
router.post('/', asyncHandler(pessoais.criar));
router.put('/:id', asyncHandler(pessoais.atualizar));
router.post('/:id/pagar', asyncHandler(pessoais.pagar));
router.delete('/:id/pagar', asyncHandler(pessoais.desfazerPagamento));
router.delete('/:id', asyncHandler(pessoais.deletar));

module.exports = router;
