const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const { detectarFolhaDestravada } = require('../middleware/folha');
const { consolidado, gerencial } = require('../controllers/relatoriosController');

const router = express.Router();

// Relatórios estão na lista de acesso da Gerente. Não exigimos a folha destravada:
// sem ela o relatório continua somando o valor da folha, mas como linha genérica,
// sem nome de funcionário (SPEC.md, regra 2).
router.use(authenticate, authorize('master', 'gerente'), detectarFolhaDestravada);

// As duas telas são separadas na navegação, então a permissão também é: quem só
// tem Gerencial não alcança o relatório do período por endereço.
router.get('/gerencial', exigirTela('gerencial'), asyncHandler(gerencial));
router.get('/', exigirTela('relatorios'), asyncHandler(consolidado));

module.exports = router;
