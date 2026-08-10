const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { detectarFolhaDestravada } = require('../middleware/folha');
const { consolidado } = require('../controllers/relatoriosController');

const router = express.Router();

// Relatórios estão na lista de acesso da Gerente. Não exigimos a folha destravada:
// sem ela o relatório continua somando o valor da folha, mas como linha genérica,
// sem nome de funcionário (SPEC.md, regra 2).
router.use(authenticate, authorize('master', 'gerente'), detectarFolhaDestravada);

router.get('/', asyncHandler(consolidado));

module.exports = router;
