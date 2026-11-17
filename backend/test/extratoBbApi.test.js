const { converterLancamentos } = require('../src/utils/extratoBancoApi');
const { lerConfig, criarCliente, janelas, paraDdmmaaaa, deDdmmaaaa, ErroBB } = require('../src/utils/bbExtratosApi');
const { msAteProxima, opcoes } = require('../src/jobs/extratoBbDiario');
const { chaveDe } = require('../src/utils/extratoBanco');

let falhas = 0;
const ok = (rot, cond) => { if (!cond) falhas++; console.log(`  ${cond ? 'ok  ' : 'ERRO'} ${rot}`); };

// Lançamentos no formato da especificação OpenAPI da API Extratos v2.
const lanc = (x) => ({
  indicadorTipoLancamento: '1',
  dataLancamento: 15062026,
  numeroDocumento: 0,
  codigoHistorico: 0,
  textoDescricaoSubHistorico: '',
  valorLancamento: 0,
  indicadorSinalLancamento: 'D',
  textoInformacaoComplementar: '',
  ...x,
});

const AMOSTRA = [
  lanc({ indicadorTipoLancamento: 'SA', textoDescricaoSubHistorico: 'Saldo Anterior', valorLancamento: 10000, indicadorSinalLancamento: 'C' }),
  lanc({ dataLancamento: 1062026, numeroDocumento: 60101, textoDescricaoSubHistorico: 'Pix - Enviado', textoInformacaoComplementar: '01/06 21:07 Favalessa', valorLancamento: 1500, indicadorSinalLancamento: 'D' }),
  lanc({ dataLancamento: 29062026, numeroDocumento: 62901, textoDescricaoSubHistorico: 'Pix - Enviado', textoInformacaoComplementar: '29/06 21:51 Favalessa', valorLancamento: 2200.5, indicadorSinalLancamento: 'D' }),
  lanc({ numeroDocumento: 777, textoDescricaoSubHistorico: 'Pagamento de Boleto', textoInformacaoComplementar: 'LATICINIOS SERRA AZUL', valorLancamento: 1318.45, indicadorSinalLancamento: 'D' }),
  lanc({ numeroDocumento: 888, textoDescricaoSubHistorico: 'Pix - Recebido', textoInformacaoComplementar: 'CLIENTE', valorLancamento: 300, indicadorSinalLancamento: 'C' }),
  lanc({ indicadorTipoLancamento: '2', textoDescricaoSubHistorico: 'Pagamento agendado', valorLancamento: 50, indicadorSinalLancamento: 'D' }),
  lanc({ indicadorTipoLancamento: '3', textoDescricaoSubHistorico: 'Pix em processamento', valorLancamento: 40, indicadorSinalLancamento: 'D' }),
  lanc({ textoDescricaoSubHistorico: 'Bloqueio judicial', valorLancamento: 99, indicadorSinalLancamento: '*' }),
  // Dois lançamentos iguais, sem documento, no mesmo dia: os dois existem.
  lanc({ textoDescricaoSubHistorico: 'Tarifa Pix Enviado', textoInformacaoComplementar: 'Tar. agrupadas', valorLancamento: 1.5, indicadorSinalLancamento: 'D' }),
  lanc({ textoDescricaoSubHistorico: 'Tarifa Pix Enviado', textoInformacaoComplementar: 'Tar. agrupadas', valorLancamento: 1.5, indicadorSinalLancamento: 'D' }),
];

