const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { criarHandlers, ENTIDADES } = require('../controllers/cadastrosController');

const router = express.Router();

router.use(authenticate);

// Cadastros estão na lista de acesso da Gerente, e o login "Loja" tem o mesmo
// nível dela por padrão. Excluir é a única ação restrita, para um cadastro não
// sumir por engano junto com o histórico que aponta para ele.
for (const chave of Object.keys(ENTIDADES)) {
  const h = criarHandlers(chave);
  router.get(`/${chave}`, asyncHandler(h.listar));
  router.post(`/${chave}`, asyncHandler(h.criar));
  router.put(`/${chave}/:id`, asyncHandler(h.atualizar));
  router.delete(`/${chave}/:id`, authorize('master', 'gerente'), asyncHandler(h.deletar));
}

module.exports = router;
