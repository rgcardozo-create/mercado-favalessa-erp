const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { podeVerTela } = require('../db/telas');

// O token só diz quem é a pessoa; perfil, telas e se ela ainda está ativa vêm do
// banco a cada requisição. Guardar isso dentro do token pareceria mais barato,
// mas aí tirar o acesso de alguém só valeria quando o token dele expirasse — e
// quem tira acesso de um funcionário quer que valha agora.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  let usuario;
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, email, role::text AS role, ativo, telas FROM usuarios WHERE id = $1',
      [payload.sub]
    );
    usuario = rows[0];
  } catch (err) {
    return next(err);
  }

  if (!usuario || !usuario.ativo) {
    return res.status(401).json({ error: 'Acesso encerrado. Entre de novo.' });
  }

  req.user = usuario;
  return next();
}

// Esconder a aba não é proteção: sem esta verificação, quem souber o endereço da
// rota chega ao dado igual. A tela some no frontend por conforto; quem barra é
// esta função.
function exigirTela(...chaves) {
  return (req, res, next) => {
    if (chaves.some((c) => podeVerTela(req.user, c))) return next();
    return res.status(403).json({ error: 'Você não tem acesso a esta parte do sistema.' });
  };
}

// A regra de permissão precisa ser checada aqui no backend — nunca só esconder botão no frontend.
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }
    return next();
  };
}

module.exports = { authenticate, authorize, exigirTela };
