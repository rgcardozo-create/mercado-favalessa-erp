const pool = require('../db/pool');
const { registrarAuditoria } = require('../utils/auditoria');

// Os números que a convenção coletiva decide, e que eu não tenho como adivinhar.
//
// A lei manda no mínimo 50% na hora extra, mas convenção de supermercado
// costuma pedir mais — e chutar 50% num lugar onde se deve 60% não é errar por
// pouco, é pagar a menos todo mês. Por isso ficam configuráveis, com o mínimo
// legal como ponto de partida e o aviso na tela de conferir na convenção.
//
// O divisor 220 é o padrão de quem trabalha 44 horas por semana. Quem tem
// jornada diferente muda aqui.
const PADRAO = {
  he_percentual: 50,
  he_percentual_domingo: 100,
  divisor_horas: 220,
};

const LIMITES = {
  he_percentual: [0, 300],
  he_percentual_domingo: [0, 300],
  divisor_horas: [1, 400],
};

const CHAVES = Object.keys(PADRAO);
const prefixada = (c) => `trabalhista_${c}`;

async function lerParametros() {
  const { rows } = await pool.query('SELECT chave, valor FROM configuracoes WHERE chave = ANY($1::text[])', [
    CHAVES.map(prefixada),
  ]);
  const guardado = new Map(rows.map((r) => [r.chave, r.valor]));
  const saida = {};
  for (const c of CHAVES) {
    const v = Number(guardado.get(prefixada(c)));
    saida[c] = Number.isFinite(v) && guardado.has(prefixada(c)) ? v : PADRAO[c];
  }
  return saida;
}

async function listar(req, res) {
  return res.json({ parametros: await lerParametros(), padrao: PADRAO });
}

async function salvar(req, res) {
  const novos = {};
  for (const c of CHAVES) {
    if (req.body[c] === undefined) continue;
    const v = Number(req.body[c]);
    const [min, max] = LIMITES[c];
    if (!Number.isFinite(v) || v < min || v > max) {
      return res.status(400).json({ error: `Valor inválido para ${c}: use um número entre ${min} e ${max}.` });
    }
    novos[c] = v;
  }
  if (!Object.keys(novos).length) {
    return res.status(400).json({ error: 'Nada para salvar.' });
  }

  for (const [c, v] of Object.entries(novos)) {
    await pool.query(
      `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES ($1, $2, now())
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [prefixada(c), String(v)]
    );
  }

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'update',
    entidade: 'parametros_trabalhistas',
    dados: novos,
  });

  return res.json({ parametros: await lerParametros(), padrao: PADRAO });
}

module.exports = { listar, salvar, lerParametros, PADRAO };
