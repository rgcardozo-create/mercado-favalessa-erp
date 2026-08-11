const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');

// Prepara o banco no boot do servidor.
//
// Em PaaS (Railway) não há terminal para rodar migração à mão, então o próprio
// serviço se encarrega disso ao subir. É seguro repetir: o schema usa
// CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, e os usuários entram
// com ON CONFLICT DO UPDATE.

async function aplicarSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// Usuários e senha da Folha vêm das variáveis de ambiente. Rodar a cada boot
// significa que trocar a senha no painel do Railway e reiniciar é o caminho
// para redefinir um acesso — hoje não há troca de senha pela interface.
async function semearUsuarios() {
  const usuarios = [
    { nome: 'Raphael (Master)', email: process.env.SEED_MASTER_EMAIL || 'master@mercadofavalessa.local', senha: process.env.SEED_MASTER_SENHA, role: 'master' },
    { nome: 'Gerente', email: process.env.SEED_GERENTE_EMAIL || 'gerente@mercadofavalessa.local', senha: process.env.SEED_GERENTE_SENHA, role: 'gerente' },
    { nome: 'Loja', email: process.env.SEED_LOJA_EMAIL || 'loja@mercadofavalessa.local', senha: process.env.SEED_LOJA_SENHA, role: 'loja' },
  ];

  const criados = [];
  for (const u of usuarios) {
    if (!u.senha) continue; // sem senha definida, não cria o acesso
    const hash = await bcrypt.hash(u.senha, 12);
    await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, role = EXCLUDED.role`,
      [u.nome, u.email, hash, u.role]
    );
    criados.push(u.role);
  }

  if (process.env.FOLHA_SENHA) {
    const hash = await bcrypt.hash(process.env.FOLHA_SENHA, 12);
    await pool.query(
      `INSERT INTO configuracoes (chave, valor) VALUES ('folha_senha_hash', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [hash]
    );
  }

  return criados;
}

async function prepararBanco() {
  await aplicarSchema();
  console.log('Banco: schema aplicado.');

  const criados = await semearUsuarios();
  if (criados.length) {
    console.log(`Banco: acessos configurados (${criados.join(', ')}).`);
  } else {
    console.warn(
      'ATENÇÃO: nenhuma senha de usuário definida — configure SEED_MASTER_SENHA, ' +
        'SEED_GERENTE_SENHA e SEED_LOJA_SENHA para conseguir entrar no sistema.'
    );
  }

  if (!process.env.FOLHA_SENHA) {
    console.warn('ATENÇÃO: FOLHA_SENHA não definida — a tela de Folha ficará inacessível.');
  }
}

module.exports = { prepararBanco };
