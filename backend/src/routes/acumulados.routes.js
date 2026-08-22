const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const acumuladosController = require('../controllers/acumuladosController');

const router = express.Router();

// Acumulado é conferência de caixa e só faz sentido com supervisão: visível apenas
// para Master e Gerente, nunca no login "Loja" (SPEC.md, seção 3).
router.use(authenticate, authorize('master', 'gerente'));

router.get('/resumo', asyncHandler(acumuladosController.resumoVendas));
router.get('/dias', asyncHandler(acumuladosController.diaADia));
router.get('/sugestao', asyncHandler(acumuladosController.sugestaoDoDia));
router.get('/sugestao-periodo', asyncHandler(acumuladosController.sugestaoDoPeriodo));
router.post('/lote', asyncHandler(acumuladosController.salvarLote));
router.post('/excluir-lote', asyncHandler(acumuladosController.excluirLote));
router.get('/', asyncHandler(acumuladosController.listar));
router.post('/', asyncHandler(acumuladosController.criar));
router.delete('/:id', asyncHandler(acumuladosController.deletar));

module.exports = router;