(async () => {
  console.log('=== datas ===');
  ok('ISO para DDMMAAAA', paraDdmmaaaa('2026-06-01') === '01062026');
  ok('número sem o zero do dia volta a ser data', deDdmmaaaa(1062026) === '2026-06-01');
  ok('texto DDMMAAAA', deDdmmaaaa('29062026') === '2026-06-29');
  ok('zero é sem data', deDdmmaaaa(0) === null);

  console.log('=== janelas de 31 dias ===');
  const j = janelas('2026-01-01', '2026-03-15');
  ok('três janelas para 74 dias', j.length === 3);
  ok('primeira vai até 31/01', j[0].ate === '2026-01-31');
  ok('segunda começa no dia seguinte, sem buraco', j[1].de === '2026-02-01');
  ok('última termina na data final', j[2].ate === '2026-03-15');
  ok('período de um dia é uma janela', janelas('2026-06-15', '2026-06-15').length === 1);
  let erro = null;
  try { janelas('2026-06-20', '2026-06-10'); } catch (e) { erro = e; }
  ok('período invertido é recusado', erro instanceof ErroBB);

  console.log('=== conversão dos lançamentos ===');
  const lido = converterLancamentos(AMOSTRA, 7);
  ok('reconhecido e detalhado', lido.reconhecido && lido.modo === 'detalhado' && lido.origem === 'api');
  ok('5 saídas (3 com documento + 2 tarifas iguais)', lido.saidas.length === 5);
  ok('saldo fica de fora', lido.ignoradas.saldo === 1);
  ok('recebimento fica de fora', lido.ignoradas.entrada === 1);
  ok('futuro e em processamento ficam de fora', lido.ignoradas.futuro === 2);
  ok('valor bloqueado (*) não vira saída', lido.ignoradas.invalida === 1);
  const pix = lido.saidas.filter((s) => s.lancamento === 'Pix - Enviado');
  ok('data do dia 1º lida certo', pix[0].data === '2026-06-01');
  ok('os Pix da noite caem na mesma chave', pix[0].chave === pix[1].chave);
  ok('chave igual à que a planilha gera', pix[0].chave === chaveDe('Pix - Enviado', '01/06 21:07 Favalessa'));
  ok('forma do Pix', pix[0].forma === 'PIX');
  const boleto = lido.saidas.find((s) => s.forma === 'Boleto');
  ok('boleto com documento e valor', boleto.documento === '777' && boleto.valor === 1318.45);
  const tarifas = lido.saidas.filter((s) => s.lancamento === 'Tarifa Pix Enviado');
  ok('tarifas repetidas não se apagam (identidades diferentes)', tarifas.length === 2 && tarifas[0].impressao !== tarifas[1].impressao);
  ok('documento zero é "sem documento"', tarifas[0].documento === '');
  const deNovo = converterLancamentos(AMOSTRA, 7);
  ok('ler de novo dá as mesmas identidades (não duplica)',
     deNovo.saidas.map((s) => s.impressao).join() === lido.saidas.map((s) => s.impressao).join());
  ok('outra conta dá outra identidade', converterLancamentos(AMOSTRA, 8).saidas[0].impressao !== lido.saidas[0].impressao);

  console.log('=== configuração ===');
  const vazia = lerConfig({});
  ok('sem variáveis: não configurado', !vazia.completo);
  ok('diz o que falta', vazia.faltando.includes('BB_CLIENT_ID') && vazia.faltando.some((f) => f.startsWith('certificado')));
  const env = {
    BB_EXTRATOS_AMBIENTE: 'teste', BB_CLIENT_ID: 'id', BB_CLIENT_SECRET: 'segredo', BB_APP_KEY: 'chave-app',
    BB_AGENCIA: '0297', BB_CONTA: '001213-X', BB_CERT_PFX_BASE64: Buffer.from('pfx-falso').toString('base64'), BB_CERT_SENHA: 's',
  };
  const cfg = lerConfig(env);
  ok('com tudo: configurado', cfg.completo);
  ok('agência e conta sem zeros e sem dígito', cfg.agencia === '297' && cfg.conta === '1213');
  ok('ambiente desconhecido é recusado', !lerConfig({ ...env, BB_EXTRATOS_AMBIENTE: 'prod' }).completo);
  ok('produção usa o endereço de produção', lerConfig({ ...env, BB_EXTRATOS_AMBIENTE: 'producao' }).urls.api === 'https://extratos.mtls.api.bb.com.br/v2');

  console.log('=== cliente da API (respostas simuladas) ===');
  const chamadas = [];
  const paginas = {
    1: { numeroPaginaAtual: 1, numeroPaginaProximo: 2, listaLancamento: AMOSTRA.slice(0, 5) },
    2: { numeroPaginaAtual: 2, numeroPaginaProximo: 0, listaLancamento: AMOSTRA.slice(5) },
  };
  const falso = async (url, op) => {
    chamadas.push({ url, op });
    if (url.includes('/oauth/token')) return { status: 200, corpo: JSON.stringify({ access_token: 'tok', expires_in: 600 }) };
    const n = new URL(url).searchParams.get('numeroPaginaSolicitacao');
    return { status: 200, corpo: JSON.stringify(paginas[n]) };
  };
  const cliente = criarCliente(cfg, { requisitar: falso });
  const tudo = await cliente.buscarExtrato({ de: '2026-06-01', ate: '2026-06-30' });
  ok('junta as duas páginas', tudo.length === AMOSTRA.length);
  const token = chamadas.filter((c) => c.url.includes('/oauth/token'));
  ok('pede o token uma vez só', token.length === 1);
  ok('token no endereço de teste', token[0].url === 'https://oauth.hm.bb.com.br/oauth/token');
  ok('token com client credentials e escopo extrato-info', /grant_type=client_credentials/.test(token[0].op.body) && /scope=extrato-info/.test(token[0].op.body));
  ok('credenciais em Basic', token[0].op.headers.Authorization === `Basic ${Buffer.from('id:segredo').toString('base64')}`);
  const extrato = chamadas.filter((c) => c.url.includes('/conta-corrente/'));
  const u = new URL(extrato[0].url);
  ok('endereço do extrato com agência e conta', u.origin + u.pathname === 'https://extratos.mtls.api.hm.bb.com.br/v2/conta-corrente/agencia/297/conta/1213');
  ok('chave da aplicação na query', u.searchParams.get('gw-dev-app-key') === 'chave-app');
  ok('datas em DDMMAAAA', u.searchParams.get('dataInicioSolicitacao') === '01062026' && u.searchParams.get('dataFimSolicitacao') === '30062026');
  ok('página de 120 mantida', extrato.every((c) => new URL(c.url).searchParams.get('quantidadeRegistroPaginaSolicitacao') === '120'));
  ok('Bearer no extrato', extrato[0].op.headers.Authorization === 'Bearer tok');
  ok('certificado enviado nas conexões', extrato[0].op.agent && extrato[0].op.agent.options.pfx);

  const recusa = criarCliente(cfg, {
    requisitar: async (url) =>
      url.includes('/oauth/token')
        ? { status: 200, corpo: JSON.stringify({ access_token: 't', expires_in: 600 }) }
        : { status: 422, corpo: JSON.stringify({ code: '99', message: 'Conta não autorizada para a aplicação.' }) },
  });
  let e2 = null;
  try { await recusa.buscarExtrato({ de: '2026-06-01', ate: '2026-06-02' }); } catch (e) { e2 = e; }
  ok('erro do banco chega com a mensagem dele', e2 instanceof ErroBB && /Conta não autorizada/.test(e2.message));

  let e3 = null;
  try { criarCliente(vazia); } catch (e) { e3 = e; }
  ok('sem configuração, avisa o que falta', e3 instanceof ErroBB && /Falta/.test(e3.message));

  console.log('=== agenda ===');
  // 06:30 em Brasília = 09:30 UTC.
  const antes = new Date('2026-11-17T09:30:00Z');
  ok('às 6h30 falta meia hora para as 7h', msAteProxima('07:00', antes) === 30 * 60000);
  const depois = new Date('2026-11-17T10:30:00Z');
  ok('às 7h30 a próxima é amanhã às 7h', msAteProxima('07:00', depois) === 23.5 * 3600000);
  ok('desligada por padrão', opcoes({}).automatico === false);
  ok('hora inválida volta para 07:00', opcoes({ BB_EXTRATOS_HORA: '25:99' }).hora === '07:00');
  ok('dias limitado a 31', opcoes({ BB_EXTRATOS_DIAS: '90' }).dias === 31);

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
