const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const contasController = require('../controllers/contasController');

const router = express.Router();

router.use(authenticate);

// Cadastro de boleto: qualquer perfil autenticado pode cadastrar (Master, Gerente ou Loja).
router.get('/', asyncHandler(contasController.listar));
router.get('/:id', asyncHandler(contasController.obter));
router.post('/', authorize('master', 'gerente', 'loja'), asyncHandler(contasController.criar));

// Edição, exclusão e pagamento (baixa) exigem permissão de Master ou Gerente.
// Ajustável: ver "itens em aberto" no SPEC.md sobre o nível de acesso exato do login Loja.
router.put('/:id', authorize('master', 'gerente'), asyncHandler(contasController.atualizar));
router.delete('/:id', authorize('master', 'gerente'), asyncHandler(contasController.deletar));
router.post(
  '/:id/pagamentos',
  authorize('master', 'gerente'),
  asyncHandler(contasController.registrarPagamento)
);

module.exports = router;
