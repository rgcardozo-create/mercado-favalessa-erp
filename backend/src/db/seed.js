require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

// Usuários iniciais dos 3 perfis. Senhas vêm de env vars — nunca hardcoded.
// Ajuste as senhas via variáveis de ambiente antes de rodar em produção.
const USUARIOS_INICIAIS = [
  {
    nome: 'Raphael (Master)',
    email: process.env.SEED_MASTER_EMAIL || 'master@mercadofavalessa.local',
    senha: process.env.SEED_MASTER_SENHA,
    role: 'master',
  },
  {
    nome: 'Gerente',
    email: process.env.SEED_GERENTE_EMAIL || 'gerente@mercadofavalessa.local',
    senha: process.env.SEED_GERENTE_SENHA,
    role: 'gerente',
  },
  {
    nome: 'Loja',
    email: process.env.SEED_LOJA_EMAIL || 'loja@mercadofavalessa.local',
    senha: process.env.SEED_LOJA_SENHA,
    role: 'loja',
  },
];

async function seed() {
  for (const u of USUARIOS_INICIAIS) {
    if (!u.senha) {
      throw new Error(
        `Defina a senha inicial para ${u.email} via variável de ambiente (ex: SEED_${u.role.toUpperCase()}_SENHA).`
      );
    }
    const senha_hash = await bcrypt.hash(u.senha, 12);
    await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, role = EXCLUDED.role`,
      [u.nome, u.email, senha_hash, u.role]
    );
    console.log(`Usuário ${u.email} (${u.role}) criado/atualizado.`);
  }

  // Senha adicional da Folha (segunda camada, além do perfil Master).
  if (process.env.FOLHA_SENHA) {
    const hash = await bcrypt.hash(process.env.FOLHA_SENHA, 12);
    await pool.query(
      `INSERT INTO configuracoes (chave, valor) VALUES ('folha_senha_hash', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [hash]
    );
    console.log('Senha da Folha configurada.');
  } else {
    console.log('FOLHA_SENHA não definida — a tela de Folha ficará inacessível até configurá-la.');
  }

  await pool.end();
}

seed().catch((err) => {
  console.error('Falha no seed:', err.message);
  process.exit(1);
});
