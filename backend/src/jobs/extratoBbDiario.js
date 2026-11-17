const pool = require('../db/pool');
const { lerConfig, criarCliente, somarDias } = require('../utils/bbExtratosApi');
const { converterLancamentos } = require('../utils/extratoBancoApi');
const { conflitoDeModo, regrasSalvas, gravarSaidas } = require('../utils/saidasBanco');
const { registrarAuditoria } = require('../utils/auditoria');

// Busca diária do extrato do Banco do Brasil pela API.
//
// O que ela faz, de propósito, é pouco: aplica o que o dono JÁ ensinou. Saída
// com regra "lançar" vira conta paga; com "ignorar", fica de lado; sem regra,
// espera — aparece na tela de Conciliação para alguém dizer o que é, como
// acontece hoje com o arquivo. A busca nunca inventa classificação.
//
// Olha os últimos dias, e não só ontem: lançamento de sexta às vezes só é
// contabilizado na segunda, e um dia em que o banco estava fora do ar não pode
// virar buraco. Reimportar é seguro — a identidade de cada lançamento impede
// conta em dobro.

const FUSO = 'America/Sao_Paulo';

const hojeSP = (agora = new Date()) => agora.toLocaleDateString('en-CA', { timeZone: FUSO });

function opcoes(env = process.env) {
  const hora = String(env.BB_EXTRATOS_HORA || '07:00').trim();
  const m = hora.match(/^(\d{1,2}):(\d{2})$/);
  return {
    automatico: String(env.BB_EXTRATOS_AUTOMATICO || '').toLowerCase() === 'true',
    hora: m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '07:00',
    dias: Math.min(Math.max(Number(env.BB_EXTRATOS_DIAS) || 5, 1), 31),
    bancoNome: String(env.BB_BANCO_NOME || 'Banco do Brasil').trim(),
  };
}

// A conta do cadastro de Bancos a que o extrato pertence. É por ela que as
// regras são achadas: as regras ensinadas com a planilha do BB valem também
// para o que vem da API, desde que o nome bata.
async function bancoConfigurado(env = process.env) {
  const { bancoNome } = opcoes(env);
  const { rows } = await pool.query(
    `SELECT id, nome FROM bancos
      WHERE lower(nome) = lower($1) OR nome ILIKE $2
      ORDER BY (lower(nome) = lower($1)) DESC, id
      LIMIT 1`,
    [bancoNome, `%${bancoNome}%`]
  );
  return rows[0] || null;
}

// Quanto falta para a próxima hora marcada, no horário de Brasília.
function msAteProxima(hora, agora = new Date()) {
  const [h, m] = hora.split(':').map(Number);
  // O relógio de Brasília neste instante, lido como hora "de parede". A conta é
  // feita toda nesse relógio, então o fuso do servidor (UTC no Railway) não
  // interfere: a espera é a distância entre a hora de agora e a hora marcada.
  const sp = new Date(agora.toLocaleString('en-US', { timeZone: FUSO }));
  sp.setMilliseconds(agora.getMilliseconds());
  const alvo = new Date(sp);
  alvo.setHours(h, m, 0, 0);
  if (alvo <= sp) alvo.setDate(alvo.getDate() + 1);
  return alvo.getTime() - sp.getTime();
}

