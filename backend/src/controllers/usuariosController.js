const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');
const { TELAS, limparTelas, telasDoUsuario } = require('../db/telas');

// Cadastro de quem entra no sistema. Só o Master mexe aqui — quem cria usuário
// pode criar um para si mesmo com acesso a tudo, então esta tela é a chave da
// casa.
//
// A senha nunca sai daqui: nem na listagem, nem na edição. Trocar senha é mandar
// uma nova, nunca ler a antiga.
const PERFIS = ['master', 'gerente', 'loja'];
const SENHA_MINIMA = 8;

const SELECT_USUARIOS = `
  SELECT id, nome, email, role::text AS role, ativo, telas, criado_em
    FROM usuarios`;

async function listar(req, res) {
  const { rows } = await pool.query(`${SELECT_USUARIOS} ORDER BY nome`);
  return res.json({
    usuarios: rows.map((u) => ({ ...u, telas: telasDoUsuario(u) })),
    telas_disponiveis: TELAS,
  });
}

function validar({ nome, email, role, senha, novo }) {
  if (!nome || !String(nome).trim()) return 'Informe o nome.';
  if (!email || !String(email).includes('@')) return 'Informe um e-mail válido.';
  if (!PERFIS.includes(role)) return `Perfil inválido. Use um de: ${PERFIS.join(', ')}.`;
  if (novo && !senha) return 'Informe a senha do primeiro acesso.';
  if (senha && String(senha).length < SENHA_MINIMA) {
    return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  return null;
}

function ehEmailRepetido(err) {
  return err && err.code === '23505';
}

async function criar(req, res) {
  const { nome, email, role, senha } = req.body;

  const erro = validar({ nome, email, role, senha, novo: true });
  if (erro) return res.status(400).json({ error: erro });

  const hash = await bcrypt.hash(String(senha), 12);
  const telas = limparTelas(req.body.telas);

  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role, telas, ativo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, nome, email, role::text AS role, ativo, telas`,
      [String(nome).trim(), String(email).trim().toLowerCase(), hash, role, telas]
    ));
  } catch (err) {
    if (ehEmailRepetido(err)) {
      return res.status(409).json({ error: `Já existe um acesso com o e-mail ${email}.` });
    }
    throw err;
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'create',
    entidade: 'usuarios',
    entidadeId: rows[0].id,
    // A senha (nem o hash) entra na auditoria.
    dados: { nome: rows[0].nome, email: rows[0].email, role: rows[0].role, telas },
  });

  return res.status(201).json({ ...rows[0], telas: telasDoUsuario(rows[0]) });
}

async function atualizar(req, res) {
  const id = Number(req.params.id);
  const { rows: atuais } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
  const atual = atuais[0];
  if (!atual) return res.status(404).json({ error: 'Acesso não encontrado.' });

  const nome = req.body.nome ?? atual.nome;
  const email = req.body.email ?? atual.email;
  const role = req.body.role ?? atual.role;
  const { senha } = req.body;

  const erro = validar({ nome, email, role, senha, novo: false });
  if (erro) return res.status(400).json({ error: erro });

  const ativo = req.body.ativo === undefined ? atual.ativo : req.body.ativo !== false;
  const telas = req.body.telas === undefined ? atual.telas : limparTelas(req.body.telas);

  // Um sistema sem master é um sistema onde ninguém mais cria usuário: a porta
  // fecha por dentro e só quem tem o banco na mão reabre.
  const virouOutroPerfil = atual.role === 'master' && role !== 'master';
  const foiDesativado = atual.role === 'master' && !ativo;
  if (virouOutroPerfil || foiDesativado) {
    const { rows: sobram } = await pool.query(
      "SELECT count(*)::int AS n FROM usuarios WHERE role = 'master' AND ativo AND id <> $1",
      [id]
    );
    if (!sobram[0].n) {
      return res.status(400).json({
        error: 'Este é o único acesso Master ativo. Crie outro antes de mudar o perfil ou desativar este.',
      });
    }
  }

  const hash = senha ? await bcrypt.hash(String(senha), 12) : null;

  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE usuarios
          SET nome = $2, email = $3, role = $4, telas = $5, ativo = $6,
              senha_hash = COALESCE($7, senha_hash)
        WHERE id = $1
        RETURNING id, nome, email, role::text AS role, ativo, telas`,
      [id, String(nome).trim(), String(email).trim().toLowerCase(), role, telas, ativo, hash]
    ));
  } catch (err) {
    if (ehEmailRepetido(err)) {
      return res.status(409).json({ error: `Já existe um acesso com o e-mail ${email}.` });
    }
    throw err;
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: senha ? 'update-senha' : 'update',
    entidade: 'usuarios',
    entidadeId: id,
    dados: { nome: rows[0].nome, email: rows[0].email, role: rows[0].role, ativo, telas },
  });

  return res.json({ ...rows[0], telas: telasDoUsuario(rows[0]) });
}

async function deletar(req, res) {
  const id = Number(req.params.id);

  if (id === Number(req.user.id)) {
    return res.status(400).json({ error: 'Você não pode excluir o próprio acesso.' });
  }

  const { rows: alvo } = await pool.query("SELECT role::text AS role FROM usuarios WHERE id = $1", [id]);
  if (!alvo[0]) return res.status(404).json({ error: 'Acesso não encontrado.' });

  if (alvo[0].role === 'master') {
    const { rows: sobram } = await pool.query(
      "SELECT count(*)::int AS n FROM usuarios WHERE role = 'master' AND ativo AND id <> $1",
      [id]
    );
    if (!sobram[0].n) {
      return res.status(400).json({ error: 'Este é o único acesso Master. Crie outro antes de excluí-lo.' });
    }
  }

  // Lançamento guarda quem cadastrou e quem pagou. Excluir o usuário arrastaria
  // esse registro junto ou deixaria a referência solta — desativar preserva o
  // histórico e tira o acesso do mesmo jeito.
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
  } catch (err) {
    if (err && err.code === '23503') {
      return res.status(409).json({
        error: 'Este acesso tem lançamentos no histórico e não pode ser excluído. Desative-o.',
      });
    }
    throw err;
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'delete',
    entidade: 'usuarios',
    entidadeId: id,
  });

  return res.status(204).send();
}

module.exports = { listar, criar, atualizar, deletar };
