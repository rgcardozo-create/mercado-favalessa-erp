const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Cadastros simples (clientes, funcionários, bancos) compartilham a mesma forma,
// então são gerados a partir de uma descrição em vez de três controllers iguais.
const ENTIDADES = {
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
};

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

    const valores = campos.map((c) => (req.body[c] === undefined ? null : req.body[c]));
    const marcadores = campos.map((_, i) => `$${i + 1}`).join(', ');

    const { rows } = await pool.query(
      `INSERT INTO ${tabela} (${campos.join(', ')}) VALUES (${marcadores}) RETURNING *`,
      valores
    );

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

    const { rows } = await pool.query(
      `UPDATE ${tabela} SET ${sets} WHERE id = $${campos.length + 1} RETURNING *`,
      [...valores, id]
    );

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
    const { rows } = await pool.query(`DELETE FROM ${tabela} WHERE id = $1 RETURNING id`, [id]);

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
