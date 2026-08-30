const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, exigirTela } = require('../middleware/auth');
const { criarHandlers, ENTIDADES } = require('../controllers/cadastrosController');

const router = express.Router();

router.use(authenticate);

// Banco e forma de pagamento não são só cadastro: toda baixa escolhe um dos dois.
// Quem tem Painel ou Contas precisa da lista para dar baixa, mesmo sem a aba
// Cadastros — sem isso a tela liberada abriria quebrada. Ler a lista é o que se
// abre; criar, editar e excluir seguem na aba Cadastros.
const LISTAS_DA_BAIXA = ['bancos', 'formas-pagamento'];
const podeLerLista = (chave) =>
  LISTAS_DA_BAIXA.includes(chave)
    ? exigirTela('cadastros', 'painel', 'contas', 'venda-prazo')
    : exigirTela('cadastros');

// Cadastros estão na lista de acesso da Gerente, e o login "Loja" tem o mesmo
// nível dela por padrão. Excluir é a única ação restrita, para um cadastro não
// sumir por engano junto com o histórico que aponta para ele.
for (const chave of Object.keys(ENTIDADES)) {
  const h = criarHandlers(chave);
  router.get(`/${chave}`, podeLerLista(chave), asyncHandler(h.listar));
  router.post(`/${chave}`, exigirTela('cadastros'), asyncHandler(h.criar));
  router.put(`/${chave}/:id`, exigirTela('cadastros'), asyncHandler(h.atualizar));
  router.delete(
    `/${chave}/:id`,
    exigirTela('cadastros'),
    authorize('master', 'gerente'),
    asyncHandler(h.deletar)
  );
}

module.exports = router;
