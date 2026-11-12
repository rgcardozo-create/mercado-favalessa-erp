const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const contasController = require('../controllers/contasController');
const pagamentosBanco = require('../controllers/pagamentosBancoController');

const router = express.Router();

// O PDF do relatório de pagamentos vem em base64 e passa do limite de 1 MB do
// app. Estes caminhos trazem o próprio parser e ficam isentos lá em app.js.
const corpoGrande = express.json({ limit: process.env.LIMITE_IMPORTACAO || '25mb' });
const CAMINHOS_COM_ARQUIVO = ['/pagamentos-banco', '/pagamentos-banco/analisar'];

router.use(authenticate);
router.use(exigirTela('contas'));

// Cadastro de boleto: qualquer perfil autenticado pode cadastrar (Master, Gerente ou Loja).
router.get('/', asyncHandler(contasController.listar));
// Antes do /:id, senão "descricoes" seria lido como id de conta.
router.get('/descricoes', asyncHandler(contasController.descricoesUsuais));
router.get('/boleto', asyncHandler(contasController.lerBoleto));
router.get('/:id', asyncHandler(contasController.obter));
router.post('/', authorize('master', 'gerente', 'loja'), asyncHandler(contasController.criar));
// Antes do /:id para "mover" não ser lido como id de conta.
router.post('/mover', authorize('master', 'gerente'), asyncHandler(contasController.mover));
// Baixa pelo relatório de pagamentos do banco: dá baixa em conta, então fica
// com quem pode dar baixa (Master e Gerente). Antes do /:id pelo mesmo motivo
// do "mover".
router.post('/pagamentos-banco/analisar', authorize('master', 'gerente'), corpoGrande, asyncHandler(pagamentosBanco.analisar));
router.post('/pagamentos-banco', authorize('master', 'gerente'), corpoGrande, asyncHandler(pagamentosBanco.importar));
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

router.caminhosComArquivo = CAMINHOS_COM_ARQUIVO;

module.exports = router;
