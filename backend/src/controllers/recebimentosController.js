const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Recebimentos: o destrinchado do que cada adquirente ficou devendo ao dono.
//
// A aba de Taxas responde "quanto custa". Esta responde outra coisa: "o que eu
// vou receber, de quem, e bate com o combinado?". Por isso separa cartões de
// tickets — a Cielo é uma empresa, e VR, Alelo e Comprocard são outras três,
// cada uma com o seu contrato e o seu depósito.

const ADQUIRENTES = ['cielo', 'stone', 'itau', 'tickets'];

// Zero de taxa num cartão quase nunca é taxa zero: é extrato que não trouxe a
// coluna. A regra vale igual aqui e na aba de Taxas — dividir por um bruto que
// inclui essas linhas daria um percentual menor que o real.
const COM_TAXA = 'tarifa <> 0';

const COLUNAS = `
  count(*)::int AS transacoes,
  COALESCE(sum(valor_bruto), 0) AS bruto,
  COALESCE(sum(tarifa), 0) AS tarifa,
  COALESCE(sum(valor_liquido), 0) AS liquido,
  count(*) FILTER (WHERE ${COM_TAXA})::int AS transacoes_com_taxa,
  COALESCE(sum(valor_bruto) FILTER (WHERE ${COM_TAXA}), 0) AS bruto_com_taxa,
  COALESCE(sum(tarifa) FILTER (WHERE ${COM_TAXA}), 0) AS tarifa_com_taxa`;

function periodoValido(de, ate) {
  const f = /^\d{4}-\d{2}-\d{2}$/;
  return f.test(de) && f.test(ate) && de <= ate;
}

const numeros = (l) => ({
  ...l,
  bruto: Number(l.bruto),
  tarifa: Number(l.tarifa),
  liquido: Number(l.liquido),
  bruto_com_taxa: Number(l.bruto_com_taxa),
  tarifa_com_taxa: Number(l.tarifa_com_taxa),
  percentual:
    Number(l.bruto_com_taxa) > 0
      ? Number(((Number(l.tarifa_com_taxa) / Number(l.bruto_com_taxa)) * 100).toFixed(4))
      : null,
});

// A regra mais específica ganha: bandeira+forma bate antes de bandeira sozinha,
// que bate antes da regra geral da adquirente. Sem essa ordem, cadastrar "Cielo
// = 3%" apagaria na prática a regra detalhada do débito.
function taxaCombinada(regras, { adquirente, bandeira, forma }) {
  const candidatas = regras.filter((r) => r.adquirente === adquirente);
  const igual = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

  return (
    candidatas.find((r) => r.bandeira && r.forma && igual(r.bandeira, bandeira) && igual(r.forma, forma)) ||
    candidatas.find((r) => r.bandeira && !r.forma && igual(r.bandeira, bandeira)) ||
    candidatas.find((r) => !r.bandeira && r.forma && igual(r.forma, forma)) ||
    candidatas.find((r) => !r.bandeira && !r.forma) ||
    null
  );
}

// O que a diferença entre combinado e cobrado significa em dinheiro. É o número
// que ele leva para a conversa com a adquirente — "0,3% a mais" não convence
// ninguém; "R$ 412,80 a mais no mês passado" convence.
function compararComCombinado(linha, regras) {
  const regra = taxaCombinada(regras, linha);
  if (!regra || linha.percentual === null) {
    return { ...linha, combinado: regra ? Number(regra.percentual) : null, diferenca_pct: null, diferenca_valor: null };
  }

  const combinado = Number(regra.percentual);
  const esperado = Number(((linha.bruto_com_taxa * combinado) / 100).toFixed(2));
  return {
    ...linha,
    combinado,
    diferenca_pct: Number((linha.percentual - combinado).toFixed(4)),
    // Positivo: pagou mais que o combinado. Negativo: pagou menos.
    diferenca_valor: Number((linha.tarifa_com_taxa - esperado).toFixed(2)),
  };
}

