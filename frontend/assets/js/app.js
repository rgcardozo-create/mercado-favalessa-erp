import { apiFetch, getSessao, salvarSessao, limparSessao, setFolhaToken, getFolhaToken } from './api.js';
import { brl, brlCurto, mesCurto, dateBR, todayISO, escapar } from './helpers.js';

// As quatro telas de Contas a pagar. Rótulos iguais aos do sistema atual.
const TIPOS = [
  { tipo: 'fornecedor', rotulo: 'Fornecedores' },
  { tipo: 'fixa', rotulo: 'Despesas fixas' },
  { tipo: 'imposto', rotulo: 'Impostos' },
  { tipo: 'despesa', rotulo: 'Outras despesas' },
];

// Versão do casco, mostrada no topo da tela. Serve para saber, olhando, se o
// navegador já está com a última atualização ou ainda com uma cópia em cache.
const VERSAO = '1.13.0';

const state = {
  sessao: getSessao(),
  tab: 'painel',
  tipo: 'fornecedor',
  contas: [],
  fornecedores: [],
  // Listas do cadastro que a baixa usa: forma de pagamento e banco.
  formasPagamento: [],
  bancos: [],
  painel: null,
  filtroBoletos: 'hoje',
  filtroFixas: 'ate_hoje',
  filtroImpostos: 'ate_hoje',
  filtroDespesas: 'ate_hoje',
  conciliacao: null,
  acumulados: null,
  // Resumo de vendas: responde "estou vendendo bem?" e cobra os dias em branco.
  resumoVendas: null,
  diaAcumulado: null,
  historicoCompleto: false,
  // O que a conciliação já tem para o dia escolhido, para sugerir o fechamento.
  sugestaoDia: null,
  sugestaoCarregando: false,
  vendaPrazo: null,
  cadastros: null,
  cadastroTipo: 'clientes',
  folha: null,
  // Recorte da folha: 'atual' (padrão), 'anterior' ou '' para tudo.
  folhaMes: 'atual',
  folhaPendencias: null,
  funcionarios: [],
  extras: null,
  folhaErro: null,
  relatorio: null,
  auditoria: null,
  importacao: null,
  importando: false,
  // O conteúdo do arquivo fica aqui porque o input é recriado a cada render:
  // sem isso, o arquivo escolhido some depois da simulação.
  arquivoImportacao: null,
  extrato: null,
  extratoArquivo: null,
  extratoAdquirente: 'cielo',
  extratoCarregando: false,
  extratoResultado: null,
  periodo: { de: '', ate: '' },
  // Abre já mostrando o que precisa de ação: vencidas e as que vencem hoje.
  statusFiltro: 'vencidas',
  // Recorte por mês da lista de contas: '' (tudo), 'atual' ou 'anterior'.
  mesFiltro: '',
  // Conta expandida: detalhe carregado à parte, com os pagamentos já feitos.
  detalheConta: null,
  edicaoContaId: null,
  pagamentoEditandoId: null,
  buscaContas: '',
  // Lançamento barrado por já existir igual: guarda a mensagem e o que foi
  // digitado, para o usuário corrigir o valor ou confirmar mesmo assim.
  duplicidade: null,
  carregando: false,
  erro: null,
  loginErro: null,
  baixaAbertaId: null,
};

const root = document.getElementById('app');

// Controle da busca de contas: `timerBusca` segura o disparo enquanto o usuário
// digita e `focoBusca` lembra que ele estava no campo, para devolver o cursor
// depois do redesenho. Sai do ar quando o clique vai para outro controle —
// não dá para confiar no evento `blur`, que nem sempre dispara quando o
// próprio elemento é removido do DOM pelo render.
let timerBusca = null;
let focoBusca = false;

function limparBuscaContas() {
  clearTimeout(timerBusca);
  state.buscaContas = '';
  state.duplicidade = null;
  state.edicaoContaId = null;
  state.pagamentoEditandoId = null;
  state.detalheConta = null;
  focoBusca = false;
}

function rotuloTipo(tipo) {
  const t = TIPOS.find((x) => x.tipo === tipo);
  return t ? t.rotulo : tipo;
}

function podeGerenciar() {
  return state.sessao && state.sessao.usuario.role !== 'loja';
}

// Painel do dia e Acumulado são só para Master e Gerente. O backend também
// bloqueia — esconder a aba aqui é conveniência, não a regra de segurança.
function podeVerPainel() {
  return podeGerenciar();
}

// Acumulado é conferência de caixa: nunca no login "Loja" (SPEC.md, seção 3).
function podeVerAcumulado() {
  return podeGerenciar();
}

// Folha e Extras: Master apenas, e ainda por trás da senha adicional.
function podeVerFolha() {
  return state.sessao && state.sessao.usuario.role === 'master';
}

function podeVerRelatorios() {
  return podeGerenciar();
}

function abaInicial() {
  return podeVerPainel() ? 'painel' : 'contas';
}

// Período padrão dos relatórios: mês corrente.
function periodoOuPadrao() {
  if (state.periodo.de && state.periodo.ate) return state.periodo;
  const hoje = todayISO();
  const [ano, mes] = hoje.split('-');
  const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
  return { de: `${ano}-${mes}-01`, ate: `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}` };
}

async function carregarDados() {
  state.carregando = true;
  state.erro = null;
  render();
  try {
    if (state.tab === 'painel') {
      // Formas e bancos vêm junto porque dá para pagar direto do painel.
      const [painel, formasPainel, bancosPainel] = await Promise.all([
        apiFetch(
          `/painel-do-dia?filtro=${state.filtroBoletos}` +
            `&filtroFixas=${state.filtroFixas}&filtroImpostos=${state.filtroImpostos}` +
            `&filtroDespesas=${state.filtroDespesas}`,
        ),
        apiFetch('/cadastros/formas-pagamento'),
        apiFetch('/cadastros/bancos'),
      ]);
      state.painel = painel;
      state.resumoVendas = await apiFetch('/acumulados/resumo');
      // A contagem de pendências da folha não exige a senha adicional: é só um
      // aviso, sem nome nem valor. Só o Master enxerga.
      state.folhaPendencias = podeVerFolha() ? await apiFetch('/folha/pendencias') : null;
      state.formasPagamento = formasPainel;
      state.bancos = bancosPainel;
    } else if (state.tab === 'conciliacao') {
      state.conciliacao = await apiFetch('/conciliacao');
    } else if (state.tab === 'acumulado') {
      const [acumulados, resumo] = await Promise.all([
        apiFetch('/acumulados'),
        apiFetch('/acumulados/resumo'),
      ]);
      state.acumulados = acumulados;
      state.resumoVendas = resumo;
    } else if (state.tab === 'venda-prazo') {
      state.vendaPrazo = await apiFetch('/venda-prazo');
    } else if (state.tab === 'cadastros') {
      state.cadastros = await apiFetch(`/cadastros/${state.cadastroTipo}`);
    } else if (state.tab === 'folha') {
      // Sem token da folha a API responde 423 — a tela então pede a senha.
      if (getFolhaToken()) {
        const p = periodoDaFolha();
        const [folha, extras, funcionarios] = await Promise.all([
          apiFetch(`/folha${p ? `?de=${p.de}&ate=${p.ate}` : ''}`),
          apiFetch('/folha/extras'),
          apiFetch('/cadastros/funcionarios'),
        ]);
        state.folha = folha;
        state.extras = extras;
        state.funcionarios = funcionarios;
      } else {
        state.folha = null;
        state.extras = null;
      }
    } else if (state.tab === 'relatorios') {
      const p = periodoOuPadrao();
      state.relatorio = await apiFetch(`/relatorios?de=${p.de}&ate=${p.ate}`);
    } else if (state.tab === 'admin') {
      state.auditoria = await apiFetch('/admin/auditoria?limite=50');
    } else {
      const params = new URLSearchParams({ tipo: state.tipo });
      if (state.statusFiltro) params.set('status', state.statusFiltro);
      if (state.buscaContas.trim()) params.set('busca', state.buscaContas.trim());
      if (state.mesFiltro) params.set('mes', state.mesFiltro);
      const [contas, fornecedores, formas, bancos] = await Promise.all([
        apiFetch(`/contas?${params}`),
        apiFetch('/fornecedores'),
        apiFetch('/cadastros/formas-pagamento'),
        apiFetch('/cadastros/bancos'),
      ]);
      state.contas = contas;
      state.fornecedores = fornecedores;
      state.formasPagamento = formas;
      state.bancos = bancos;
    }
  } catch (err) {
    state.erro = err.message;
  } finally {
    state.carregando = false;
    render();
  }
}

function loginHTML() {
  return `
    <div class="login-wrap">
      <form id="form-login" class="login-card">
        <div class="marca"><span class="marca-nome">FAVALESSA</span><span class="marca-sub">Mercado</span></div>
        <h1>Sistema financeiro</h1>
        <p class="subtitulo">Entre com seu usuário e senha</p>
        ${state.loginErro ? `<div class="alerta erro">${state.loginErro}</div>` : ''}
        <label>Email</label>
        <input type="email" name="email" required autocomplete="username" />
        <label>Senha</label>
        <input type="password" name="senha" required autocomplete="current-password" />
        <button type="submit">Entrar</button>
      </form>
    </div>
  `;
}

// Quatro situações, cada uma com a cor do que ela pede: verde já resolveu,
// vermelho passou do prazo, amarelo é para hoje e azul claro é só aviso.
// "Pendente" dizia a mesma coisa para o boleto de ontem e o do mês que vem.
function badgeStatus(conta) {
  if (conta.quitado) return '<span class="badge quitado">Quitada</span>';

  const hoje = todayISO();
  const vencimento = String(conta.vencimento).slice(0, 10);

  if (vencimento < hoje) return '<span class="badge vencida">Vencida</span>';
  if (vencimento === hoje) return '<span class="badge vence-hoje">Vence hoje</span>';
  return '<span class="badge a-vencer">A vencer</span>';
}

function linhaConta(conta) {
  const podeGerir = podeGerenciar();
  const baixaAberta = state.baixaAbertaId === conta.id;
  const editando = state.edicaoContaId === conta.id;

  return `
    <tr>
      <td>${(conta.tipo === 'fornecedor' ? conta.fornecedor_nome : conta.categoria) || '—'}</td>
      <td>${escapar(conta.descricao)}${
        conta.total_parcelas > 1 ? ` <small class="parcela">${conta.parcela}/${conta.total_parcelas}</small>` : ''
      }</td>
      <td>${dateBR(conta.vencimento)}</td>
      <td>${conta.ultimo_pagamento ? dateBR(conta.ultimo_pagamento) : '—'}</td>
      <td>${brl(conta.valor)}</td>
      <td>${brl(conta.saldo)}</td>
      <td>${badgeStatus(conta)}</td>
      <td class="acoes">
        <div class="acoes-linha">
          ${
            podeGerir
              ? `<button data-action="toggle-baixa" data-id="${conta.id}">${
                  baixaAberta ? 'Fechar' : conta.quitado ? 'Pagamentos' : 'Dar baixa'
                }</button>`
              : ''
          }
          ${
            podeGerir
              ? `<button data-action="toggle-editar" data-id="${conta.id}" class="secundario">${editando ? 'Fechar' : 'Editar'}</button>`
              : ''
          }
          ${podeGerir ? `<button data-action="excluir" data-id="${conta.id}" class="perigo">Excluir</button>` : ''}
        </div>
      </td>
    </tr>
    ${editando ? formEditarContaHTML(conta) : ''}
    ${baixaAberta ? blocoBaixaHTML(conta) : ''}
  `;
}

// Corrigir o próprio lançamento: valor digitado errado, vencimento trocado,
// descrição incompleta. O tipo não muda — para isso, exclua e lance de novo.
function formEditarContaHTML(conta) {
  const ehFornecedor = conta.tipo === 'fornecedor';
  const ehDespesa = conta.tipo === 'despesa';

  return `
    <tr class="linha-baixa"><td colspan="8">
      <form data-action="form-editar-conta" data-id="${conta.id}" class="form-inline">
        ${
          ehFornecedor
            ? `<label>Fornecedor
                <select name="fornecedor_id">
                  <option value="">— sem fornecedor —</option>
                  ${state.fornecedores
                    .map(
                      (f) =>
                        `<option value="${f.id}" ${String(conta.fornecedor_id) === String(f.id) ? 'selected' : ''}>${escapar(f.nome)}</option>`
                    )
                    .join('')}
                </select>
              </label>`
            : ''
        }
        <label>Descrição <input type="text" name="descricao" required value="${escapar(conta.descricao)}" /></label>
        ${ehDespesa ? `<label>Categoria <input type="text" name="categoria" value="${escapar(conta.categoria || '')}" /></label>` : ''}
        <label>Valor <input type="number" step="0.01" min="0" name="valor" required value="${conta.valor}" /></label>
        <label>${ehDespesa ? 'Data' : 'Vencimento'}
          <input type="date" name="vencimento" required value="${String(conta.vencimento).slice(0, 10)}" />
        </label>
        ${campoFormaPrevistaHTML(conta.forma_prevista)}
        <button type="submit">Salvar alterações</button>
      </form>
    </td></tr>
  `;
}

