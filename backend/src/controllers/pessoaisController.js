const pool = require('../db/pool');
const { HOJE_SP } = require('../db/contasQuery');

// Contas pessoais do dono: a conta de luz da casa, a escola, o financiamento.
//
// Nada aqui toca a empresa. A tabela é separada justamente para que nenhum
// relatório, painel ou gerencial consiga alcançar este dinheiro nem por
// descuido — ver o comentário da tabela no schema.sql.
//
// O que esta tela precisa resolver é uma coisa só: não deixar ele esquecer de
// pagar. Por isso ela abre no que está vencido, e não na lista inteira.

// DATE sai como texto. Devolver o objeto Date faz o dia escorregar para trás
// quando o servidor está em UTC e o dono, em São Paulo — já aconteceu.
const SELECT_PESSOAIS = `
  SELECT id, descricao, categoria, valor,
         to_char(vencimento, 'YYYY-MM-DD') AS vencimento,
         to_char(pago_em, 'YYYY-MM-DD') AS pago_em,
         forma_pagamento, observacoes, parcela, total_parcelas,
         (pago_em IS NOT NULL) AS quitado,
         (pago_em IS NULL AND vencimento <= ${HOJE_SP}) AS vencida
    FROM contas_pessoais`;

const STATUS = {
  aberto: 'pago_em IS NULL',
  vencidas: `pago_em IS NULL AND vencimento <= ${HOJE_SP}`,
  a_vencer: `pago_em IS NULL AND vencimento > ${HOJE_SP}`,
  pagas: 'pago_em IS NOT NULL',
};

async function listar(req, res) {
  const filtros = [];
  const params = [];

  if (STATUS[req.query.status]) filtros.push(STATUS[req.query.status]);

  const termo = (req.query.busca || '').trim();
  if (termo) {
    params.push(`%${termo.replace(/([\\%_])/g, '\\$1')}%`);
    filtros.push(`(descricao ILIKE $${params.length} ESCAPE '\\' OR coalesce(categoria, '') ILIKE $${params.length} ESCAPE '\\')`);
  }

  const where = filtros.length ? ` WHERE ${filtros.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `${SELECT_PESSOAIS}${where} ORDER BY pago_em IS NOT NULL, vencimento`,
    params
  );

  // Os totais são desta lista e só dela: é o que ele está vendo na tela.
  const { rows: resumo } = await pool.query(`
    SELECT
      COALESCE(sum(valor) FILTER (WHERE pago_em IS NULL), 0) AS em_aberto,
      COALESCE(sum(valor) FILTER (WHERE pago_em IS NULL AND vencimento <= ${HOJE_SP}), 0) AS vencido,
      COALESCE(count(*) FILTER (WHERE pago_em IS NULL AND vencimento <= ${HOJE_SP}), 0) AS qtd_vencida
    FROM contas_pessoais`);

  return res.json({ contas: rows, totais: resumo[0] });
}

// Aviso do painel: quantas contas pessoais estão vencidas ou vencem hoje.
// Devolve CONTAGEM e nada mais — sem descrição e sem valor. O painel é a tela
// que fica aberta no balcão, e o que ele deve a quem não é da conta de ninguém.
async function pendencias(req, res) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS quantidade
       FROM contas_pessoais
      WHERE pago_em IS NULL AND vencimento <= ${HOJE_SP}`
  );
  return res.json({ quantidade: rows[0].quantidade });
}

function validar(corpo) {
  const descricao = String(corpo.descricao || '').trim();
  if (!descricao) return { erro: 'Descreva a conta.' };

  const valor = Number(corpo.valor);
  if (!Number.isFinite(valor) || valor < 0) return { erro: 'Valor inválido.' };

  const vencimento = String(corpo.vencimento || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return { erro: 'Informe o vencimento.' };

  const parcelas = Number(corpo.parcelas || 1);
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 60) {
    return { erro: 'Parcelas: use um número de 1 a 60.' };
  }

  return {
    descricao,
    categoria: String(corpo.categoria || '').trim() || null,
    valor,
    vencimento,
    observacoes: String(corpo.observacoes || '').trim() || null,
    parcelas,
  };
}

// Vencimento das parcelas: mesmo dia nos meses seguintes. Dia 31 em mês de 30
// cai no último dia, que é como o boleto chega.
async function datasDasParcelas(vencimento, parcelas) {
  const { rows } = await pool.query(
    `SELECT to_char(($1::date + (n || ' month')::interval)::date, 'YYYY-MM-DD') AS data
       FROM generate_series(0, $2::int - 1) AS n`,
    [vencimento, parcelas]
  );
  return rows.map((r) => r.data);
}

async function criar(req, res) {
  const dados = validar(req.body);
  if (dados.erro) return res.status(400).json({ error: dados.erro });

  const datas = await datasDasParcelas(dados.vencimento, dados.parcelas);
  const cliente = await pool.connect();
  let criadas;
  try {
    await cliente.query('BEGIN');
    const saida = [];
    for (let i = 0; i < datas.length; i += 1) {
      const { rows } = await cliente.query(
        `INSERT INTO contas_pessoais
           (descricao, categoria, valor, vencimento, observacoes, parcela, total_parcelas, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          dados.descricao,
          dados.categoria,
          dados.valor,
          datas[i],
          dados.observacoes,
          dados.parcelas > 1 ? i + 1 : null,
          dados.parcelas > 1 ? dados.parcelas : null,
          req.user.id,
        ]
      );
      saida.push(rows[0].id);
    }
    await cliente.query('COMMIT');
    criadas = saida;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }

  return res.status(201).json({ criadas: criadas.length, ids: criadas });
}

async function atualizar(req, res) {
  const dados = validar({ ...req.body, parcelas: 1 });
  if (dados.erro) return res.status(400).json({ error: dados.erro });

  const { rows } = await pool.query(
    `UPDATE contas_pessoais
        SET descricao = $2, categoria = $3, valor = $4, vencimento = $5,
            observacoes = $6, atualizado_em = now()
      WHERE id = $1
      RETURNING id`,
    [req.params.id, dados.descricao, dados.categoria, dados.valor, dados.vencimento, dados.observacoes]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Conta não encontrada.' });
  return res.json({ id: rows[0].id });
}

async function pagar(req, res) {
  const data = String(req.body.pago_em || '').trim();
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ error: 'Data de pagamento inválida.' });
  }

  const { rows } = await pool.query(
    `UPDATE contas_pessoais
        SET pago_em = COALESCE($2::date, ${HOJE_SP}),
            forma_pagamento = $3,
            atualizado_em = now()
      WHERE id = $1
      RETURNING id, to_char(pago_em, 'YYYY-MM-DD') AS pago_em`,
    [req.params.id, data || null, String(req.body.forma_pagamento || '').trim() || null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Conta não encontrada.' });
  return res.json(rows[0]);
}

// Desfazer a baixa: marcou pago por engano e precisa voltar. Sem isto, a saída
// seria excluir e cadastrar de novo — que foi exatamente a reclamação da folha.
async function desfazerPagamento(req, res) {
  const { rows } = await pool.query(
    `UPDATE contas_pessoais SET pago_em = NULL, forma_pagamento = NULL, atualizado_em = now()
      WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Conta não encontrada.' });
  return res.json({ id: rows[0].id });
}

async function deletar(req, res) {
  const { rowCount } = await pool.query('DELETE FROM contas_pessoais WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Conta não encontrada.' });
  return res.status(204).send();
}

module.exports = { listar, pendencias, criar, atualizar, pagar, desfazerPagamento, deletar };