async function lerRegras() {
  const { rows } = await pool.query(
    `SELECT id, adquirente::text AS adquirente, bandeira, forma, percentual, observacoes
       FROM taxas_contratadas ORDER BY adquirente, bandeira NULLS LAST, forma NULLS LAST`
  );
  return rows.map((r) => ({ ...r, percentual: Number(r.percentual) }));
}

async function resumo(req, res) {
  const { de, ate } = req.query;
  if (!periodoValido(de, ate)) {
    return res.status(400).json({ error: 'Informe o período com de e ate (AAAA-MM-DD), com o fim depois do início.' });
  }

  const regras = await lerRegras();

  const [porBandeira, porDia, combinacoes] = await Promise.all([
    pool
      .query(
        `SELECT adquirente::text AS adquirente,
                COALESCE(NULLIF(btrim(bandeira), ''), 'sem bandeira') AS bandeira,
                COALESCE(NULLIF(btrim(forma), ''), 'sem forma') AS forma,
                ${COLUNAS}
           FROM conciliacao_transacoes
          WHERE data BETWEEN $1 AND $2
          GROUP BY 1, 2, 3
          ORDER BY 1, 2, 3`,
        [de, ate]
      )
      .then((r) => r.rows.map(numeros).map((l) => compararComCombinado(l, regras))),

    // O dia a dia é o "ontem você vendeu tanto no Elo". Vem sempre, e a tela
    // decide se mostra tudo ou só um dia.
    pool
      .query(
        `SELECT to_char(data, 'YYYY-MM-DD') AS data,
                adquirente::text AS adquirente,
                COALESCE(NULLIF(btrim(bandeira), ''), 'sem bandeira') AS bandeira,
                COALESCE(NULLIF(btrim(forma), ''), 'sem forma') AS forma,
                ${COLUNAS}
           FROM conciliacao_transacoes
          WHERE data BETWEEN $1 AND $2
          GROUP BY 1, 2, 3, 4
          ORDER BY 1 DESC, 2, 3`,
        [de, ate]
      )
      .then((r) => r.rows.map(numeros).map((l) => compararComCombinado(l, regras))),

    // As combinações que existem de verdade nos extratos dele, do histórico
    // inteiro e não só do período.
    //
    // A tela usa isto para montar as listas de bandeira e forma. Sem elas o
    // campo era texto livre, e digitar "Master" onde o extrato diz "Mastercard"
    // criava uma regra que nunca casava com nada — a taxa ficava sem conferência
    // e a tela não tinha como perceber. Escolher de uma lista tirada do próprio
    // dado acaba com a classe inteira desse erro.
    pool
      .query(
        `SELECT DISTINCT adquirente::text AS adquirente,
                COALESCE(NULLIF(btrim(bandeira), ''), '') AS bandeira,
                COALESCE(NULLIF(btrim(forma), ''), '') AS forma
           FROM conciliacao_transacoes
          ORDER BY 1, 2, 3`
      )
      .then((r) => r.rows),
  ]);

  // Cartões de um lado, tickets do outro. Cada ticket é uma empresa diferente,
  // com contrato e depósito próprios — somar VR com Alelo esconderia justamente
  // a conta que ele precisa fazer com cada uma.
  const separar = (linhas) => ({
    cartoes: linhas.filter((l) => l.adquirente !== 'tickets'),
    tickets: linhas.filter((l) => l.adquirente === 'tickets'),
  });

  const somar = (linhas) => {
    const s = linhas.reduce(
      (a, l) => ({
        transacoes: a.transacoes + l.transacoes,
        bruto: a.bruto + l.bruto,
        tarifa: a.tarifa + l.tarifa,
        liquido: a.liquido + l.liquido,
        bruto_com_taxa: a.bruto_com_taxa + l.bruto_com_taxa,
        tarifa_com_taxa: a.tarifa_com_taxa + l.tarifa_com_taxa,
        transacoes_sem_taxa: a.transacoes_sem_taxa + (l.transacoes - l.transacoes_com_taxa),
        diferenca_valor: a.diferenca_valor + (l.diferenca_valor || 0),
        // Só faz sentido dizer "está tudo conferido" se houver regra para tudo.
        sem_regra: a.sem_regra + (l.combinado === null ? 1 : 0),
      }),
      { transacoes: 0, bruto: 0, tarifa: 0, liquido: 0, bruto_com_taxa: 0, tarifa_com_taxa: 0, transacoes_sem_taxa: 0, diferenca_valor: 0, sem_regra: 0 }
    );
    const arredonda = (n) => Number(n.toFixed(2));
    return {
      ...s,
      bruto: arredonda(s.bruto),
      tarifa: arredonda(s.tarifa),
      liquido: arredonda(s.liquido),
      bruto_com_taxa: arredonda(s.bruto_com_taxa),
      tarifa_com_taxa: arredonda(s.tarifa_com_taxa),
      diferenca_valor: arredonda(s.diferenca_valor),
      percentual: s.bruto_com_taxa > 0 ? Number(((s.tarifa_com_taxa / s.bruto_com_taxa) * 100).toFixed(4)) : null,
    };
  };

  const bandeiras = separar(porBandeira);
  const dias = separar(porDia);

  return res.json({
    periodo: { de, ate },
    regras,
    combinacoes,
    cartoes: { linhas: bandeiras.cartoes, totais: somar(bandeiras.cartoes), por_dia: dias.cartoes },
    tickets: { linhas: bandeiras.tickets, totais: somar(bandeiras.tickets), por_dia: dias.tickets },
  });
}

