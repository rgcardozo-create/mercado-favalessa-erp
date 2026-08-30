const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { telasDoUsuario } = require('../db/telas');

async function login(req, res) {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ error: 'Informe email e senha.' });
  }

  const { rows } = await pool.query(
    'SELECT id, nome, email, senha_hash, role::text AS role, ativo, telas FROM usuarios WHERE email = $1',
    [email]
  );
  const usuario = rows[0];

  // Mesma mensagem para usuário inexistente ou senha errada (evita enumeração de emails).
  if (!usuario || !usuario.ativo) {
    return res.status(401).json({ error: 'Email ou senha inválidos.' });
  }

  const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaOk) {
    return res.status(401).json({ error: 'Email ou senha inválidos.' });
  }

  const token = jwt.sign(
    { sub: usuario.id, role: usuario.role, nome: usuario.nome },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  return res.json({
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      role: usuario.role,
      telas: telasDoUsuario(usuario),
    },
  });
}

async function me(req, res) {
  const { id, nome, email, role } = req.user;
  return res.json({ usuario: { id, nome, email, role, telas: telasDoUsuario(req.user) } });
}

module.exports = { login, me };