async function registrarExecucao({ origem, de, ate, sucesso, resultado, erro, usuarioId }) {
  await pool.query(
    `INSERT INTO extrato_api_execucoes (origem, de, ate, sucesso, resultado, erro, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [origem, de, ate, sucesso, resultado ? JSON.stringify(resultado) : null, erro || null, usuarioId || null]
  );
}

let emAndamento = false;

// Busca, converte e grava. Toda execução, certa ou errada, fica registrada: é
// assim que a tela mostra se a busca de hoje rodou.
async function executarBusca({ de, ate, origem = 'automatica', usuarioId = null, env = process.env, clienteBB } = {}) {
  if (emAndamento) throw new Error('Já existe uma busca do extrato em andamento. Tente de novo em instantes.');
  emAndamento = true;
  const hoje = hojeSP();
  const periodo = {
    de: de || somarDias(hoje, -opcoes(env).dias),
    // Hoje fica de fora na busca automática: o dia ainda não fechou.
    ate: ate || somarDias(hoje, -1),
  };

  try {
    const banco = await bancoConfigurado(env);
    if (!banco) {
      throw new Error(
        `Não achei a conta "${opcoes(env).bancoNome}" no cadastro de Bancos. ` +
          'Cadastre-a em Cadastros › Bancos, ou ajuste BB_BANCO_NOME.'
      );
    }
    const cliente = clienteBB || criarCliente(lerConfig(env));
    const lancamentos = await cliente.buscarExtrato(periodo);
    const lido = converterLancamentos(lancamentos, banco.id);

    const conflito = await conflitoDeModo(lido, banco);
    if (conflito) throw new Error(conflito.mensagem);

    const regras = await regrasSalvas([...new Set(lido.saidas.map((s) => s.chave))], banco.id);
    const resultado = await gravarSaidas({ lido, banco, regras, usuarioId, salvarRegras: false });
    resultado.lidos = lancamentos.length;
    resultado.saidas = lido.saidas.length;
    resultado.ignoradas_leitura = lido.ignoradas;

    await registrarExecucao({ origem, ...periodo, sucesso: true, resultado, usuarioId });
    await registrarAuditoria({
      usuarioId,
      acao: 'buscar-extrato-bb-api',
      entidade: 'contas',
      dados: { origem, ...periodo, ...resultado },
    });
    return { ...periodo, banco, ...resultado };
  } catch (err) {
    await registrarExecucao({ origem, ...periodo, sucesso: false, erro: err.message, usuarioId }).catch(() => {});
    throw err;
  } finally {
    emAndamento = false;
  }
}

async function statusIntegracao(env = process.env) {
  const cfg = lerConfig(env);
  const op = opcoes(env);
  const banco = await bancoConfigurado(env).catch(() => null);
  const { rows } = await pool.query(
    `SELECT e.id, e.origem, e.de, e.ate, e.sucesso, e.resultado, e.erro, e.criado_em, u.nome AS usuario_nome
       FROM extrato_api_execucoes e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
      ORDER BY e.criado_em DESC
      LIMIT 10`
  );
  return {
    configurado: cfg.completo,
    faltando: cfg.faltando,
    ambiente: cfg.ambiente,
    // Só os quatro últimos dígitos: a tela não precisa de mais para saber de
    // qual conta se trata.
    conta: cfg.conta ? `ag. ${cfg.agencia} · conta …${cfg.conta.slice(-4)}` : null,
    banco,
    automatico: { ativo: op.automatico && cfg.completo, hora: op.hora, dias: op.dias },
    execucoes: rows,
  };
}

let temporizador = null;

// Agenda a próxima busca e, depois de rodar, a seguinte. Um setTimeout por dia
// basta: o servidor é um só, e se ele reiniciar a agenda é refeita ao subir.
function agendar(env = process.env) {
  const op = opcoes(env);
  const cfg = lerConfig(env);
  if (!op.automatico) return null;
  if (!cfg.completo) {
    console.warn(`Busca automática do extrato BB desligada: falta ${cfg.faltando.join(', ')}.`);
    return null;
  }
  const espera = msAteProxima(op.hora);
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    try {
      const r = await executarBusca({ origem: 'automatica', env });
      console.log(`Extrato BB: ${r.lancadas} lançada(s), ${r.sem_regra} sem regra (${r.de} a ${r.ate}).`);
    } catch (err) {
      console.error('Extrato BB: a busca automática falhou:', err.message);
    }
    agendar(env);
  }, espera);
  // Não segura o processo vivo só por causa da agenda.
  if (temporizador.unref) temporizador.unref();
  console.log(`Busca automática do extrato BB agendada para ${op.hora} (em ${Math.round(espera / 60000)} min).`);
  return espera;
}

module.exports = { executarBusca, statusIntegracao, agendar, msAteProxima, opcoes, hojeSP, bancoConfigurado };