// ── Taxas combinadas ─────────────────────────────────────────────────────────

async function listarRegras(req, res) {
  return res.json(await lerRegras());
}

function validarRegra(corpo) {
  const adquirente = String(corpo.adquirente || '').trim();
  if (!ADQUIRENTES.includes(adquirente)) {
    return { erro: `Escolha a adquirente. Use uma de: ${ADQUIRENTES.join(', ')}.` };
  }
  const percentual = Number(corpo.percentual);
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
    return { erro: 'Percentual inválido: use um número entre 0 e 100.' };
  }
  return {
    adquirente,
    bandeira: String(corpo.bandeira || '').trim() || null,
    forma: String(corpo.forma || '').trim() || null,
    percentual,
    observacoes: String(corpo.observacoes || '').trim() || null,
  };
}

async function salvarRegra(req, res) {
  const dados = validarRegra(req.body);
  if (dados.erro) return res.status(400).json({ error: dados.erro });

  // Repetir a mesma combinação atualiza em vez de duplicar: cadastrar de novo é
  // o gesto natural de quem quer corrigir, e duas regras iguais com percentuais
  // diferentes seriam impossíveis de explicar.
  const { rows } = await pool.query(
    `INSERT INTO taxas_contratadas (adquirente, bandeira, forma, percentual, observacoes, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (adquirente, COALESCE(bandeira, ''), COALESCE(forma, ''))
       DO UPDATE SET percentual = EXCLUDED.percentual,
                     observacoes = EXCLUDED.observacoes,
                     atualizado_em = now()
     RETURNING id`,
    [dados.adquirente, dados.bandeira, dados.forma, dados.percentual, dados.observacoes, req.user.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'update',
    entidade: 'taxas_contratadas',
    entidadeId: rows[0].id,
    dados,
  });

  return res.status(201).json({ id: rows[0].id });
}

async function deletarRegra(req, res) {
  const { rowCount } = await pool.query('DELETE FROM taxas_contratadas WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Taxa combinada não encontrada.' });
  return res.status(204).send();
}

module.exports = { resumo, listarRegras, salvarRegra, deletarRegra };