// Área expandida da conta: o que já foi pago (com correção e estorno) e, se
// ainda houver saldo, o formulário de nova baixa.
function blocoBaixaHTML(conta) {
  const d = state.detalheConta;
  const carregando = !d || d.id !== conta.id;
  const pagamentos = carregando ? [] : d.pagamentos;

  const listaPagamentos = carregando
    ? '<p class="vazio">Carregando pagamentos…</p>'
    : pagamentos.length
      ? `<table class="tabela-contas tabela-pagamentos">
          <thead><tr><th>Pago em</th><th>Valor</th><th>Forma</th><th>Banco</th><th>Ações</th></tr></thead>
          <tbody>
            ${pagamentos.map((p) => linhaPagamentoHTML(conta, p)).join('')}
          </tbody>
        </table>`
      : '<p class="vazio">Nenhum pagamento registrado nesta conta.</p>';

  return `
    <tr class="linha-baixa"><td colspan="8">
      ${listaPagamentos}
      ${conta.quitado ? '' : formBaixaHTML(conta)}
    </td></tr>
  `;
}

function linhaPagamentoHTML(conta, p) {
  const editando = state.pagamentoEditandoId === p.id;

  if (editando) {
    return `
      <tr><td colspan="5">
        <form data-action="form-editar-pagamento" data-conta="${conta.id}" data-id="${p.id}" class="form-inline">
          <label>Valor pago <input type="number" step="0.01" min="0.01" name="valor" required value="${p.valor}" /></label>
          <label>Data <input type="date" name="data_pagamento" required value="${String(p.data_pagamento).slice(0, 10)}" /></label>
          ${camposFormaEBancoHTML({ forma: p.forma_pagamento, banco: p.banco_id })}
          <button type="submit">Salvar pagamento</button>
          <button type="button" data-action="cancelar-editar-pagamento" class="secundario">Cancelar</button>
        </form>
      </td></tr>
    `;
  }

  return `
    <tr>
      <td>${dateBR(p.data_pagamento)}</td>
      <td>${brl(p.valor)}</td>
      <td>${escapar(p.forma_pagamento || '—')}</td>
      <td>${escapar(p.banco_nome || '—')}</td>
      <td class="acoes">
        <div class="acoes-linha">
          <button data-action="editar-pagamento" data-id="${p.id}" class="secundario">Editar</button>
          <button data-action="excluir-pagamento" data-conta="${conta.id}" data-id="${p.id}" class="perigo">Estornar</button>
        </div>
      </td>
    </tr>
  `;
}

