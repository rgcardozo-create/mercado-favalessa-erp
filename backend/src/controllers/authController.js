const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

async function login(req, res) {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ error: 'Informe email e senha.' });
  }

  const { rows } = await pool.query(
    'SELECT id, nome, senha_hash, role, ativo FROM usuarios WHERE email = $1',
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
    usuario: { id: usuario.id, nome: usuario.nome, role: usuario.role },
  });
}

async function me(req, res) {
  return res.json({ usuario: req.user });
}

module.exports = { login, me };
