const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const acumuladosController = require('../controllers/acumuladosController');

const router = express.Router();

// Acumulado é conferência de caixa e só faz sentido com supervisão: visível apenas
// para Master e Gerente, nunca no login "Loja" (SPEC.md, seção 3).
router.use(authenticate, authorize('master', 'gerente'));

router.get('/', asyncHandler(acumuladosController.listar));
router.post('/', asyncHandler(acumuladosController.criar));
router.delete('/:id', asyncHandler(acumuladosController.deletar));

module.exports = router;
