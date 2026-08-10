const pool = require('../db/pool');

// Trilha de auditoria: quem cadastrou/editou/pagou o quê e quando. Não existia
// necessidade disso na versão single-user; com três pessoas mexendo no mesmo
// sistema, passa a ser o que permite reconstruir o que aconteceu.
async function auditoria(req, res) {
  const { entidade, de, ate } = req.query;
  const limite = Math.min(Number(req.query.limite) || 100, 500);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);

  const params = [];
  const condicoes = [];

  if (entidade) {
    params.push(entidade);
    condicoes.push(`a.entidade = $${params.length}`);
  }
  if (de) {
    params.push(de);
    condicoes.push(`a.criado_em >= $${params.length}`);
  }
  if (ate) {
    params.push(ate);
    condicoes.push(`a.criado_em < ($${params.length}::date + 1)`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const { rows: totalRows } = await pool.query(
    `SELECT count(*)::int AS total FROM auditoria a ${where}`,
    params
  );

  params.push(limite, (pagina - 1) * limite);
  const { rows } = await pool.query(
    `SELECT a.*, u.nome AS usuario_nome, u.role AS usuario_role
       FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${where}
      ORDER BY a.criado_em DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return res.json({
    total: totalRows[0].total,
    pagina,
    limite,
    paginas: Math.ceil(totalRows[0].total / limite) || 1,
    registros: rows,
  });
}

// Exportação de backup: devolve tudo em JSON, para o usuário guardar fora do
// sistema como já fazia com os backups da v3.
//
// A Folha só entra quando ela está destravada. Sem isso, um backup baixado por
// engano exporia salários — a mesma regra que vale nas telas vale aqui.
async function exportarBackup(req, res) {
  const tabelas = [
    'fornecedores', 'contas', 'contas_pagamentos', 'clientes', 'funcionarios',
    'bancos', 'mov_prazo', 'conciliacao_transacoes', 'conciliacao_dinheiro', 'acumulados',
  ];

  const dados = {};
  for (const t of tabelas) {
    const { rows } = await pool.query(`SELECT * FROM ${t}`);
    dados[t] = rows;
  }

  if (req.folhaDestravada) {
    for (const t of ['folha', 'folha_pagamentos', 'extras', 'extras_baixas']) {
      const { rows } = await pool.query(`SELECT * FROM ${t}`);
      dados[t] = rows;
    }
  }

  return res.json({
    meta: {
      sistema: 'Mercado Favalessa ERP',
      gerado_em: new Date().toISOString(),
      gerado_por: req.user.nome,
      folha_incluida: Boolean(req.folhaDestravada),
    },
    dados,
  });
}

module.exports = { auditoria, exportarBackup };
