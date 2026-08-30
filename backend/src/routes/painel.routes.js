const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const { painelDoDia } = require('../controllers/painelController');

const router = express.Router();

// Painel do dia é só para Master e Gerente — não entra no login "Loja" (SPEC.md, Fase 1).
router.get('/', authenticate, authorize('master', 'gerente'), exigirTela('painel'), asyncHandler(painelDoDia));

module.exports = router;
