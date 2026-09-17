const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { telasDoUsuario } = require('../db/telas');

// E-mail não diferencia maiúscula de minúscula, e o cadastro já guarda tudo em
// minúsculas. O login precisa comparar do mesmo jeito, senão quem digita
// "Marta@..." nunca entra numa conta salva como "marta@...".
//
// Isso não é hipótese: o teclado do celular capitaliza a primeira letra sozinho.
// E o pior é que a recusa vem como "Email ou senha inválidos" — a pessoa jura
// que a senha está certa, e está mesmo. O espaço que o toque no campo às vezes
// deixa no fim dava exatamente o mesmo resultado.
const normalizarEmail = (valor) => String(valor || '').trim().toLowerCase();

async function login(req, res) {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ error: 'Informe email e senha.' });
  }

  // lower() dos dois lados: pega também os acessos antigos que porventura
  // tenham sido gravados com maiúscula antes desta correção.
  const { rows } = await pool.query(
    `SELECT id, nome, email, senha_hash, role::text AS role, ativo, telas
       FROM usuarios WHERE lower(email) = $1 ORDER BY id`,
    [normalizarEmail(email)]
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
