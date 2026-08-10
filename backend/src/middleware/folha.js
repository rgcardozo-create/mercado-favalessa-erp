const jwt = require('jsonwebtoken');

// A Folha é Master-only e ainda fica atrás de uma senha adicional, como já era no
// sistema atual. Destravar emite um token curto e separado do token de sessão —
// assim fechar/reabrir o sistema volta a trancar a folha, e um token de sessão
// vazado não dá acesso aos salários.
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
  req.folhaDestravada = false;

  if (token && req.user) {
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