function cabecalhoHTML(titulo) {
  const { usuario } = state.sessao;
  return `
    <div class="topo">
      <div>
        <div class="marca"><span class="marca-nome">FAVALESSA</span><span class="marca-sub">Mercado</span></div>
        <h1>${titulo}</h1>
        <p class="usuario-atual">${usuario.nome} <span class="badge role">${usuario.role}</span> <span class="versao">v${VERSAO}</span></p>
      </div>
      <button id="btn-logout">Sair</button>
    </div>

    <nav class="abas">
      ${podeVerPainel() ? `<button data-tab="painel" class="${state.tab === 'painel' ? 'ativo' : ''}">Painel do dia</button>` : ''}
      <button data-tab="contas" class="${state.tab === 'contas' ? 'ativo' : ''}">Contas a pagar</button>
      <button data-tab="venda-prazo" class="${state.tab === 'venda-prazo' ? 'ativo' : ''}">Venda a prazo</button>
      <button data-tab="conciliacao" class="${state.tab === 'conciliacao' ? 'ativo' : ''}">Conciliação</button>
      ${podeVerAcumulado() ? `<button data-tab="acumulado" class="${state.tab === 'acumulado' ? 'ativo' : ''}">Acumulado</button>` : ''}
      <button data-tab="cadastros" class="${state.tab === 'cadastros' ? 'ativo' : ''}">Cadastros</button>
      ${podeVerRelatorios() ? `<button data-tab="relatorios" class="${state.tab === 'relatorios' ? 'ativo' : ''}">Relatórios</button>` : ''}
      ${podeVerFolha() ? `<button data-tab="folha" class="${state.tab === 'folha' ? 'ativo' : ''}">Folha</button>` : ''}
      ${podeVerFolha() ? `<button data-tab="admin" class="${state.tab === 'admin' ? 'ativo' : ''}">Administração</button>` : ''}
    </nav>

    ${state.erro ? `<div class="alerta erro">${state.erro}</div>` : ''}
  `;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Uma linha do painel: descrição em destaque e, embaixo, o contexto que ajuda a
// decidir (de onde vem, quando vence, parcela, quanto já foi pago).
function linhaPainelHTML(conta) {
  // O rótulo do tipo não entra: o título do bloco já diz de que lista é aquilo,
  // e em coluna estreita cada palavra a mais come o nome da conta.
  const contexto = [
    dateBR(conta.vencimento),
    conta.total_parcelas > 1 ? `parc. ${conta.parcela}/${conta.total_parcelas}` : null,
    Number(conta.total_pago) > 0 ? `pago ${brl(conta.total_pago)} de ${brl(conta.valor)}` : null,
    conta.tipo === 'fornecedor' ? conta.fornecedor_nome : conta.categoria,
    conta.observacoes,
  ].filter(Boolean);

  const parcial = Number(conta.total_pago) > 0;
  const atrasada = conta.vencimento.slice(0, 10) < state.painel.hoje.slice(0, 10);
  const situacao = parcial ? 'Parcial' : atrasada ? 'Atrasada' : 'Em aberto';
  const classeSituacao = parcial ? 'parcial' : atrasada ? 'atrasada' : 'aberta';

  const baixaAberta = state.baixaAbertaId === conta.id;

  // Tudo numa linha só: descrição e contexto correm juntos e cortam com "…" se
  // não couberem, para o valor e o botão nunca descerem para outra linha. A
  // situação vira a cor da barra à esquerda em vez de uma etiqueta escrita —
  // numa coluna estreita, a etiqueta comia o nome da conta.
  return `
    <div class="linha-painel situacao-${classeSituacao}" title="${situacao} · ${escapar(conta.descricao)}">
      <div class="linha-painel-info">
        <strong>${escapar(conta.descricao)}</strong>
        <small>${escapar(contexto.join(' · '))}</small>
      </div>
      <div class="linha-painel-acao">
        <span class="linha-painel-valor">${brl(conta.saldo)}</span>
        ${
          podeGerenciar()
            ? `<button data-action="toggle-baixa" data-id="${conta.id}">${baixaAberta ? 'Cancelar' : 'Pagar'}</button>`
            : ''
        }
      </div>
    </div>
    ${
      baixaAberta && podeGerenciar()
        ? `<form data-action="form-baixa" data-id="${conta.id}" class="form-inline form-baixa-painel">
            <label>Valor <input type="number" step="0.01" min="0.01" name="valor" required value="${conta.saldo > 0 ? conta.saldo : ''}" /></label>
            <label>Data <input type="date" name="data_pagamento" required value="${todayISO()}" /></label>
            ${camposFormaEBancoHTML({ forma: conta.forma_prevista })}
            <button type="submit">Confirmar pagamento</button>
          </form>`
        : ''
    }
  `;
}

// Como esse lançamento costuma ser pago. É previsão, não baixa: serve para
// separar as listas e para já vir escolhido na hora de pagar.
function campoFormaPrevistaHTML(atual) {
  return `
    <label>Como costuma pagar
      <select name="forma_prevista">
        <option value="">— não definido —</option>
        ${state.formasPagamento
          .map(
            (f) =>
              `<option value="${escapar(f.nome)}" ${f.nome === atual ? 'selected' : ''}>${escapar(f.nome)}</option>`
          )
          .join('')}
      </select>
    </label>
  `;
}

// Forma e banco saem dos Cadastros e são iguais em toda baixa — no painel e na
// tela de contas. A forma é guardada pelo nome (é assim que o histórico
// importado já está), o banco por id, que é chave estrangeira. Nada vem
// escolhido de antemão: forma de pagamento errada por descuido é registro errado.
function camposFormaEBancoHTML(selecionados = {}) {
  return `
    <label>Forma de pagamento
      <select name="forma_pagamento" required ${state.formasPagamento.length ? '' : 'disabled'}>
        ${
          state.formasPagamento.length
            ? `<option value="">— escolha —</option>${state.formasPagamento
                .map(
                  (f) =>
                    `<option value="${escapar(f.nome)}" ${f.nome === selecionados.forma ? 'selected' : ''}>${escapar(f.nome)}</option>`
                )
                .join('')}`
            : '<option value="">— cadastre em Cadastros › Formas de pagamento —</option>'
        }
      </select>
    </label>
    <label>Banco
      <select name="banco_id">
        <option value="">— sem banco —</option>
        ${state.bancos
          .map(
            (b) =>
              `<option value="${b.id}" ${String(b.id) === String(selecionados.banco) ? 'selected' : ''}>${escapar(b.nome)}</option>`
          )
          .join('')}
      </select>
    </label>
  `;
}

// Formulário da baixa. O valor vem preenchido com o saldo mas é editável — é
// nele que se registra o que foi pago de verdade, inclusive pagamento parcial.
// Forma e banco saem dos Cadastros, não de texto livre.
function formBaixaHTML(conta) {
  return `
    <div class="nova-baixa">
      <form data-action="form-baixa" data-id="${conta.id}" class="form-inline">
        <label>Valor pago
          <input type="number" step="0.01" min="0.01" name="valor" required value="${conta.saldo > 0 ? conta.saldo : ''}" />
        </label>
        <label>Data <input type="date" name="data_pagamento" required value="${todayISO()}" /></label>
        ${camposFormaEBancoHTML({ forma: conta.forma_prevista })}
        <button type="submit">Confirmar pagamento</button>
      </form>
      <p class="vazio">Saldo em aberto: <strong>${brl(conta.saldo)}</strong>${
        Number(conta.total_pago) > 0 ? ` &middot; já pago ${brl(conta.total_pago)} de ${brl(conta.valor)}` : ''
      }. Pagou menos? Ajuste o valor — a conta continua pendente pela diferença.</p>
    </div>
  `;
}

function blocoPainelHTML({ titulo, icone, bloco, classe, vazio, extra = '', rodape = '' }) {
  return `
    <section class="bloco-painel ${classe}">
      <div class="bloco-cabecalho">
        <h2>${icone} ${titulo}</h2>
        <span class="bloco-resumo">
          ${bloco.quantidade} conta(s)${bloco.quantidade ? ` &middot; <strong>${brl(bloco.total)}</strong>` : ''}
          ${bloco.atrasadas ? `<span class="badge atrasada">${bloco.atrasadas} atrasada(s)</span>` : ''}
        </span>
        ${extra}
      </div>
      ${bloco.quantidade ? bloco.contas.map(linhaPainelHTML).join('') : `<p class="vazio">${vazio}</p>`}
      ${rodape}
    </section>
  `;
}

function painelHTML() {
  const cabecalho = cabecalhoHTML('Painel do dia');

  if (!state.painel) {
    return `${cabecalho}${state.carregando ? '<p>Carregando…</p>' : ''}`;
  }

  const p = state.painel;

  const TITULOS_FILTRO = {
    hoje: 'Boletos vencendo hoje',
    ontem: 'Boletos que venceram ontem',
    atrasados: 'Boletos atrasados',
    semana: 'Boletos dos próximos 7 dias',
  };

  // Opções dos blocos fixos. `ate_hoje` é o padrão e é o recorte que o dono quer
  // ver ao abrir o painel: o que já venceu mais o que vence hoje.
  const OPCOES_FIXOS = [
    ['ate_hoje', 'Vencidas e de hoje'],
    ['atrasados', 'Só as vencidas'],
    ['hoje', 'Só as de hoje'],
    ['semana', 'Até 7 dias à frente'],
    ['todos', 'Todas as pendentes'],
  ];

  const seletorHTML = (id, opcoes, atual) => `
    <select id="${id}">
      ${opcoes
        .map(([valor, rotulo]) => `<option value="${valor}" ${atual === valor ? 'selected' : ''}>${rotulo}</option>`)
        .join('')}
    </select>
  `;

  const seletor = seletorHTML('filtro-boletos', [
    ['hoje', 'Vencendo hoje'],
    ['ontem', 'Venceram ontem'],
    ['atrasados', 'Todos os atrasados'],
    ['semana', 'Próximos 7 dias'],
  ], p.filtro);

  // Rodapé dos blocos fixos: avisa que existe coisa fora do recorte, sem listar.
  const restante = (bloco, comoVer) =>
    bloco.em_aberto_total > bloco.quantidade
      ? `<p class="vazio">Há <strong>${bloco.em_aberto_total}</strong> pendente(s) no total
         (${brl(bloco.em_aberto_valor)}). ${comoVer}</p>`
      : '';

  const b = p.boletos;
  // Nota de rodapé do bloco: mostra que existe mais fora do recorte, sem listar.
  const resumoBoletos =
    b.em_aberto_total > b.quantidade
      ? `<p class="vazio">Ao todo há <strong>${b.em_aberto_total}</strong> boleto(s) em aberto
         (${brl(b.em_aberto_valor)})${b.em_aberto_atrasados ? `, sendo ${b.em_aberto_atrasados} atrasado(s)` : ''}.
         A lista completa fica em <strong>Contas a pagar</strong>.</p>`
      : '';

  return `
    ${cabecalho}
    <p class="usuario-atual">Referência: ${dateBR(p.hoje)}</p>

    ${faixaVendasHTML()}
    ${avisoFolhaHTML()}

    <div class="colunas-painel">
      ${blocoPainelHTML({
        titulo: 'Despesas fixas',
        icone: '📌',
        bloco: p.fixas,
        classe: 'fixas',
        vazio: 'Nenhuma despesa fixa neste recorte.',
        extra: seletorHTML('filtro-fixas', OPCOES_FIXOS, p.filtro_fixas),
        rodape: restante(p.fixas, 'As que vencem depois aparecem mudando o seletor acima.'),
      })}

      ${blocoPainelHTML({
        titulo: 'Impostos',
        icone: '🧾',
        bloco: p.impostos,
        classe: 'impostos',
        vazio: 'Nenhum imposto neste recorte.',
        extra: seletorHTML('filtro-impostos', OPCOES_FIXOS, p.filtro_impostos),
        rodape: restante(p.impostos, 'Os que vencem depois aparecem mudando o seletor acima.'),
      })}

      ${blocoPainelHTML({
        titulo: 'Outras despesas',
        icone: '🧰',
        bloco: p.despesas,
        classe: 'despesas',
        vazio: 'Nenhuma outra despesa neste recorte.',
        extra: seletorHTML('filtro-despesas', OPCOES_FIXOS, p.filtro_despesas),
        rodape: restante(p.despesas, 'As que vencem depois aparecem mudando o seletor acima.'),
      })}
    </div>

    ${blocoPainelHTML({
      titulo: TITULOS_FILTRO[p.filtro],
      icone: '📄',
      bloco: b,
      classe: 'boletos',
      vazio: 'Nenhum boleto neste filtro.',
      extra: seletor,
      rodape: resumoBoletos,
    })}
  `;
}

const ADQUIRENTES_UI = [
  { valor: 'cielo', rotulo: 'Cielo' },
  { valor: 'stone', rotulo: 'Stone' },
  { valor: 'itau', rotulo: 'Rede / Itaú' },
  { valor: 'tickets', rotulo: 'Tickets / Parceiros' },
];

function importarExtratoHTML() {
  const e = state.extrato;

  return `
    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Importar extrato</h2></div>
      <p class="vazio">
        Baixe o relatório de vendas no site do adquirente e carregue aqui (.xlsx ou .csv).
        Vendas de voucher vão para <strong>Tickets</strong> automaticamente, mesmo vindo
        do arquivo da Stone ou da Rede. Recarregar um período já importado
        <strong>atualiza</strong>, não duplica.
      </p>

      <form data-action="extrato-analisar" class="form-inline">
        <label>Adquirente
          <select name="adquirente">
            ${ADQUIRENTES_UI.map(
              (a) => `<option value="${a.valor}" ${state.extratoAdquirente === a.valor ? 'selected' : ''}>${a.rotulo}</option>`
            ).join('')}
          </select>
        </label>
        <label>Arquivo <input type="file" name="arquivo" accept=".xlsx,.csv" /></label>
        <button type="submit" ${state.extratoArquivo ? '' : 'disabled'}>Conferir antes de importar</button>
      </form>

      ${state.extratoArquivo ? `<p class="vazio">Arquivo: <strong>${state.extratoArquivo.nome}</strong></p>` : ''}
      ${state.extratoCarregando ? '<p>Lendo a planilha…</p>' : ''}

      ${
        e && !e.reconhecido
          ? `<div class="alerta erro">
              Não reconheci as colunas desta planilha. Colunas encontradas:
              ${e.colunas.map((c) => `<code>${c.titulo || '(vazia)'}</code>`).join(', ')}.
              Me mande esse arquivo que eu ajusto o sistema para ele.
            </div>`
          : ''
      }

      ${
        e && e.reconhecido && e.previa
          ? `<div class="alerta aviso">
              <strong>Confira antes de gravar.</strong> Nada foi importado ainda.
            </div>
            <table class="tabela-contas">
              <thead><tr><th>Coluna do arquivo</th><th>Entendi como</th></tr></thead>
              <tbody>
                ${Object.entries(e.mapa)
                  .map(([campo, indice]) => {
                    const col = e.colunas[indice];
                    return `<tr><td>${col ? col.titulo : `coluna ${indice}`}</td><td>${ROTULO_CAMPO[campo] || campo}</td></tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
            <p class="vazio">
              <strong>${e.previa.total}</strong> transações
              ${e.previa.periodo ? `de ${dateBR(e.previa.periodo.de)} a ${dateBR(e.previa.periodo.ate)}` : ''}
              ${e.previa.ignoradas ? ` &middot; ${e.previa.ignoradas} linha(s) sem data ignorada(s)` : ''}
            </p>
            <table class="tabela-contas">
              <thead><tr><th>Vai para</th><th>Transações</th><th>Bruto</th></tr></thead>
              <tbody>
                ${Object.entries(e.previa.por_tipo)
                  .map(([tipo, v]) => `<tr><td>${rotuloAdquirente(tipo)}</td><td>${v.quantidade}</td><td>${brl(v.bruto)}</td></tr>`)
                  .join('')}
              </tbody>
            </table>
            <button id="btn-extrato-importar">Importar de verdade</button>`
          : ''
      }

      ${
        state.extratoResultado
          ? `<div class="alerta sucesso">
              <strong>Importado.</strong>
              ${state.extratoResultado.novas} nova(s) e
              ${state.extratoResultado.atualizadas} já existente(s) atualizada(s).
            </div>`
          : ''
      }
    </section>
  `;
}

const ROTULO_CAMPO = {
  data: 'Data da venda',
  hora: 'Hora',
  forma: 'Forma de pagamento',
  bandeira: 'Bandeira',
  valorBruto: 'Valor bruto',
  tarifa: 'Taxa / tarifa',
  valorLiquido: 'Valor líquido',
  status: 'Status',
};

function rotuloAdquirente(tipo) {
  const a = ADQUIRENTES_UI.find((x) => x.valor === tipo);
  return a ? a.rotulo : tipo;
}

function conciliacaoHTML() {
  const cabecalho = cabecalhoHTML('Conciliação');
  if (!state.conciliacao) {
    return `${cabecalho}${state.carregando ? '<p>Carregando…</p>' : ''}`;
  }

  const c = state.conciliacao;
  return `
    ${cabecalho}
    ${podeGerenciar() ? importarExtratoHTML() : ''}

    <div class="cartoes-resumo">
      <div class="cartao-resumo proximos">
        <span class="rotulo">Bruto (cartões)</span>
        <strong>${brl(c.totais_cartao.bruto)}</strong>
        <small>${c.totais_cartao.transacoes} transação(ões)</small>
      </div>
      <div class="cartao-resumo vencidas">
        <span class="rotulo">Tarifas</span>
        <strong>${brl(c.totais_cartao.tarifa)}</strong>
        <small>descontado pelas adquirentes</small>
      </div>
      <div class="cartao-resumo hoje">
        <span class="rotulo">Líquido (cartões)</span>
        <strong>${brl(c.totais_cartao.liquido)}</strong>
        <small>o que efetivamente entra</small>
      </div>
      <div class="cartao-resumo proximos">
        <span class="rotulo">Dinheiro conferido</span>
        <strong>${brl(c.dinheiro.total)}</strong>
        <small>${c.dinheiro.por_pdv.length} PDV(s)</small>
      </div>
    </div>

    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Por adquirente</h2></div>
      <table class="tabela-contas">
        <thead><tr><th>Adquirente</th><th>Transações</th><th>Bruto</th><th>Tarifa</th><th>Líquido</th><th>Período</th></tr></thead>
        <tbody>
          ${c.por_adquirente
            .map(
              (a) => `<tr>
                <td>${a.rotulo}</td>
                <td>${a.transacoes}</td>
                <td>${brl(a.bruto)}</td>
                <td>${brl(a.tarifa)}</td>
                <td>${brl(a.liquido)}</td>
                <td>${a.primeira_data ? `${dateBR(a.primeira_data)} a ${dateBR(a.ultima_data)}` : '—'}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Dinheiro por PDV</h2>
        <span class="grupo-total">${brl(c.dinheiro.total)}</span>
      </div>
      ${
        c.dinheiro.por_pdv.length
          ? `<table class="tabela-contas">
              <thead><tr><th>PDV</th><th>Lançamentos</th><th>Total</th></tr></thead>
              <tbody>
                ${c.dinheiro.por_pdv
                  .map((p) => `<tr><td>PDV ${p.pdv}</td><td>${p.lancamentos}</td><td>${brl(p.total)}</td></tr>`)
                  .join('')}
              </tbody>
            </table>`
          : '<p class="vazio">Nenhum lançamento de dinheiro.</p>'
      }
    </section>
  `;
}

// Aviso de folha em aberto. Mostra só que existe pendência e desde quando —
// nome e valor continuam atrás da senha da folha.
function avisoFolhaHTML() {
  const p = state.folhaPendencias;
  if (!p || !p.pendentes) return '';

  const [ano, mes] = (p.desde || '').split('-');
  return `
    <section class="faixa-vendas pendente faixa-folha">
      <div>
        <strong>Folha: ${p.pendentes} pendência(s)</strong>
        <small>${p.desde ? `A mais antiga é de ${mes}/${ano}.` : ''} Abra a folha para conferir.</small>
      </div>
      <button data-tab="folha">Abrir folha</button>
    </section>
  `;
}

// ── Resumo de vendas ─────────────────────────────────────────────────────────
// A pergunta "estou vendendo bem?" só tem resposta se a série estiver completa,
// então o dia em branco aparece com o mesmo destaque de um número ruim.

function variacaoHTML(pct) {
  if (pct === null || pct === undefined) return '<small class="variacao neutra">sem base para comparar</small>';
  const sinal = pct >= 0 ? '+' : '';
  const classe = pct >= 0 ? 'sobe' : 'desce';
  return `<small class="variacao ${classe}">${sinal}${pct.toFixed(1).replace('.', ',')}%</small>`;
}

function cartaoVendaHTML(titulo, valor, comparacao, pct) {
  return `
    <div class="cartao-venda">
      <span class="rotulo">${titulo}</span>
      <strong>${valor === null ? '—' : brl(valor)}</strong>
      <span class="comparacao">${comparacao} ${variacaoHTML(pct)}</span>
    </div>
  `;
}

// Faixa do painel: um lembrete que aparece todo dia, no lugar em que o dono já
// olha. É o que impede a série de virar um buraco de duas semanas.
function faixaVendasHTML() {
  const r = state.resumoVendas;
  if (!r) return '';

  const pendentes = r.faltando.filter((d) => d !== r.hoje);

  if (!r.lancado_hoje) {
    return `
      <section class="faixa-vendas pendente">
        <div>
          <strong>Venda de hoje ainda não lançada.</strong>
          <small>
            ${
              pendentes.length
                ? `E faltam <strong>${pendentes.length}</strong> dia(s) das últimas duas semanas.`
                : 'O resto das duas últimas semanas está em dia.'
            }
            ${r.ultimo_lancamento ? `Último lançamento: ${dateBR(r.ultimo_lancamento)}.` : ''}
          </small>
        </div>
        <button data-tab="acumulado">Lançar agora</button>
      </section>
    `;
  }

  return `
    <section class="faixa-vendas">
      <div>
        <strong>Venda de hoje: ${brl(r.total_hoje)}</strong>
        <small>
          ${variacaoHTML(r.variacao_semana)} vs. mesmo dia da semana passada &middot;
          últimos 7 dias ${brl(r.ultimos_7)} ${variacaoHTML(r.variacao_7)}
          ${pendentes.length ? ` &middot; <strong>${pendentes.length}</strong> dia(s) sem lançar` : ''}
        </small>
      </div>
      <button data-tab="acumulado">Ver acumulado</button>
    </section>
  `;
}

// Gráfico de colunas em CSS puro. O valor fica escrito em cima da barra: ter que
// caçar com o mouse para saber quanto foi um dia derrota o propósito do gráfico.
// Por isso são 14 dias e não 30 — com 30 barras não cabe rótulo nenhum.
function graficoColunasHTML(itens, { legenda }) {
  const maior = Math.max(...itens.map((i) => Number(i.valor)), 1);

  return `
    <div class="grafico-colunas">
      ${itens
        .map((i) => {
          const altura = Math.max((Number(i.valor) / maior) * 100, i.vazio ? 0 : 3);
          return `
            <div class="coluna ${i.vazio ? 'vazia' : ''}" title="${escapar(i.titulo)}">
              <div class="barra-area">
                <span class="valor">${i.vazio ? '—' : brlCurto(i.valor)}</span>
                <div class="barra" style="height: ${altura}%"></div>
              </div>
              <span class="rotulo">${escapar(i.rotulo)}</span>
            </div>`;
        })
        .join('')}
    </div>
    ${legenda ? `<p class="grafico-legenda-simples">${legenda}</p>` : ''}
  `;
}

function graficoVendasHTML(serie) {
  const dias = serie.slice(-14).map((d) => ({
    valor: d.total,
    vazio: !d.lancado,
    rotulo: String(d.data).slice(8, 10),
    titulo: `${dateBR(d.data)}: ${d.lancado ? brl(d.total) : 'sem lançamento'}`,
  }));

  return graficoColunasHTML(dias, {
    legenda: 'Últimos 14 dias &middot; coluna vazia (—) é dia sem lançamento',
  });
}

function graficoMesesHTML(meses) {
  const itens = meses.map((m) => {
    const parcial = m.dias_lancados > 0 && m.dias_lancados < m.dias_no_mes;
    return {
      valor: m.total,
      vazio: !m.dias_lancados,
      rotulo: mesCurto(m.mes) + (parcial ? '*' : ''),
      titulo: `${mesCurto(m.mes)}: ${brl(m.total)} em ${m.dias_lancados} de ${m.dias_no_mes} dia(s) lançados`,
    };
  });

  const temParcial = meses.some((m) => m.dias_lancados > 0 && m.dias_lancados < m.dias_no_mes);
  return graficoColunasHTML(itens, {
    legenda: temParcial
      ? 'Mês com <strong>*</strong> tem dias sem lançamento — o total dele está incompleto'
      : 'Últimos 6 meses',
  });
}

function resumoVendasHTML() {
  const r = state.resumoVendas;
  if (!r) return '';

  const pendentes = r.faltando.filter((d) => d !== r.hoje);

  return `
    <section class="cartoes-resumo cartoes-venda">
      ${cartaoVendaHTML('Hoje', r.total_hoje, 'mesmo dia da semana passada', r.variacao_semana)}
      ${cartaoVendaHTML('Últimos 7 dias', r.ultimos_7, '7 dias anteriores', r.variacao_7)}
      ${cartaoVendaHTML('Mês até hoje', r.mes_atual, 'mesmo período do mês passado', r.variacao_mes)}
    </section>

    ${
      pendentes.length
        ? `<div class="alerta aviso">
            <p><strong>${pendentes.length} dia(s) sem lançamento</strong> nas últimas duas semanas.
            Clique na data para lançar:</p>
            <div class="acoes-alerta">
              ${pendentes
                .map((d) => `<button type="button" data-action="lancar-dia" data-dia="${d}" class="secundario">${dateBR(d)}</button>`)
                .join('')}
            </div>
          </div>`
        : ''
    }

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Venda por dia</h2>
        <span class="grupo-total">${brl(r.mes_atual)} <small>no mês</small></span>
      </div>
      ${graficoVendasHTML(r.ultimos_30)}
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Mês a mês</h2>
        <span class="grupo-total">${brl(r.mes_anterior)} <small>no mês passado</small></span>
      </div>
      ${graficoMesesHTML(r.por_mes || [])}
    </section>
  `;
}

const ROTULO_ADQUIRENTE = { cielo: 'Cielo', stone: 'Stone', itau: 'Rede / Itaú', tickets: 'Tickets / Vouchers' };

// A conciliação sabe o cartão e o ticket do dia; o PDV sabe o dinheiro. Em vez de
// gravar sozinho, mostra o que existe e diz o que falta — um dia com só um
// adquirente importado daria um fechamento pela metade com cara de fechado.
function sugestaoHTML() {
  const s = state.sugestaoDia;
  // O título segue o dia consultado, não o do formulário: os dois se separam no
  // instante em que a pessoa troca a data para conferir outro dia.
  const dia = (s && s.data) || state.diaAcumulado || todayISO();

  const corpo = () => {
    if (state.sugestaoCarregando) return '<p class="vazio">Consultando a conciliação…</p>';
    if (!s) {
      return `<p class="vazio">Veja o que os extratos já importados trazem para esse dia
        e use como base do fechamento.</p>`;
    }

    const semDados = !s.por_adquirente.length && !s.sugestao.dinheiro;
    const importadoAte = Object.entries(s.importado_ate)
      .map(([a, ate]) => `${ROTULO_ADQUIRENTE[a] || a} até ${dateBR(ate)}`)
      .join(' &middot; ');

    const presentes = new Set(s.por_adquirente.map((a) => a.adquirente));
    const faltando = ['cielo', 'stone', 'itau'].filter((a) => !presentes.has(a));

    return `
      ${
        semDados
          ? `<p class="vazio">Nenhuma transação importada para ${dateBR(s.data)}.
             ${importadoAte ? `Importado até: ${importadoAte}.` : 'Nenhum extrato importado ainda.'}
             Extrato de adquirente costuma sair só no dia seguinte.</p>`
          : `<table class="tabela-contas tabela-pagamentos">
              <thead><tr><th>Origem</th><th>Transações</th><th>Bruto</th></tr></thead>
              <tbody>
                ${s.por_adquirente
                  .map(
                    (a) => `<tr>
                      <td>${ROTULO_ADQUIRENTE[a.adquirente] || a.adquirente}</td>
                      <td>${a.transacoes}</td>
                      <td>${brl(a.bruto)}</td>
                    </tr>`
                  )
                  .join('')}
                ${
                  s.sugestao.dinheiro
                    ? `<tr><td>Dinheiro (PDV)</td><td>${s.dinheiro_lancamentos}</td><td>${brl(s.sugestao.dinheiro)}</td></tr>`
                    : ''
                }
              </tbody>
            </table>
            ${
              faltando.length
                ? `<p class="vazio"><strong>Atenção:</strong>
                   ${faltando.map((a) => ROTULO_ADQUIRENTE[a]).join(' e ')}
                   sem transação nesse dia — se o extrato ainda não foi importado, o total fica incompleto.
                   ${importadoAte ? `Importado até: ${importadoAte}.` : ''}</p>`
                : ''
            }
            <div class="acoes-alerta">
              <button type="button" data-action="usar-sugestao">Usar no formulário</button>
            </div>`
      }
    `;
  };

  return `
    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Conciliação do dia ${dateBR(dia)}</h2>
        <button type="button" data-action="consultar-sugestao" class="secundario">
          ${s ? 'Atualizar' : 'Consultar extratos'}
        </button>
      </div>
      ${corpo()}
    </section>
  `;
}

function acumuladoHTML() {
  const cabecalho = cabecalhoHTML('Acumulado');
  if (!state.acumulados) {
    return `${cabecalho}${state.carregando ? '<p>Carregando…</p>' : ''}`;
  }

  const { acumulados, totais } = state.acumulados;
  return `
    ${cabecalho}

    ${resumoVendasHTML()}

    ${sugestaoHTML()}

    <section class="cartoes-form">
      <form data-action="novo-acumulado" class="form-inline">
        <h2>Conferência do dia</h2>
        <label>Data <input type="date" name="data" required value="${state.diaAcumulado || todayISO()}" /></label>
        <label>Dinheiro <input type="number" step="0.01" name="dinheiro" /></label>
        <label>Cartão (TEF) <input type="number" step="0.01" name="cartao" /></label>
        <label>PIX <input type="number" step="0.01" name="pix" /></label>
        <label>Tickets <input type="number" step="0.01" name="tickets" /></label>
        <label>Maquininha fora <input type="number" step="0.01" name="pos_maquina" /></label>
        <label>Outras <input type="number" step="0.01" name="outras" /></label>
        <label class="campo-largo">Observações <input type="text" name="observacoes" placeholder="ex.: PDV 2 fechou 5,00 a menos" /></label>
        <button type="submit">Salvar</button>
      </form>
    </section>
    <p class="usuario-atual">Uma conferência por dia — salvar a mesma data atualiza o registro existente.</p>

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Últimos fechamentos</h2>
        <span class="grupo-total">${brl(totais.total)} <small>em ${acumulados.length} dia(s)</small></span>
        ${
          acumulados.length > 7
            ? `<button type="button" id="btn-historico" class="secundario">${
                state.historicoCompleto ? 'Mostrar só os últimos 7' : `Ver todos os ${acumulados.length}`
              }</button>`
            : ''
        }
      </div>
      ${
        acumulados.length
          ? `<table class="tabela-contas">
              <thead><tr><th>Data</th><th>Dinheiro</th><th>Cartão</th><th>PIX</th><th>Tickets</th><th>Maq. fora</th><th>Outras</th><th>Total</th><th>Ações</th></tr></thead>
              <tbody>
                ${(state.historicoCompleto ? acumulados : acumulados.slice(0, 7))
                  .map(
                    (a) => `<tr>
                      <td>${dateBR(a.data)}</td>
                      <td>${brl(a.dinheiro)}</td>
                      <td>${brl(a.cartao)}</td>
                      <td>${brl(a.pix)}</td>
                      <td>${brl(a.tickets)}</td>
                      <td>${brl(Number(a.pos_maquina) + Number(a.pos_sistema))}</td>
                      <td>${brl(a.outras)}</td>
                      <td><strong>${brl(a.total)}</strong>${a.observacoes ? `<br /><small>${escapar(a.observacoes)}</small>` : ''}</td>
                      <td><button data-action="excluir-acumulado" data-id="${a.id}" class="perigo">Excluir</button></td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
          : '<p class="vazio">Nenhuma conferência registrada.</p>'
      }
    </section>
  `;
}

function vendaPrazoHTML() {
  const cabecalho = cabecalhoHTML('Venda a prazo');
  if (!state.vendaPrazo) return `${cabecalho}${state.carregando ? '<p>Carregando…</p>' : ''}`;

  const { clientes, totais } = state.vendaPrazo;
  const comSaldo = clientes.filter((c) => c.saldo !== 0 || c.movimentos > 0);

  return `
    ${cabecalho}

    <div class="cartoes-resumo">
      <div class="cartao-resumo vencidas">
        <span class="rotulo">A receber</span>
        <strong>${brl(totais.saldo)}</strong>
        <small>${totais.clientes_com_saldo} cliente(s) devendo</small>
      </div>
      <div class="cartao-resumo proximos">
        <span class="rotulo">Compras lançadas</span>
        <strong>${brl(totais.compras)}</strong>
      </div>
      <div class="cartao-resumo hoje">
        <span class="rotulo">Já pago</span>
        <strong>${brl(totais.pago)}</strong>
      </div>
    </div>

    <section class="cartoes-form">
      <form data-action="novo-mov-prazo" class="form-inline">
        <h2>Lançar movimento</h2>
        <label>Cliente
          <select name="cliente_id" required>
            ${clientes.map((c) => `<option value="${c.id}">${c.codigo ? `${c.codigo} — ` : ''}${c.nome}</option>`).join('')}
          </select>
        </label>
        <label>Tipo
          <select name="tipo">
            <option value="compra">Compra (fiado)</option>
            <option value="pagamento">Pagamento do cliente</option>
          </select>
        </label>
        <label>Valor <input type="number" step="0.01" min="0" name="valor" required /></label>
        <label>Data <input type="date" name="data" required value="${todayISO()}" /></label>
        <button type="submit">Lançar</button>
      </form>
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Clientes</h2></div>
      <table class="tabela-contas">
        <thead><tr><th>Código</th><th>Cliente</th><th>Compras</th><th>Pago</th><th>Saldo</th><th>Movs</th><th>Último</th></tr></thead>
        <tbody>
          ${
            comSaldo.length
              ? comSaldo
                  .map(
                    (c) => `<tr>
                      <td>${c.codigo || '—'}</td>
                      <td>${c.nome}</td>
                      <td>${brl(c.total_compras)}</td>
                      <td>${brl(c.total_pago)}</td>
                      <td><strong>${brl(c.saldo)}</strong></td>
                      <td>${c.movimentos}</td>
                      <td>${c.ultimo_movimento ? dateBR(c.ultimo_movimento) : '—'}</td>
                    </tr>`
                  )
                  .join('')
              : '<tr><td colspan="7">Nenhum movimento lançado.</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;
}

const CADASTROS = [
  { chave: 'clientes', rotulo: 'Clientes' },
  { chave: 'funcionarios', rotulo: 'Funcionários' },
  { chave: 'bancos', rotulo: 'Bancos' },
  { chave: 'formas-pagamento', rotulo: 'Formas de pagamento' },
];

function cadastrosHTML() {
  const cabecalho = cabecalhoHTML('Cadastros');
  const tipo = state.cadastroTipo;
  const registros = state.cadastros || [];

  const colunas = {
    clientes: ['codigo', 'nome', 'telefone', 'cpf_cnpj'],
    funcionarios: ['codigo', 'nome', 'telefone', 'cpf', 'pix'],
    bancos: ['nome'],
    'formas-pagamento': ['nome'],
  }[tipo];

  const rotulos = {
    codigo: 'Código', nome: 'Nome', telefone: 'Telefone',
    cpf_cnpj: 'CPF/CNPJ', cpf: 'CPF', pix: 'PIX',
  };

  const ajuda = {
    'formas-pagamento':
      'Estas são as opções que aparecem ao dar baixa em uma conta (Dinheiro, PIX, Boleto…).',
    bancos: 'Os bancos aparecem na baixa, para registrar de onde o dinheiro saiu.',
  }[tipo];

  return `
    ${cabecalho}

    <div class="sub-abas">
      ${CADASTROS.map(
        (c) => `<button data-cadastro="${c.chave}" class="${tipo === c.chave ? 'ativo' : ''}">${c.rotulo}</button>`
      ).join('')}
    </div>

    ${ajuda ? `<p class="vazio">${ajuda}</p>` : ''}

    <section class="cartoes-form">
      <form data-action="novo-cadastro" class="form-inline">
        <h2>Novo</h2>
        ${colunas
          .map(
            (c) => `<label>${rotulos[c] || c} <input type="text" name="${c}" ${c === 'nome' ? 'required' : ''} /></label>`
          )
          .join('')}
        <button type="submit">Adicionar</button>
      </form>
    </section>

    ${state.carregando ? '<p>Carregando…</p>' : ''}

    <table class="tabela-contas">
      <thead><tr>${colunas.map((c) => `<th>${rotulos[c] || c}</th>`).join('')}<th>Ações</th></tr></thead>
      <tbody>
        ${
          registros.length
            ? registros
                .map(
                  (r) => `<tr>
                    ${colunas.map((c) => `<td>${r[c] || '—'}</td>`).join('')}
                    <td class="acoes"><div class="acoes-linha">${podeGerenciar() ? `<button data-action="excluir-cadastro" data-id="${r.id}" class="perigo">Excluir</button>` : ''}</div></td>
                  </tr>`
                )
                .join('')
            : `<tr><td colspan="${colunas.length + 1}">Nenhum registro.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

// Primeiro e último dia do mês escolhido, no fuso da loja. Sem recorte, devolve
// null e a folha vem inteira.
function periodoDaFolha() {
  if (!state.folhaMes) return null;
  const hoje = new Date(`${todayISO()}T12:00:00`);
  const mes = state.folhaMes === 'anterior' ? hoje.getMonth() - 1 : hoje.getMonth();
  const inicio = new Date(hoje.getFullYear(), mes, 1);
  const fim = new Date(hoje.getFullYear(), mes + 1, 0);
  const iso = (d) => d.toLocaleDateString('en-CA');
  return { de: iso(inicio), ate: iso(fim) };
}

function folhaHTML() {
  const cabecalho = cabecalhoHTML('Folha de pagamento');

  // Sem a senha adicional a folha nem carrega — nenhum nome ou valor aparece.
  if (!getFolhaToken() || !state.folha) {
    return `
      ${cabecalho}
      <div class="login-wrap" style="min-height:auto;padding:40px 0">
        <form id="form-folha-senha" class="login-card">
          <h1>Folha trancada</h1>
          <p class="subtitulo">Informe a senha da folha para ver salários e extras.</p>
          ${state.folhaErro ? `<div class="alerta erro">${state.folhaErro}</div>` : ''}
          <label>Senha da folha</label>
          <input type="password" name="senha" required autocomplete="off" />
          <button type="submit">Destravar</button>
        </form>
      </div>
    `;
  }

  const { lancamentos, totais } = state.folha;
  const extras = state.extras || { extras: [], totais: { valor: 0, saldo: 0 } };

  return `
    ${cabecalho}

    <div class="cartoes-resumo">
      <div class="cartao-resumo proximos">
        <span class="rotulo">Líquido total</span><strong>${brl(totais.liquido)}</strong>
      </div>
      <div class="cartao-resumo hoje">
        <span class="rotulo">Já pago</span><strong>${brl(totais.pago)}</strong>
      </div>
      <div class="cartao-resumo vencidas">
        <span class="rotulo">Em aberto</span><strong>${brl(totais.saldo)}</strong>
      </div>
    </div>

    <section class="cartoes-form">
      <form data-action="novo-lancamento-folha" class="form-inline">
        <h2>Lançar folha do mês</h2>
        <label>Funcionário
          <select name="funcionario_id" required>
            <option value="">— escolha —</option>
            ${state.funcionarios
              .map((f) => `<option value="${f.id}">${escapar(f.nome)}</option>`)
              .join('')}
          </select>
        </label>
        <label>Referência <input type="date" name="data_ref" required value="${todayISO()}" /></label>
        <label>Salário <input type="number" step="0.01" name="salario" required /></label>
        <label>Bonificação <input type="number" step="0.01" name="bonificacao" /></label>
        <label>Compras <input type="number" step="0.01" name="compras" /></label>
        <label>Adiantamento <input type="number" step="0.01" name="adiantamento" /></label>
        <label>Descontos <input type="number" step="0.01" name="descontos" /></label>
        <button type="submit">Lançar</button>
        <p class="vazio campo-largo" id="aviso-adiantamento">
          Ao escolher o funcionário, o adiantamento vem preenchido com os vales em aberto dele —
          e lançar a folha dá baixa nesses vales.
        </p>
      </form>

      <form data-action="novo-extra" class="form-inline">
        <h2>Adiantamento / vale</h2>
        <label>Funcionário
          <select name="funcionario_id" required>
            <option value="">— escolha —</option>
            ${state.funcionarios
              .map((f) => `<option value="${f.id}">${escapar(f.nome)}</option>`)
              .join('')}
          </select>
        </label>
        <label>Valor <input type="number" step="0.01" min="0.01" name="valor" required /></label>
        <label>Data <input type="date" name="data" required value="${todayISO()}" /></label>
        <label>Observação <input type="text" name="observacoes" placeholder="ex.: pediu adiantado" /></label>
        <button type="submit">Registrar</button>
        <p class="vazio campo-largo">
          Fica em aberto até ser descontado numa folha — normalmente a do mês seguinte.
          Não entra nas despesas da empresa.
        </p>
      </form>
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Lançamentos</h2>
        <select id="filtro-folha-mes">
          <option value="atual" ${state.folhaMes === 'atual' ? 'selected' : ''}>Mês atual</option>
          <option value="anterior" ${state.folhaMes === 'anterior' ? 'selected' : ''}>Mês passado</option>
          <option value="" ${state.folhaMes === '' ? 'selected' : ''}>Todos os meses</option>
        </select>
        <button id="btn-trancar-folha">Trancar folha</button>
      </div>
      <table class="tabela-contas">
        <thead><tr><th>Funcionário</th><th>Ref.</th><th>Salário</th><th>Bonif.</th><th>Compras</th><th>Adiant.</th><th>Líquido</th><th>Pago</th><th>Saldo</th><th>Status</th></tr></thead>
        <tbody>
          ${
            lancamentos.length
              ? lancamentos
                  .map(
                    (l) => `<tr>
                <td>${escapar(l.nome)}</td>
                <td>${l.data_ref ? dateBR(l.data_ref) : '—'}</td>
                <td>${brl(l.salario)}</td>
                <td>${brl(l.bonificacao)}</td>
                <td>${brl(l.compras)}</td>
                <td>${brl(l.adiantamento)}</td>
                <td><strong>${brl(l.liquido)}</strong></td>
                <td>${brl(l.total_pago)}</td>
                <td>${brl(l.saldo)}</td>
                <td>${l.quitado ? '<span class="badge quitado">Quitada</span>' : '<span class="badge vencida">Pendente</span>'}</td>
              </tr>`
                  )
                  .join('')
              : `<tr><td colspan="10">Nenhum lançamento ${
                  state.folhaMes === 'atual' ? 'neste mês' : state.folhaMes === 'anterior' ? 'no mês passado' : ''
                }.</td></tr>`
          }
        </tbody>
      </table>
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Extras / adiantamentos</h2>
        <span class="grupo-total">${brl(extras.totais.valor)} <small>em aberto ${brl(extras.totais.saldo)}</small></span>
      </div>
      <p class="vazio">Extras não entram nas despesas da empresa — já são descontados na folha.</p>
      ${
        extras.extras.length
          ? `<table class="tabela-contas">
              <thead><tr><th>Funcionário</th><th>Tipo</th><th>Data</th><th>Valor</th><th>Baixado</th><th>Saldo</th></tr></thead>
              <tbody>
                ${extras.extras
                  .map(
                    (e) => `<tr>
                      <td>${e.nome}</td><td>${e.tipo || '—'}</td><td>${dateBR(e.data)}</td>
                      <td>${brl(e.valor)}</td><td>${brl(e.total_baixado)}</td><td>${brl(e.saldo)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
          : ''
      }
    </section>
  `;
}

function relatoriosHTML() {
  const cabecalho = cabecalhoHTML('Relatórios');
  const p = periodoOuPadrao();

  const filtro = `
    <section class="cartoes-form">
      <form data-action="filtro-periodo" class="form-inline">
        <h2>Período</h2>
        <label>De <input type="date" name="de" value="${p.de}" required /></label>
        <label>Até <input type="date" name="ate" value="${p.ate}" required /></label>
        <button type="submit">Gerar</button>
      </form>
    </section>
  `;

  if (!state.relatorio) return `${cabecalho}${filtro}${state.carregando ? '<p>Carregando…</p>' : ''}`;

  const r = state.relatorio;
  const folha = r.despesas.folha;

  return `
    ${cabecalho}
    ${filtro}

    <div class="cartoes-resumo">
      <div class="cartao-resumo vencidas">
        <span class="rotulo">Despesas pagas</span><strong>${brl(r.despesas.total)}</strong>
        <small>${dateBR(r.periodo.de)} a ${dateBR(r.periodo.ate)}</small>
      </div>
      <div class="cartao-resumo proximos">
        <span class="rotulo">Cartões (líquido)</span><strong>${brl(r.entradas.cartoes.liquido)}</strong>
        <small>${r.entradas.cartoes.transacoes} transações</small>
      </div>
      <div class="cartao-resumo hoje">
        <span class="rotulo">Dinheiro conferido</span><strong>${brl(r.entradas.dinheiro)}</strong>
      </div>
    </div>

    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Despesas por tela</h2><span class="grupo-total">${brl(r.despesas.total)}</span></div>
      <table class="tabela-contas">
        <thead><tr><th>Tela</th><th>Lançamentos</th><th>Pago</th></tr></thead>
        <tbody>
          ${r.despesas.por_tipo
            .map((t) => `<tr><td>${t.rotulo}</td><td>${t.lancamentos}</td><td>${brl(t.pago)}</td></tr>`)
            .join('')}
          ${
            folha.destravada
              ? folha.por_funcionario
                  .map((f) => `<tr><td>Folha — ${f.nome}</td><td>—</td><td>${brl(f.pago)}</td></tr>`)
                  .join('')
              : `<tr><td>${folha.rotulo}</td><td>—</td><td>${brl(folha.total)}</td></tr>`
          }
        </tbody>
      </table>
      ${
        folha.destravada
          ? ''
          : '<p class="vazio">A folha entra no total, mas os nomes só aparecem com a folha destravada.</p>'
      }
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Venda a prazo no período</h2></div>
      <table class="tabela-contas">
        <thead><tr><th>Compras lançadas</th><th>Pagamentos recebidos</th></tr></thead>
        <tbody><tr><td>${brl(r.venda_prazo.compras)}</td><td>${brl(r.venda_prazo.pagamentos)}</td></tr></tbody>
      </table>
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Extras (informativo)</h2><span class="grupo-total">${brl(r.extras_informativo.total)}</span></div>
      <p class="vazio">${r.extras_informativo.nota}</p>
    </section>
  `;
}

const ROTULOS_ACAO = {
  create: 'Cadastrou',
  update: 'Editou',
  delete: 'Excluiu',
  pagamento: 'Pagou',
  baixa: 'Baixou',
  desbloqueio: 'Destravou a folha',
  importacao: 'Importou backup',
};

function resultadoImportacaoHTML({ dry_run, resumo }) {
  const c = resumo.contasImportadas;
  const cc = resumo.conciliacao;
  const linhas = [
    ['Fornecedores', resumo.fornecedoresImportados + resumo.fornecedoresCriadosPorReferencia],
    ['Contas de fornecedor', c.fornecedor],
    ['Despesas fixas', c.fixa],
    ['Impostos', c.imposto],
    ['Outras despesas', c.despesa],
    ['Pagamentos (baixas)', resumo.pagamentosImportados],
    ['Conciliação (cartões)', cc.cielo + cc.stone + cc.itau + cc.tickets],
    ['Conciliação (dinheiro)', cc.dinheiro],
    ['Acumulados', resumo.acumulados],
    ['Clientes', resumo.clientes],
    ['Funcionários', resumo.funcionarios],
    ['Bancos', resumo.bancos],
    ['Venda a prazo', resumo.movPrazo],
    ['Folha', resumo.folha],
    ['Extras', resumo.extras],
  ].filter(([, n]) => n > 0);

  return `
    <div class="alerta ${dry_run ? 'aviso' : 'sucesso'}">
      <strong>${dry_run ? 'Simulação — nada foi gravado.' : 'Importação concluída.'}</strong>
      ${dry_run ? ' Confira os números abaixo e, se estiver certo, clique em "Importar de verdade".' : ''}
    </div>
    <table class="tabela-contas">
      <thead><tr><th>O que</th><th>Registros</th></tr></thead>
      <tbody>
        ${linhas.map(([rotulo, n]) => `<tr><td>${rotulo}</td><td>${n}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

function adminHTML() {
  const cabecalho = cabecalhoHTML('Administração');
  const a = state.auditoria;

  const backup = `
    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Exportar backup</h2></div>
      <p class="vazio">
        Baixa todos os dados em JSON, para guardar fora do sistema.
        ${getFolhaToken()
          ? 'A folha está destravada, então <strong>entra no arquivo</strong>.'
          : 'A folha está trancada, então <strong>fica fora do arquivo</strong> — destrave antes se quiser incluí-la.'}
      </p>
      <button id="btn-exportar-backup">Baixar backup JSON</button>
    </section>

    <section class="grupo-painel">
      <div class="grupo-cabecalho"><h2>Importar backup do sistema antigo</h2></div>
      <p class="vazio">
        Carrega um backup JSON exportado pela versão antiga. Pode repetir quantas vezes
        quiser: registros já importados são <strong>atualizados</strong>, não duplicados.
      </p>
      <form data-action="importar-backup" class="form-inline">
        <label>Arquivo <input type="file" name="arquivo" accept=".json,application/json" /></label>
        <button type="submit" data-modo="simular" ${state.arquivoImportacao ? '' : 'disabled'}>Simular</button>
        <button type="submit" data-modo="importar" ${state.arquivoImportacao ? '' : 'disabled'}>Importar de verdade</button>
      </form>
      ${
        state.arquivoImportacao
          ? `<p class="vazio">Arquivo carregado: <strong>${state.arquivoImportacao.nome}</strong></p>`
          : '<p class="vazio">Escolha o arquivo para liberar os botões.</p>'
      }
      ${state.importacao ? resultadoImportacaoHTML(state.importacao) : ''}
      ${state.importando ? '<p>Processando o arquivo…</p>' : ''}
    </section>
  `;

  if (!a) return `${cabecalho}${backup}${state.carregando ? '<p>Carregando…</p>' : ''}`;

  return `
    ${cabecalho}
    ${backup}

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Auditoria</h2>
        <span class="grupo-total">${a.total} registro(s) <small>mostrando ${a.registros.length}</small></span>
      </div>
      <table class="tabela-contas">
        <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Onde</th><th>Registro</th></tr></thead>
        <tbody>
          ${
            a.registros.length
              ? a.registros
                  .map(
                    (r) => `<tr>
                      <td>${new Date(r.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                      <td>${r.usuario_nome || '—'} ${r.usuario_role ? `<span class="badge role">${r.usuario_role}</span>` : ''}</td>
                      <td>${ROTULOS_ACAO[r.acao] || r.acao}</td>
                      <td>${r.entidade}</td>
                      <td>${r.entidade_id || '—'}</td>
                    </tr>`
                  )
                  .join('')
              : '<tr><td colspan="5">Nenhum registro de auditoria ainda.</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;
}

// Situações da tela de contas. "Vencidas e de hoje" é o padrão — a lista abre
// no que precisa de ação, não no histórico inteiro.
const FILTROS_STATUS = [
  ['', 'Todas'],
  ['vencidas', 'Vencidas e de hoje'],
  ['a_vencer', 'A vencer'],
  ['quitado', 'Quitadas'],
];

function textoListaVazia() {
  if (state.buscaContas.trim()) return 'Nenhum lançamento encontrado para essa busca.';
  if (state.statusFiltro === 'vencidas') return 'Nada vencido nem vencendo hoje. Tudo em dia por aqui.';
  if (state.statusFiltro === 'a_vencer') return 'Nenhum lançamento a vencer.';
  if (state.statusFiltro === 'quitado') return 'Nenhum lançamento quitado neste recorte.';
  if (state.mesFiltro === 'atual') return 'Nenhum lançamento neste mês.';
  if (state.mesFiltro === 'anterior') return 'Nenhum lançamento no mês passado.';
  return 'Nenhum lançamento cadastrado.';
}

function contasHTML() {
  const podeGerir = podeGerenciar();
  const ehFornecedor = state.tipo === 'fornecedor';
  const ehDespesa = state.tipo === 'despesa';
  const totalEmAberto = state.contas.reduce(
    (acc, c) => (c.quitado ? acc : acc + Number(c.saldo)),
    0
  );

  // Quando o lançamento foi barrado por duplicidade, o formulário volta
  // preenchido com o que foi digitado — normalmente só o valor precisa mudar.
  const pendente = (state.duplicidade && state.duplicidade.payload) || {};
  const aviso = state.duplicidade
    ? `<div class="alerta aviso">
        <p>${escapar(state.duplicidade.mensagem)}</p>
        <div class="acoes-alerta">
          <button type="button" id="btn-duplicado-confirmar">Cadastrar assim mesmo</button>
          <button type="button" id="btn-duplicado-cancelar" class="secundario">Cancelar</button>
        </div>
      </div>`
    : '';

  return `
    ${cabecalhoHTML(`Contas a pagar &middot; ${rotuloTipo(state.tipo)}`)}

    <div class="sub-abas">
      ${TIPOS.map(
        (t) => `<button data-tipo="${t.tipo}" class="${state.tipo === t.tipo ? 'ativo' : ''}">${t.rotulo}</button>`
      ).join('')}
    </div>

    ${aviso}

    <section class="cartoes-form">
      ${
        ehFornecedor
          ? `<form data-action="novo-fornecedor" class="form-inline">
              <h2>Novo fornecedor</h2>
              <label>Nome <input type="text" name="nome" required /></label>
              <button type="submit">Adicionar</button>
            </form>`
          : ''
      }

      <form data-action="nova-conta" class="form-inline">
        <h2>Novo lançamento &middot; ${rotuloTipo(state.tipo)}</h2>
        ${
          ehFornecedor
            ? `<label>Fornecedor
                <select name="fornecedor_id">
                  <option value="">— sem fornecedor —</option>
                  ${state.fornecedores
                    .map(
                      (f) =>
                        `<option value="${f.id}" ${String(pendente.fornecedor_id) === String(f.id) ? 'selected' : ''}>${escapar(f.nome)}</option>`
                    )
                    .join('')}
                </select>
              </label>`
            : ''
        }
        <label>Descrição <input type="text" name="descricao" required value="${escapar(pendente.descricao || '')}" /></label>
        ${ehDespesa ? `<label>Categoria <input type="text" name="categoria" placeholder="Manutenção, Outros..." value="${escapar(pendente.categoria || '')}" /></label>` : ''}
        <label>Valor <input type="number" step="0.01" min="0" name="valor" required value="${escapar(pendente.valor || '')}" /></label>
        <label>${ehDespesa ? 'Data' : 'Vencimento'} <input type="date" name="vencimento" required value="${escapar(pendente.vencimento || '')}" /></label>
        ${campoFormaPrevistaHTML(pendente.forma_prevista)}
        <label>Parcelas
          <input type="number" min="1" max="60" step="1" name="parcelas" value="${escapar(pendente.parcelas || 1)}" />
        </label>
        <label>A cada
          <select name="intervalo">
            <option value="mensal" ${pendente.intervalo === '7' || pendente.intervalo === '15' || pendente.intervalo === '20' || pendente.intervalo === '21' || pendente.intervalo === '30' ? '' : 'selected'}>mês (mesmo dia)</option>
            ${['7', '15', '20', '21', '30']
              .map((d) => `<option value="${d}" ${pendente.intervalo === d ? 'selected' : ''}>${d} dias</option>`)
              .join('')}
          </select>
        </label>
        <button type="submit">Cadastrar</button>
        <p class="vazio campo-largo">
          Uma parcela é o normal — deixe <strong>1</strong>. Com mais de uma, o valor informado é o
          <strong>de cada parcela</strong>, e o sistema cria todas de uma vez a partir do vencimento.
        </p>
      </form>
    </section>

    <div class="filtros">
      ${FILTROS_STATUS.map(
        ([valor, rotulo]) =>
          `<button data-status="${valor}" class="${state.statusFiltro === valor ? 'ativo' : ''}">${rotulo}</button>`
      ).join('')}
      <select id="filtro-mes" title="Recorte por mês">
        <option value="" ${state.mesFiltro === '' ? 'selected' : ''}>Todo o período</option>
        <option value="atual" ${state.mesFiltro === 'atual' ? 'selected' : ''}>Mês atual</option>
        <option value="anterior" ${state.mesFiltro === 'anterior' ? 'selected' : ''}>Mês passado</option>
      </select>
      <form class="busca" data-action="busca-contas">
        <input
          type="search"
          id="busca-contas"
          name="busca"
          placeholder="Buscar ${ehFornecedor ? 'fornecedor ou descrição' : 'descrição ou categoria'}…"
          value="${escapar(state.buscaContas)}"
          autocomplete="off"
        />
        ${state.buscaContas ? '<button type="button" id="btn-limpar-busca" class="secundario">Limpar</button>' : ''}
      </form>
      <span class="resumo-lista">${state.contas.length} lançamento(s)${state.buscaContas.trim() ? ' na busca' : ''} &middot; em aberto <strong>${brl(totalEmAberto)}</strong></span>
    </div>

    ${state.carregando ? '<p>Carregando…</p>' : ''}

    ${listaContasHTML({ ehFornecedor, ehDespesa, podeGerir })}
  `;
}

// Ordem fixa das listas por forma de pagamento. Fixa de propósito: o dono decora
// onde cada bloco fica, e lista que muda de lugar conforme o dia obriga a
// procurar de novo toda vez.
const ORDEM_FORMAS = ['PIX', 'Dinheiro', 'Transferência', 'Cartão', 'Boleto'];
const SEM_FORMA = 'Sem forma definida';

function posicaoForma(nome) {
  const i = ORDEM_FORMAS.findIndex((f) => f.toLowerCase() === String(nome).toLowerCase());
  if (i >= 0) return i;
  return nome === SEM_FORMA ? ORDEM_FORMAS.length + 1 : ORDEM_FORMAS.length;
}

// Quem se paga por PIX e quem manda boleto viram listas separadas — juntos, dá
// uma lista só, grande demais para achar o que interessa. Só agrupa quando há
// mais de uma forma em jogo; do contrário, uma tabela só, como sempre foi.
function listaContasHTML({ ehFornecedor, ehDespesa, podeGerir }) {
  const cabecalho = `
    <thead>
      <tr>
        <th>${ehFornecedor ? 'Fornecedor' : 'Categoria'}</th>
        <th>Descrição</th><th>${ehDespesa ? 'Data' : 'Vencimento'}</th><th>Pago em</th>
        <th>Valor</th><th>Saldo</th><th>Status</th>
        <th${podeGerir ? '' : ' style="display:none"'}>Ações</th>
      </tr>
    </thead>`;

  if (!state.contas.length) {
    return `<table class="tabela-contas">${cabecalho}
      <tbody><tr><td colspan="8">${textoListaVazia()}</td></tr></tbody></table>`;
  }

  const grupos = new Map();
  for (const conta of state.contas) {
    const forma = conta.forma_prevista || SEM_FORMA;
    if (!grupos.has(forma)) grupos.set(forma, []);
    grupos.get(forma).push(conta);
  }

  if (grupos.size < 2) {
    return `<table class="tabela-contas">${cabecalho}
      <tbody>${state.contas.map(linhaConta).join('')}</tbody></table>`;
  }

  return [...grupos.entries()]
    .sort((a, b) => posicaoForma(a[0]) - posicaoForma(b[0]) || a[0].localeCompare(b[0]))
    .map(([forma, contas]) => {
      const emAberto = contas.reduce((acc, c) => (c.quitado ? acc : acc + Number(c.saldo)), 0);
      return `
        <section class="grupo-forma">
          <div class="grupo-cabecalho">
            <h2>${escapar(forma)}</h2>
            <span class="grupo-total">${contas.length} lançamento(s)
              ${emAberto ? `&middot; em aberto <strong>${brl(emAberto)}</strong>` : ''}</span>
          </div>
          <table class="tabela-contas">${cabecalho}
            <tbody>${contas.map(linhaConta).join('')}</tbody>
          </table>
        </section>
      `;
    })
    .join('');
}

function telaHTML() {
  if (!state.sessao) return loginHTML();
  if (state.tab === 'painel' && podeVerPainel()) return painelHTML();
  if (state.tab === 'conciliacao') return conciliacaoHTML();
  if (state.tab === 'acumulado' && podeVerAcumulado()) return acumuladoHTML();
  if (state.tab === 'venda-prazo') return vendaPrazoHTML();
  if (state.tab === 'cadastros') return cadastrosHTML();
  if (state.tab === 'folha' && podeVerFolha()) return folhaHTML();
  if (state.tab === 'relatorios' && podeVerRelatorios()) return relatoriosHTML();
  if (state.tab === 'admin' && podeVerFolha()) return adminHTML();
  return contasHTML();
}

function render() {
  root.innerHTML = telaHTML();
  bind();
}

function bind() {
  if (!state.sessao) {
    root.querySelector('#form-login').addEventListener('submit', onLogin);
    return;
  }

  root.querySelector('#btn-logout').addEventListener('click', () => {
    limparSessao();
    setFolhaToken(null); // sair sempre tranca a folha de novo
    state.sessao = null;
    state.contas = [];
    state.fornecedores = [];
    state.painel = null;
    state.folha = null;
    state.extras = null;
    render();
  });

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.tab === btn.dataset.tab) return;
      state.tab = btn.dataset.tab;
      state.baixaAbertaId = null;
      limparBuscaContas();
      carregarDados();
    });
  });

  root.querySelectorAll('[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.tipo === btn.dataset.tipo) return;
      state.tipo = btn.dataset.tipo;
      state.baixaAbertaId = null;
      limparBuscaContas();
      carregarDados();
    });
  });

  root.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Quitadas só cresce: um ano de histórico vira uma lista interminável.
      // Por isso, ao entrar nela, o recorte começa no mês atual — e o seletor
      // continua ali para quem quiser o período inteiro. Ao sair, o recorte
      // volta a ser tudo: em Pendentes, esconder mês antigo esconderia atraso.
      if (btn.dataset.status !== state.statusFiltro) {
        state.mesFiltro = btn.dataset.status === 'quitado' ? 'atual' : '';
      }
      state.statusFiltro = btn.dataset.status;
      focoBusca = false; // clicou fora da busca: o foco é de quem clicou
      carregarDados();
    });
  });

  const formFornecedor = root.querySelector('[data-action="novo-fornecedor"]');
  if (formFornecedor) formFornecedor.addEventListener('submit', onNovoFornecedor);

  const formConta = root.querySelector('[data-action="nova-conta"]');
  if (formConta) formConta.addEventListener('submit', onNovaConta);

  const formBusca = root.querySelector('[data-action="busca-contas"]');
  if (formBusca) {
    formBusca.addEventListener('submit', (ev) => {
      ev.preventDefault();
      clearTimeout(timerBusca);
      carregarDados();
    });

    const campo = formBusca.querySelector('#busca-contas');
    // A tela inteira é redesenhada a cada busca, então devolvemos o foco (e o
    // cursor no fim do texto) para quem estava digitando.
    if (focoBusca) {
      campo.focus();
      const texto = campo.value;
      campo.value = '';
      campo.value = texto;
    }
    campo.addEventListener('input', (ev) => {
      focoBusca = true;
      state.buscaContas = ev.target.value;
      clearTimeout(timerBusca);
      timerBusca = setTimeout(carregarDados, 350);
    });
    const btnLimpar = formBusca.querySelector('#btn-limpar-busca');
    if (btnLimpar) {
      btnLimpar.addEventListener('click', () => {
        clearTimeout(timerBusca);
        state.buscaContas = '';
        focoBusca = false;
        carregarDados();
      });
    }
  }

  const btnConfirmarDup = root.querySelector('#btn-duplicado-confirmar');
  if (btnConfirmarDup) btnConfirmarDup.addEventListener('click', onConfirmarDuplicado);

  const btnCancelarDup = root.querySelector('#btn-duplicado-cancelar');
  if (btnCancelarDup) {
    btnCancelarDup.addEventListener('click', () => {
      state.duplicidade = null;
      render();
    });
  }

  root.querySelectorAll('[data-action="toggle-baixa"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const abrindo = state.baixaAbertaId !== id;
      state.baixaAbertaId = abrindo ? id : null;
      state.edicaoContaId = null;
      state.pagamentoEditandoId = null;
      state.detalheConta = null;
      render();
      if (abrindo) carregarDetalheConta(id);
    });
  });

  root.querySelectorAll('[data-action="toggle-editar"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      state.edicaoContaId = state.edicaoContaId === id ? null : id;
      state.baixaAbertaId = null;
      render();
    });
  });

  const formEditarConta = root.querySelector('[data-action="form-editar-conta"]');
  if (formEditarConta) formEditarConta.addEventListener('submit', onEditarConta);

  root.querySelectorAll('[data-action="editar-pagamento"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pagamentoEditandoId = Number(btn.dataset.id);
      render();
    });
  });

  const btnCancelarPag = root.querySelector('[data-action="cancelar-editar-pagamento"]');
  if (btnCancelarPag) {
    btnCancelarPag.addEventListener('click', () => {
      state.pagamentoEditandoId = null;
      render();
    });
  }

  const formEditarPagamento = root.querySelector('[data-action="form-editar-pagamento"]');
  if (formEditarPagamento) formEditarPagamento.addEventListener('submit', onEditarPagamento);

  root.querySelectorAll('[data-action="excluir-pagamento"]').forEach((btn) => {
    btn.addEventListener('click', () =>
      onExcluirPagamento(Number(btn.dataset.conta), Number(btn.dataset.id))
    );
  });

  const seletorMes = root.querySelector('#filtro-mes');
  if (seletorMes) {
    seletorMes.addEventListener('change', (ev) => {
      state.mesFiltro = ev.target.value;
      focoBusca = false;
      carregarDados();
    });
  }

  root.querySelectorAll('[data-action="excluir"]').forEach((btn) => {
    btn.addEventListener('click', () => onExcluir(Number(btn.dataset.id)));
  });

  root.querySelectorAll('[data-action="form-baixa"]').forEach((form) => {
    form.addEventListener('submit', onFormBaixa);
  });

  const btnHistorico = root.querySelector('#btn-historico');
  if (btnHistorico) {
    btnHistorico.addEventListener('click', () => {
      state.historicoCompleto = !state.historicoCompleto;
      render();
    });
  }

  const btnConsultar = root.querySelector('[data-action="consultar-sugestao"]');
  if (btnConsultar) btnConsultar.addEventListener('click', onConsultarSugestao);

  const btnUsar = root.querySelector('[data-action="usar-sugestao"]');
  if (btnUsar) {
    btnUsar.addEventListener('click', () => {
      const form = root.querySelector('[data-action="novo-acumulado"]');
      if (!form || !state.sugestaoDia) return;
      const { cartao, tickets, dinheiro } = state.sugestaoDia.sugestao;
      // Só preenche: quem confere e salva é a pessoa, que sabe o que ainda falta.
      form.querySelector('input[name=cartao]').value = cartao ? cartao.toFixed(2) : '';
      form.querySelector('input[name=tickets]').value = tickets ? tickets.toFixed(2) : '';
      form.querySelector('input[name=dinheiro]').value = dinheiro ? dinheiro.toFixed(2) : '';
      form.querySelector('input[name=data]').value = state.sugestaoDia.data;
      form.querySelector('input[name=pix]').focus();
    });
  }

  root.querySelectorAll('[data-action="lancar-dia"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.diaAcumulado = btn.dataset.dia;
      state.sugestaoDia = null;
      render();
      const campo = root.querySelector('[data-action="novo-acumulado"] input[name=dinheiro]');
      if (campo) campo.focus();
    });
  });

  const formAcumulado = root.querySelector('[data-action="novo-acumulado"]');
  if (formAcumulado) formAcumulado.addEventListener('submit', onNovoAcumulado);

  const formPrazo = root.querySelector('[data-action="novo-mov-prazo"]');
  if (formPrazo) formPrazo.addEventListener('submit', onNovoMovPrazo);

  const formCadastro = root.querySelector('[data-action="novo-cadastro"]');
  if (formCadastro) formCadastro.addEventListener('submit', onNovoCadastro);

  const formFolhaSenha = root.querySelector('#form-folha-senha');
  if (formFolhaSenha) formFolhaSenha.addEventListener('submit', onDestravarFolha);

  const seletorFolhaMes = root.querySelector('#filtro-folha-mes');
  if (seletorFolhaMes) {
    seletorFolhaMes.addEventListener('change', (ev) => {
      state.folhaMes = ev.target.value;
      carregarDados();
    });
  }

  const formFolha = root.querySelector('[data-action="novo-lancamento-folha"]');
  if (formFolha) {
    formFolha.addEventListener('submit', onNovoLancamentoFolha);
    // Escolher o funcionário já traz o que ele tem de vale em aberto: é esse
    // valor que a folha do mês desconta.
    formFolha.querySelector('select[name=funcionario_id]').addEventListener('change', (ev) =>
      onEscolherFuncionarioFolha(ev.target.value, formFolha)
    );
  }

  const formExtra = root.querySelector('[data-action="novo-extra"]');
  if (formExtra) formExtra.addEventListener('submit', onNovoExtra);

  const btnTrancar = root.querySelector('#btn-trancar-folha');
  if (btnTrancar) btnTrancar.addEventListener('click', onTrancarFolha);

  const formPeriodo = root.querySelector('[data-action="filtro-periodo"]');
  if (formPeriodo) formPeriodo.addEventListener('submit', onFiltroPeriodo);

  const SELETORES_PAINEL = {
    'filtro-boletos': 'filtroBoletos',
    'filtro-fixas': 'filtroFixas',
    'filtro-impostos': 'filtroImpostos',
    'filtro-despesas': 'filtroDespesas',
  };
  for (const [id, chave] of Object.entries(SELETORES_PAINEL)) {
    const seletor = root.querySelector(`#${id}`);
    if (!seletor) continue;
    seletor.addEventListener('change', (ev) => {
      state[chave] = ev.target.value;
      carregarDados();
    });
  }

  const btnBackup = root.querySelector('#btn-exportar-backup');
  if (btnBackup) btnBackup.addEventListener('click', onExportarBackup);

  const formExtrato = root.querySelector('[data-action="extrato-analisar"]');
  if (formExtrato) {
    formExtrato.querySelector('input[name=arquivo]').addEventListener('change', onEscolherExtrato);
    formExtrato.querySelector('select[name=adquirente]').addEventListener('change', (ev) => {
      state.extratoAdquirente = ev.target.value;
      state.extrato = null;
      state.extratoResultado = null;
    });
    formExtrato.addEventListener('submit', onAnalisarExtrato);
  }

  const btnImportarExtrato = root.querySelector('#btn-extrato-importar');
  if (btnImportarExtrato) btnImportarExtrato.addEventListener('click', onImportarExtrato);

  const formImportar = root.querySelector('[data-action="importar-backup"]');
  if (formImportar) {
    formImportar.querySelector('input[name=arquivo]').addEventListener('change', onEscolherArquivo);
    // Guardamos qual botão foi clicado para saber se é simulação ou importação.
    formImportar.querySelectorAll('button[data-modo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        formImportar.dataset.modoEscolhido = btn.dataset.modo;
      });
    });
    formImportar.addEventListener('submit', onImportarBackup);
  }

  root.querySelectorAll('[data-cadastro]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.cadastroTipo === btn.dataset.cadastro) return;
      state.cadastroTipo = btn.dataset.cadastro;
      carregarDados();
    });
  });

  root.querySelectorAll('[data-action="excluir-cadastro"]').forEach((btn) => {
    btn.addEventListener('click', () => onExcluirCadastro(Number(btn.dataset.id)));
  });

  root.querySelectorAll('[data-action="excluir-acumulado"]').forEach((btn) => {
    btn.addEventListener('click', () => onExcluirAcumulado(Number(btn.dataset.id)));
  });
}

