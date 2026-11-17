const https = require('https');

// Cliente da API Extratos v2 do Banco do Brasil (especificação OpenAPI 2.0.1,
// baixada do Portal Developers BB).
//
// O que a especificação exige, e por isso está aqui:
// - Token OAuth2 "client credentials" com o escopo `extrato-info`.
// - A chave da aplicação (`gw-dev-app-key`) em toda consulta, na query string.
// - Certificado do cliente (mTLS): o próprio endereço da API, nos dois
//   ambientes, é `extratos.mtls.api...`. Sem certificado o banco recusa a
//   conexão antes de olhar o token.
// - Período de no máximo 31 dias por consulta, datas em DDMMAAAA, e páginas de
//   30 a 120 lançamentos, mantendo o mesmo tamanho em todas as páginas.
//
// Nada daqui fica no código: credenciais e certificado vêm das variáveis de
// ambiente do servidor (Railway), e nunca passam pela tela nem pelo banco de
// dados do sistema.

const AMBIENTES = {
  teste: {
    token: 'https://oauth.hm.bb.com.br/oauth/token',
    api: 'https://extratos.mtls.api.hm.bb.com.br/v2',
  },
  producao: {
    token: 'https://oauth.bb.com.br/oauth/token',
    api: 'https://extratos.mtls.api.bb.com.br/v2',
  },
};

const ESCOPO = 'extrato-info';
const TAMANHO_PAGINA = 120;
const MAX_DIAS_POR_CONSULTA = 31;
// Trava contra laço infinito se o banco responder a paginação errado: 120
// lançamentos por página dá 12 mil num mês, muito mais do que a conta tem.
const MAX_PAGINAS = 100;

class ErroBB extends Error {
  constructor(mensagem, { status, codigo } = {}) {
    super(mensagem);
    this.name = 'ErroBB';
    this.status = status;
    this.codigo = codigo;
  }
}

const decodificar = (b64) => (b64 ? Buffer.from(String(b64).replace(/\s+/g, ''), 'base64') : null);

// Lê a configuração do ambiente. Devolve `faltando` em vez de lançar erro: a
// tela usa isso para dizer exatamente o que ainda não foi cadastrado.
function lerConfig(env = process.env) {
  const ambiente = String(env.BB_EXTRATOS_AMBIENTE || 'teste').trim().toLowerCase();
  const cfg = {
    ambiente,
    clientId: env.BB_CLIENT_ID,
    clientSecret: env.BB_CLIENT_SECRET,
    appKey: env.BB_APP_KEY,
    agencia: String(env.BB_AGENCIA || '').replace(/\D/g, '').replace(/^0+/, ''),
    conta: String(env.BB_CONTA || '').replace(/\D/g, '').replace(/^0+/, ''),
    // Certificado em .pfx (com senha), ou em PEM (certificado + chave), sempre em
    // base64: variável de ambiente não guarda arquivo binário nem quebra de linha
    // com segurança.
    pfx: decodificar(env.BB_CERT_PFX_BASE64),
    senhaPfx: env.BB_CERT_SENHA || undefined,
    certPem: decodificar(env.BB_CERT_PEM_BASE64),
    chavePem: decodificar(env.BB_KEY_PEM_BASE64),
  };

  const faltando = [];
  if (!AMBIENTES[ambiente]) faltando.push('BB_EXTRATOS_AMBIENTE (use "teste" ou "producao")');
  if (!cfg.clientId) faltando.push('BB_CLIENT_ID');
  if (!cfg.clientSecret) faltando.push('BB_CLIENT_SECRET');
  if (!cfg.appKey) faltando.push('BB_APP_KEY');
  if (!cfg.agencia) faltando.push('BB_AGENCIA');
  if (!cfg.conta) faltando.push('BB_CONTA');
  if (!cfg.pfx && !(cfg.certPem && cfg.chavePem)) {
    faltando.push('certificado (BB_CERT_PFX_BASE64 e BB_CERT_SENHA, ou BB_CERT_PEM_BASE64 e BB_KEY_PEM_BASE64)');
  }
  // Endereços trocados só para testar contra um servidor de mentira; em uso
  // normal ficam vazios e valem os do ambiente escolhido.
  const urls = AMBIENTES[ambiente]
    ? {
        token: env.BB_EXTRATOS_URL_TOKEN || AMBIENTES[ambiente].token,
        api: env.BB_EXTRATOS_URL_API || AMBIENTES[ambiente].api,
      }
    : null;
  return { ...cfg, urls, faltando, completo: faltando.length === 0 };
}

function agenteMtls(cfg) {
  return new https.Agent({
    keepAlive: true,
    ...(cfg.pfx ? { pfx: cfg.pfx, passphrase: cfg.senhaPfx } : { cert: cfg.certPem, key: cfg.chavePem }),
  });
}

