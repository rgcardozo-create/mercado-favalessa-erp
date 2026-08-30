const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const contasController = require('../controllers/contasController');

const router = express.Router();

router.use(authenticate);
router.use(exigirTela('contas'));

// Cadastro de boleto: qualquer perfil autenticado pode cadastrar (Master, Gerente ou Loja).
router.get('/', asyncHandler(contasController.listar));
router.get('/:id', asyncHandler(contasController.obter));
router.post('/', authorize('master', 'gerente', 'loja'), asyncHandler(contasController.criar));
// Antes do /:id para "mover" não ser lido como id de conta.
router.post('/mover', authorize('master', 'gerente'), asyncHandler(contasController.mover));
router.post('/:id/atencao', authorize('master', 'gerente', 'loja'), asyncHandler(contasController.marcarAtencao));

// Edição, exclusão e pagamento (baixa) exigem permissão de Master ou Gerente.
// Ajustável: ver "itens em aberto" no SPEC.md sobre o nível de acesso exato do login Loja.
router.put('/:id', authorize('master', 'gerente'), asyncHandler(contasController.atualizar));
router.delete('/:id', authorize('master', 'gerente'), asyncHandler(contasController.deletar));
router.post(
  '/:id/pagamentos',
  authorize('master', 'gerente'),
  asyncHandler(contasController.registrarPagamento)
);
router.put(
  '/:id/pagamentos/:pagamentoId',
  authorize('master', 'gerente'),
  asyncHandler(contasController.atualizarPagamento)
);
router.delete(
  '/:id/pagamentos/:pagamentoId',
  authorize('master', 'gerente'),
  asyncHandler(contasController.excluirPagamento)
);

module.exports = router;
