const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Cadastros simples (clientes, funcionários, bancos, formas de pagamento)
// compartilham a mesma forma, então são gerados a partir de uma descrição em vez
// de quatro controllers iguais.
const ENTIDADES = {
  fornecedores: {
    tabela: 'fornecedores',
    campos: ['nome', 'cnpj_cpf', 'telefone', 'pix', 'observacoes', 'ceasa'],
    ordem: 'nome',
  },
  clientes: {
    tabela: 'clientes',
    campos: ['codigo', 'nome', 'telefone', 'cpf_cnpj', 'observacoes'],
    ordem: 'nome',
  },
  funcionarios: {
    tabela: 'funcionarios',
    campos: ['codigo', 'nome', 'telefone', 'cpf', 'pix', 'observacoes', 'ativo'],
    ordem: 'nome',
  },
  bancos: {
    tabela: 'bancos',
    campos: ['nome', 'padrao'],
    ordem: 'nome',
  },
  'formas-pagamento': {
    tabela: 'formas_pagamento',
    campos: ['nome', 'padrao'],
    ordem: 'nome',
  },
};

// Nome repetido é erro de digitação, não falha do servidor: o banco recusa pelo
// índice único e aqui isso vira uma mensagem que o usuário entende.
function ehNomeRepetido(err) {
  return err && err.code === '23505';
}

// Cadastro apontado por lançamento não pode sumir: o histórico ficaria órfão. O
// banco recusa pela chave estrangeira, e aqui isso vira uma explicação em vez de
// um erro 500 sem sentido.
function estaEmUso(err) {
  return err && err.code === '23503';
}

function criarHandlers(chave) {
  const { tabela, campos, ordem } = ENTIDADES[chave];

  async function listar(req, res) {
    const { rows } = await pool.query(`SELECT * FROM ${tabela} ORDER BY ${ordem}`);
    return res.json(rows);
  }

  async function criar(req, res) {
    if (!req.body.nome) {
      return res.status(400).json({ error: 'nome é obrigatório.' });
    }

    // Só entram as colunas que vieram no formulário: mandar null no que não veio
    // atropelaria os defaults do banco (`padrao` e `ativo` são NOT NULL).
    const usados = campos.filter((c) => req.body[c] !== undefined);
    const valores = usados.map((c) => (req.body[c] === '' ? null : req.body[c]));
    const marcadores = usados.map((_, i) => `$${i + 1}`).join(', ');

    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO ${tabela} (${usados.join(', ')}) VALUES (${marcadores}) RETURNING *`,
        valores
      ));
    } catch (err) {
      if (ehNomeRepetido(err)) {
        return res.status(409).json({ error: `Já existe um cadastro com o nome "${req.body.nome}".` });
      }
      throw err;
    }

    await registrarAuditoria({
      usuarioId: req.user.id,
      acao: 'create',
      entidade: tabela,
      entidadeId: rows[0].id,
      dados: rows[0],
    });

    return res.status(201).json(rows[0]);
  }

  async function atualizar(req, res) {
    const { id } = req.params;
    const valores = campos.map((c) => (req.body[c] === undefined ? null : req.body[c]));
    const sets = campos.map((c, i) => `${c} = COALESCE($${i + 1}, ${c})`).join(', ');

    let rows;
    try {
      ({ rows } = await pool.query(
        `UPDATE ${tabela} SET ${sets} WHERE id = $${campos.length + 1} RETURNING *`,
        [...valores, id]
      ));
    } catch (err) {
      if (ehNomeRepetido(err)) {
        return res.status(409).json({ error: `Já existe um cadastro com o nome "${req.body.nome}".` });
      }
      throw err;
    }

    if (!rows[0]) {
      return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    await registrarAuditoria({
      usuarioId: req.user.id,
      acao: 'update',
      entidade: tabela,
      entidadeId: rows[0].id,
      dados: rows[0],
    });

    return res.json(rows[0]);
  }

  async function deletar(req, res) {
    const { id } = req.params;

    let rows;
    try {
      ({ rows } = await pool.query(`DELETE FROM ${tabela} WHERE id = $1 RETURNING id`, [id]));
    } catch (err) {
      if (estaEmUso(err)) {
        return res.status(409).json({
          error: 'Este cadastro tem lançamentos ligados a ele e por isso não pode ser excluído.',
        });
      }
      throw err;
    }

    if (!rows[0]) {
      return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    await registrarAuditoria({
      usuarioId: req.user.id,
      acao: 'delete',
      entidade: tabela,
      entidadeId: Number(id),
    });

    return res.status(204).send();
  }

  return { listar, criar, atualizar, deletar };
}

module.exports = { criarHandlers, ENTIDADES };
