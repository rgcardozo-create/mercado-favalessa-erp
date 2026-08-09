const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { detectarFolhaDestravada, exigirFolhaDestravada } = require('../middleware/folha');
const folha = require('../controllers/folhaController');
const extras = require('../controllers/extrasController');

const router = express.Router();

// Folha e Extras: Master apenas, e ainda por trás da senha adicional da folha
// (SPEC.md, seção 3). Duas camadas — perfil e senha — como já era no sistema atual.
router.use(authenticate, authorize('master'), detectarFolhaDestravada);

// Único endpoint que não exige a folha já destravada: é ele que destrava.
router.post('/desbloquear', asyncHandler(folha.desbloquear));

router.use(exigirFolhaDestravada);

// Extras vêm antes das rotas com `:id` para nenhum caminho literal ser
// confundido com um id.
router.get('/extras', asyncHandler(extras.listar));
router.post('/extras', asyncHandler(extras.criar));
router.post('/extras/:id/baixas', asyncHandler(extras.registrarBaixa));
router.delete('/extras/:id', asyncHandler(extras.deletar));

router.get('/', asyncHandler(folha.listar));
router.post('/', asyncHandler(folha.criar));
router.post('/:id/pagamentos', asyncHandler(folha.registrarPagamento));
router.delete('/:id', asyncHandler(folha.deletar));

module.exports = router;