// Uma requisição HTTPS que devolve { status, corpo }. Separada para os testes
// poderem trocá-la por uma resposta fixa, sem rede.
function requisitarHttps(url, { method = 'GET', headers = {}, body, agent } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, agent, timeout: 30000 }, (res) => {
      const partes = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => resolve({ status: res.statusCode, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('O Banco do Brasil não respondeu em 30 segundos.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const lerJson = (texto) => {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

// Mensagem de erro do BB em português, do jeito que a API devolve. Os erros
// 422/500 vêm como { code, message }; o OAuth, como { error, error_description }.
function erroDaResposta(status, corpo, onde) {
  const j = lerJson(corpo) || {};
  const detalhe =
    j.message || j.error_description || j.error ||
    (Array.isArray(j.erros) && j.erros[0] && (j.erros[0].mensagem || j.erros[0].message)) ||
    String(corpo || '').slice(0, 200);
  return new ErroBB(`${onde}: ${detalhe || `HTTP ${status}`}`, { status, codigo: j.code || j.error });
}

// "01112026" ↔ "2026-11-01". A API manda a data como número, então o zero do
// dia some ("1112026"): o padStart devolve os oito dígitos.
function paraDdmmaaaa(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}${m}${a}`;
}

function deDdmmaaaa(valor) {
  const t = String(valor ?? '').replace(/\D/g, '');
  if (!t || /^0+$/.test(t)) return null;
  const s = t.padStart(8, '0');
  return `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
}

const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// O banco aceita no máximo 31 dias por consulta. Um período maior vira várias
// janelas seguidas, sem buraco e sem sobreposição.
function janelas(de, ate) {
  if (!de || !ate || de > ate) throw new ErroBB('Período inválido: a data inicial vem depois da final.');
  const lista = [];
  let inicio = de;
  while (inicio <= ate) {
    const fim = somarDias(inicio, MAX_DIAS_POR_CONSULTA - 1);
    lista.push({ de: inicio, ate: fim < ate ? fim : ate });
    inicio = somarDias(fim, 1);
  }
  return lista;
}

function criarCliente(cfg = lerConfig(), { requisitar = requisitarHttps, agora = () => Date.now() } = {}) {
  if (!cfg.completo) {
    throw new ErroBB(`A integração com o Banco do Brasil não está configurada. Falta: ${cfg.faltando.join(', ')}.`);
  }
  const agent = agenteMtls(cfg);
  let token = null;
  let expiraEm = 0;

  async function obterToken() {
    // Renova um minuto antes de vencer, para não usar um token que expira no meio
    // da paginação.
    if (token && agora() < expiraEm - 60000) return token;
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: ESCOPO }).toString();
    const r = await requisitar(cfg.urls.token, {
      method: 'POST',
      agent,
      body,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    if (r.status !== 200) throw erroDaResposta(r.status, r.corpo, 'Token do Banco do Brasil recusado');
    const j = lerJson(r.corpo);
    if (!j || !j.access_token) throw new ErroBB('O Banco do Brasil não devolveu o token de acesso.');
    token = j.access_token;
    expiraEm = agora() + (Number(j.expires_in) || 600) * 1000;
    return token;
  }

  async function pagina({ de, ate, numero }) {
    const url = new URL(`${cfg.urls.api}/conta-corrente/agencia/${cfg.agencia}/conta/${cfg.conta}`);
    url.searchParams.set('gw-dev-app-key', cfg.appKey);
    url.searchParams.set('dataInicioSolicitacao', paraDdmmaaaa(de));
    url.searchParams.set('dataFimSolicitacao', paraDdmmaaaa(ate));
    url.searchParams.set('numeroPaginaSolicitacao', String(numero));
    url.searchParams.set('quantidadeRegistroPaginaSolicitacao', String(TAMANHO_PAGINA));
    const r = await requisitar(url.toString(), {
      agent,
      headers: { Authorization: `Bearer ${await obterToken()}`, Accept: 'application/json' },
    });
    if (r.status !== 200) throw erroDaResposta(r.status, r.corpo, 'Extrato do Banco do Brasil');
    const j = lerJson(r.corpo);
    if (!j) throw new ErroBB('O Banco do Brasil devolveu um extrato que não consegui ler.');
    return j;
  }

  // Todos os lançamentos do período, juntando as janelas de 31 dias e as páginas.
  async function buscarExtrato({ de, ate }) {
    const lancamentos = [];
    for (const janela of janelas(de, ate)) {
      let numero = 1;
      for (let i = 0; i < MAX_PAGINAS; i += 1) {
        const j = await pagina({ ...janela, numero });
        lancamentos.push(...(j.listaLancamento || []));
        const proxima = Number(j.numeroPaginaProximo) || 0;
        if (!proxima || proxima <= numero) break;
        numero = proxima;
      }
    }
    return lancamentos;
  }

  return { buscarExtrato, obterToken };
}

module.exports = {
  AMBIENTES,
  ErroBB,
  lerConfig,
  criarCliente,
  janelas,
  paraDdmmaaaa,
  deDdmmaaaa,
  somarDias,
};
