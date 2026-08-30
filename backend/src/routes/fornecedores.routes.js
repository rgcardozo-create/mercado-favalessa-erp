const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const fornecedoresController = require('../controllers/fornecedoresController');

const router = express.Router();

router.use(authenticate);
router.use(exigirTela('contas', 'cadastros'));

router.get('/', asyncHandler(fornecedoresController.listar));
router.post('/', authorize('master', 'gerente', 'loja'), asyncHandler(fornecedoresController.criar));

module.exports = router;
