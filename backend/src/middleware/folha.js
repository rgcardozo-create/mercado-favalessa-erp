const jwt = require('jsonwebtoken');

// A Folha é Master-only. Para quem não é master ela nem existe como tela, e a
// senha adicional continua valendo — o token dela é curto e separado do token de
// sessão, então fechar e reabrir o sistema tranca de novo.
//
// O Master entra direto, a pedido do dono: era ele mesmo digitando a própria
// senha duas vezes por dia. O que se perde com isso é a proteção contra o
// aparelho dele ficar aberto no balcão — a partir daqui, sessão de Master aberta
// é salário à vista.
const FOLHA_ESCOPO = 'folha';

function assinarTokenFolha(usuarioId) {
  return jwt.sign({ sub: usuarioId, escopo: FOLHA_ESCOPO }, process.env.JWT_SECRET, {
    expiresIn: process.env.FOLHA_TOKEN_EXPIRES_IN || '30m',
  });
}

// Não bloqueia: só marca se a folha está destravada nesta requisição. Usado pelos
// relatórios, que mostram a folha como linha genérica quando ela está trancada.
function detectarFolhaDestravada(req, res, next) {
  const token = req.headers['x-folha-token'];
  req.folhaDestravada = req.user ? req.user.role === 'master' : false;

  if (!req.folhaDestravada && token && req.user) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.folhaDestravada = payload.escopo === FOLHA_ESCOPO && String(payload.sub) === String(req.user.id);
    } catch {
      req.folhaDestravada = false;
    }
  }

  return next();
}

function exigirFolhaDestravada(req, res, next) {
  if (!req.folhaDestravada) {
    return res.status(423).json({
      error: 'Folha trancada. Informe a senha da folha para destravar.',
      folha_trancada: true,
    });
  }
  return next();
}

module.exports = { assinarTokenFolha, detectarFolhaDestravada, exigirFolhaDestravada };