async function onConsultarSugestao() {
  // A data consultada é a do próprio formulário: é ela que a pessoa está fechando.
  const campo = root.querySelector('[data-action="novo-acumulado"] input[name=data]');
  const dia = (campo && campo.value) || state.diaAcumulado || todayISO();

  state.sugestaoCarregando = true;
  state.erro = null;
  render();
  try {
    state.sugestaoDia = await apiFetch(`/acumulados/sugestao?data=${dia}`);
  } catch (err) {
    state.erro = err.message;
    state.sugestaoDia = null;
  } finally {
    state.sugestaoCarregando = false;
    render();
  }
}

async function onNovoAcumulado(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await apiFetch('/acumulados', {
      method: 'POST',
      body: JSON.stringify({
        data: fd.get('data'),
        dinheiro: fd.get('dinheiro') || 0,
        cartao: fd.get('cartao') || 0,
        pix: fd.get('pix') || 0,
        tickets: fd.get('tickets') || 0,
        pos_maquina: fd.get('pos_maquina') || 0,
        outras: fd.get('outras') || 0,
        observacoes: fd.get('observacoes') || null,
      }),
    });
    // Volta para hoje: o dia atrasado que acabou de ser lançado sai da lista de
    // pendentes e deixar a data velha no formulário só causaria lançamento errado.
    state.diaAcumulado = null;
    state.sugestaoDia = null;
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onNovoMovPrazo(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await apiFetch('/venda-prazo/movimentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_id: Number(fd.get('cliente_id')),
        tipo: fd.get('tipo'),
        valor: fd.get('valor'),
        data: fd.get('data'),
      }),
    });
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onNovoCadastro(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const corpo = {};
  for (const [k, v] of fd.entries()) corpo[k] = v || null;

  try {
    await apiFetch(`/cadastros/${state.cadastroTipo}`, {
      method: 'POST',
      body: JSON.stringify(corpo),
    });
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onExcluirCadastro(id) {
  if (!confirm('Excluir este cadastro?')) return;
  try {
    await apiFetch(`/cadastros/${state.cadastroTipo}/${id}`, { method: 'DELETE' });
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

// Escolher o funcionário traz o que ele já tem pendente: o vale em aberto vira o
// adiantamento, e o que ele deve no caderno de fiado vira as compras. Os dois
// campos continuam editáveis — o dono é quem decide quanto descontar no mês.
async function onEscolherFuncionarioFolha(id, form) {
  const aviso = form.querySelector('#aviso-adiantamento');

  const abertos = ((state.extras && state.extras.extras) || []).filter(
    (e) => String(e.funcionario_id) === String(id) && Number(e.saldo) > 0
  );
  const vales = abertos.reduce((acc, e) => acc + Number(e.saldo), 0);
  form.querySelector('input[name=adiantamento]').value = vales ? vales.toFixed(2) : '';

  let fiado = null;
  if (id) {
    try {
      fiado = await apiFetch(`/folha/compras-prazo/${id}`);
    } catch {
      fiado = null;
    }
  }
  const compras = fiado && fiado.vinculado && fiado.saldo > 0 ? fiado.saldo : 0;
  form.querySelector('input[name=compras]').value = compras ? compras.toFixed(2) : '';

  if (!aviso) return;
  const partes = [];
  if (vales) {
    partes.push(
      `<strong>${brl(vales)}</strong> em ${abertos.length} vale(s) em aberto — lançar a folha dá baixa neles`
    );
  }
  if (compras) {
    partes.push(
      `<strong>${brl(compras)}</strong> de compras no caderno (código ${escapar(fiado.codigo)}) — lançar a folha quita essa dívida`
    );
  }
  aviso.innerHTML = partes.length
    ? partes.join('. ') + '.'
    : id
      ? 'Nada pendente para este funcionário: sem vale em aberto e sem compra no caderno.'
      : 'Ao escolher o funcionário, adiantamento e compras vêm preenchidos com o que ele tem em aberto.';
}

async function onNovoLancamentoFolha(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const id = fd.get('funcionario_id');
  const funcionario = state.funcionarios.find((f) => String(f.id) === String(id));
  try {
    await apiFetch('/folha', {
      method: 'POST',
      body: JSON.stringify({
        funcionario_id: id,
        nome: funcionario ? funcionario.nome : '',
        data_ref: fd.get('data_ref'),
        salario: fd.get('salario') || 0,
        bonificacao: fd.get('bonificacao') || 0,
        compras: fd.get('compras') || 0,
        adiantamento: fd.get('adiantamento') || 0,
        descontos: fd.get('descontos') || 0,
      }),
    });
    state.erro = null;
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onNovoExtra(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const id = fd.get('funcionario_id');
  const funcionario = state.funcionarios.find((f) => String(f.id) === String(id));
  try {
    await apiFetch('/folha/extras', {
      method: 'POST',
      body: JSON.stringify({
        funcionario_id: id,
        nome: funcionario ? funcionario.nome : '',
        tipo: 'adiantamento',
        valor: fd.get('valor'),
        data: fd.get('data'),
        observacoes: fd.get('observacoes') || null,
      }),
    });
    state.erro = null;
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onDestravarFolha(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    const { folhaToken } = await apiFetch('/folha/desbloquear', {
      method: 'POST',
      body: JSON.stringify({ senha: fd.get('senha') }),
      // Senha da folha errada responde 401, mas isso não é sessão expirada:
      // sem isso, errar a senha derrubaria o login do usuário.
      manterSessaoEm401: true,
    });
    setFolhaToken(folhaToken);
    state.folhaErro = null;
    carregarDados();
  } catch (err) {
    state.folhaErro = err.message;
    render();
  }
}

function onTrancarFolha() {
  setFolhaToken(null);
  state.folha = null;
  state.extras = null;
  render();
}

// O arquivo vai em base64 no corpo JSON — evita depender de upload multipart
// só para esta tela.
function paraBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1]);
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

async function onEscolherExtrato(ev) {
  const arquivo = ev.target.files[0];
  state.extrato = null;
  state.extratoResultado = null;
  state.erro = null;

  if (!arquivo) {
    state.extratoArquivo = null;
    render();
    return;
  }

  try {
    state.extratoArquivo = { nome: arquivo.name, base64: await paraBase64(arquivo) };
  } catch (err) {
    state.extratoArquivo = null;
    state.erro = err.message;
  }
  render();
}

async function onAnalisarExtrato(ev) {
  ev.preventDefault();
  if (!state.extratoArquivo) return;

  state.extratoCarregando = true;
  state.extrato = null;
  state.extratoResultado = null;
  state.erro = null;
  render();

  try {
    state.extrato = await apiFetch('/conciliacao/extratos/analisar', {
      method: 'POST',
      body: JSON.stringify({
        arquivo_base64: state.extratoArquivo.base64,
        nome_arquivo: state.extratoArquivo.nome,
        adquirente: state.extratoAdquirente,
      }),
    });
  } catch (err) {
    state.erro = err.message;
  } finally {
    state.extratoCarregando = false;
    render();
  }
}

async function onImportarExtrato() {
  if (!state.extratoArquivo || !state.extrato) return;
  if (!confirm('Importar estas transações para a conciliação?')) return;

  state.extratoCarregando = true;
  state.erro = null;
  render();

  try {
    state.extratoResultado = await apiFetch('/conciliacao/extratos', {
      method: 'POST',
      body: JSON.stringify({
        arquivo_base64: state.extratoArquivo.base64,
        nome_arquivo: state.extratoArquivo.nome,
        adquirente: state.extratoAdquirente,
        mapa: state.extrato.mapa,
      }),
    });
    state.extrato = null;
    state.extratoArquivo = null;
  } catch (err) {
    state.erro = err.message;
  } finally {
    state.extratoCarregando = false;
    carregarDados(); // atualiza os totais da tela
  }
}

async function onExportarBackup() {
  try {
    const backup = await apiFetch('/admin/backup');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mercado_favalessa_backup_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onEscolherArquivo(ev) {
  const arquivo = ev.target.files[0];
  state.importacao = null;
  state.erro = null;

  if (!arquivo) {
    state.arquivoImportacao = null;
    render();
    return;
  }

  try {
    const conteudo = JSON.parse(await arquivo.text());
    state.arquivoImportacao = { nome: arquivo.name, conteudo };
  } catch {
    state.arquivoImportacao = null;
    state.erro = 'O arquivo não é um JSON válido.';
  }
  render();
}

async function onImportarBackup(ev) {
  ev.preventDefault();

  if (!state.arquivoImportacao) {
    state.erro = 'Escolha um arquivo de backup primeiro.';
    render();
    return;
  }

  const simular = ev.target.dataset.modoEscolhido !== 'importar';

  if (!simular && !confirm('Importar este backup para o banco? Registros já existentes serão atualizados.')) {
    return;
  }

  state.importando = true;
  state.importacao = null;
  state.erro = null;
  render();

  try {
    state.importacao = await apiFetch(`/admin/importar${simular ? '?dry_run=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify(state.arquivoImportacao.conteudo),
    });
  } catch (err) {
    state.erro = err.message;
  } finally {
    state.importando = false;
    // Depois de importar de verdade, recarrega a auditoria para o registro aparecer.
    if (!simular && !state.erro) {
      carregarDados();
    } else {
      render();
    }
  }
}

async function onFiltroPeriodo(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  state.periodo = { de: fd.get('de'), ate: fd.get('ate') };
  carregarDados();
}

async function onExcluirAcumulado(id) {
  if (!confirm('Excluir esta conferência? Essa ação não pode ser desfeita.')) return;
  try {
    await apiFetch(`/acumulados/${id}`, { method: 'DELETE' });
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onLogin(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    const { token, usuario } = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: fd.get('email'), senha: fd.get('senha') }),
    });
    salvarSessao(token, usuario);
    state.sessao = { token, usuario };
    state.loginErro = null;
    state.tab = abaInicial();
    render();
    carregarDados();
  } catch (err) {
    state.loginErro = err.message;
    render();
  }
}

async function onNovoFornecedor(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await apiFetch('/fornecedores', {
      method: 'POST',
      body: JSON.stringify({ nome: fd.get('nome') }),
    });
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onNovaConta(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const payload = {
    tipo: state.tipo,
    fornecedor_id: fd.get('fornecedor_id') || null,
    categoria: fd.get('categoria') || null,
    descricao: fd.get('descricao'),
    valor: fd.get('valor'),
    vencimento: fd.get('vencimento'),
    forma_prevista: fd.get('forma_prevista') || null,
    parcelas: fd.get('parcelas') || 1,
    intervalo: fd.get('intervalo') || 'mensal',
  };
  await enviarNovaConta(payload);
}

// O 409 não é erro do usuário: é o sistema avisando que já existe lançamento
// igual. A tela mostra o aviso, devolve o que foi digitado e deixa confirmar.
async function enviarNovaConta(payload) {
  state.erro = null;
  try {
    await apiFetch('/contas', { method: 'POST', body: JSON.stringify(payload) });
    state.duplicidade = null;
    carregarDados();
  } catch (err) {
    if (err.status === 409) {
      state.duplicidade = { mensagem: err.message, payload, existente: err.dados && err.dados.duplicada };
    } else {
      state.erro = err.message;
    }
    render();
  }
}

function onConfirmarDuplicado() {
  const { payload } = state.duplicidade;
  enviarNovaConta({ ...payload, permitir_duplicado: true });
}

// O detalhe (com os pagamentos) vem numa chamada à parte: carregar tudo junto
// da lista traria centenas de pagamentos que quase nunca são olhados.
async function carregarDetalheConta(id) {
  try {
    state.detalheConta = await apiFetch(`/contas/${id}`);
  } catch (err) {
    state.erro = err.message;
  }
  render();
}

async function onEditarConta(ev) {
  ev.preventDefault();
  const id = ev.target.dataset.id;
  const fd = new FormData(ev.target);
  try {
    await apiFetch(`/contas/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        fornecedor_id: fd.get('fornecedor_id') || null,
        categoria: fd.get('categoria') || null,
        descricao: fd.get('descricao'),
        valor: fd.get('valor'),
        vencimento: fd.get('vencimento'),
        forma_prevista: fd.get('forma_prevista') || null,
      }),
    });
    state.edicaoContaId = null;
    state.erro = null;
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onEditarPagamento(ev) {
  ev.preventDefault();
  const contaId = ev.target.dataset.conta;
  const id = ev.target.dataset.id;
  const fd = new FormData(ev.target);
  try {
    await apiFetch(`/contas/${contaId}/pagamentos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        valor: fd.get('valor'),
        data_pagamento: fd.get('data_pagamento'),
        forma_pagamento: fd.get('forma_pagamento') || null,
        banco_id: fd.get('banco_id') || null,
      }),
    });
    state.pagamentoEditandoId = null;
    state.erro = null;
    await carregarDetalheConta(contaId);
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onExcluirPagamento(contaId, id) {
  if (!confirm('Estornar este pagamento? A conta volta a ficar pendente pelo valor.')) return;
  try {
    await apiFetch(`/contas/${contaId}/pagamentos/${id}`, { method: 'DELETE' });
    state.erro = null;
    await carregarDetalheConta(contaId);
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onFormBaixa(ev) {
  ev.preventDefault();
  const id = ev.target.dataset.id;
  const fd = new FormData(ev.target);
  try {
    await apiFetch(`/contas/${id}/pagamentos`, {
      method: 'POST',
      body: JSON.stringify({
        valor: fd.get('valor'),
        data_pagamento: fd.get('data_pagamento'),
        forma_pagamento: fd.get('forma_pagamento') || null,
        banco_id: fd.get('banco_id') || null,
      }),
    });
    // A conta continua aberta: quem paga em partes costuma conferir logo o que
    // ficou registrado.
    await carregarDetalheConta(id);
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

async function onExcluir(id) {
  if (!confirm('Excluir esta conta? Essa ação não pode ser desfeita.')) return;
  try {
    await apiFetch(`/contas/${id}`, { method: 'DELETE' });
    carregarDados();
  } catch (err) {
    state.erro = err.message;
    render();
  }
}

if (state.sessao) {
  state.tab = abaInicial();
  render();
  carregarDados();
} else {
  render();
}
