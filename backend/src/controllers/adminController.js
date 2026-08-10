const pool = require('../db/pool');
const { importarDados } = require('../db/importarBackup');
const { registrarAuditoria } = require('../utils/auditoria');

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

// Importa um backup JSON enviado pela tela, sem depender de o arquivo estar no
// disco do servidor — em nuvem o arquivo está no computador do usuário.
//
// Continua idempotente: cada registro carrega o `legado_id` do sistema antigo,
// então reimportar um backup mais novo atualiza no lugar em vez de duplicar.
// Isso é o que permite conviver com o sistema antigo durante a validação.
async function importarBackupEnviado(req, res) {
  const dryRun = req.query.dry_run === 'true' || req.query['dry-run'] === 'true';

  // O corpo pode vir como o backup inteiro, ou embrulhado em { backup: ... }.
  const backup = req.body && req.body.backup ? req.body.backup : req.body;

  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return res.status(400).json({ error: 'Envie o conteúdo do arquivo de backup em JSON.' });
  }

  const colecoesConhecidas = [
    'contas', 'fornecedores', 'fixas', 'impostos', 'despesas', 'clientes',
    'funcionarios', 'bancos', 'movPrazo', 'folha', 'extras', 'acumulados', 'conciliacoes',
  ];
  if (!colecoesConhecidas.some((c) => backup[c] !== undefined)) {
    return res.status(400).json({
      error: 'Este arquivo não parece um backup do Mercado Favalessa — nenhuma coleção conhecida foi encontrada.',
    });
  }

  let resumo;
  try {
    resumo = await importarDados(backup, { dryRun });
  } catch (err) {
    return res.status(400).json({ error: `Falha ao importar: ${err.message}` });
  }

  if (!dryRun) {
    await registrarAuditoria({
      usuarioId: req.user.id,
      acao: 'importacao',
      entidade: 'backup',
      entidadeId: 0,
      dados: resumo,
    });
  }

  return res.json({ dry_run: dryRun, resumo });
}

module.exports = { auditoria, exportarBackup, importarBackupEnviado };
