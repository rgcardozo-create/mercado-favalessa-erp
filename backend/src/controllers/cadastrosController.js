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
    campos: ['codigo', 'nome', 'telefone', 'cpf', 'pix', 'salario_base', 'data_admissao', 'observacoes', 'ativo'],
    datas: ['data_admissao'],
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

// Coluna DATE vira Date do JavaScript e sai como instante UTC, escorregando um
// dia conforme o fuso — a mesma armadilha que já apareceu na folha. O driver
// monta a data à meia-noite LOCAL, então ler dia, mês e ano dela devolve o que
// está gravado, sem passar por UTC.
function comoTexto(d) {
  if (!(d instanceof Date)) return d;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function criarHandlers(chave) {
  const { tabela, campos, ordem, datas = [] } = ENTIDADES[chave];

  const arrumarDatas = (linha) => {
    if (!linha || !datas.length) return linha;
    const copia = { ...linha };
    for (const campo of datas) copia[campo] = comoTexto(copia[campo]);
    return copia;
  };

  async function listar(req, res) {
    const { rows } = await pool.query(`SELECT * FROM ${tabela} ORDER BY ${ordem}`);
    return res.json(rows.map(arrumarDatas));
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

    return res.status(201).json(arrumarDatas(rows[0]));
  }

  // Só mexe no que veio no corpo. Campo ausente fica como está; campo que veio
  // vazio VIRA VAZIO — antes um COALESCE mantinha o valor antigo, então limpar um
  // telefone digitado errado era impossível: a tela dizia que salvou e o dado
  // continuava lá.
  async function atualizar(req, res) {
    const { id } = req.params;
    const usados = campos.filter((c) => req.body[c] !== undefined);
    if (!usados.length) {
      return res.status(400).json({ error: 'Nada para alterar.' });
    }

    const valores = usados.map((c) => (req.body[c] === '' ? null : req.body[c]));
    const sets = usados.map((c, i) => `${c} = $${i + 1}`).join(', ');

    let rows;
    try {
      ({ rows } = await pool.query(
        `UPDATE ${tabela} SET ${sets} WHERE id = $${usados.length + 1} RETURNING *`,
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

    return res.json(arrumarDatas(rows[0]));
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
