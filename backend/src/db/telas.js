// As telas do sistema, na ordem em que aparecem na barra de navegação.
//
// Esta lista é a fonte única: o backend usa para validar o que foi marcado e para
// barrar rota de tela não liberada, e o frontend usa para montar as caixas de
// marcação da Administração. Tela nova entra aqui e aparece nos dois lugares.
//
// `soMaster` marca o que não se concede a ninguém: a Folha tem salário e a
// Administração cria usuários. Nenhuma caixa de marcação libera essas duas —
// quem não é master não as enxerga nem alcança.
const TELAS = [
  { chave: 'painel', rotulo: 'Painel do dia' },
  { chave: 'contas', rotulo: 'Contas a pagar' },
  { chave: 'venda-prazo', rotulo: 'Venda a prazo' },
  { chave: 'conciliacao', rotulo: 'Conciliação' },
  { chave: 'acumulado', rotulo: 'Acumulado' },
  { chave: 'cadastros', rotulo: 'Cadastros' },
  { chave: 'gerencial', rotulo: 'Gerencial' },
  { chave: 'relatorios', rotulo: 'Relatórios' },
  { chave: 'folha', rotulo: 'Folha', soMaster: true },
  { chave: 'admin', rotulo: 'Administração', soMaster: true },
];

const CHAVES_CONCEDIVEIS = TELAS.filter((t) => !t.soMaster).map((t) => t.chave);

// Master vê tudo e não depende da lista: ele é o dono do sistema e tirar uma tela
// dele só criaria a chance de alguém se trancar para fora.
function telasDoUsuario(usuario) {
  if (!usuario) return [];
  if (usuario.role === 'master') return TELAS.map((t) => t.chave);
  return (usuario.telas || []).filter((c) => CHAVES_CONCEDIVEIS.includes(c));
}

function podeVerTela(usuario, chave) {
  return telasDoUsuario(usuario).includes(chave);
}

// Só guarda chave conhecida e concedível: lixo no corpo da requisição não vira
// permissão, e "folha" mandada na mão não libera folha nenhuma.
function limparTelas(lista) {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map(String))].filter((c) => CHAVES_CONCEDIVEIS.includes(c));
}

module.exports = { TELAS, CHAVES_CONCEDIVEIS, telasDoUsuario, podeVerTela, limparTelas };
