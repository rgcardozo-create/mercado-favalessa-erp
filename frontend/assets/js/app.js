import { apiFetch, getSessao, salvarSessao, limparSessao } from './api.js';
import { brl, dateBR, todayISO } from './helpers.js';

// As quatro telas de Contas a pagar. Rótulos iguais aos do sistema atual.
const TIPOS = [
  { tipo: 'fornecedor', rotulo: 'Fornecedores' },
  { tipo: 'fixa', rotulo: 'Despesas fixas' },
  { tipo: 'imposto', rotulo: 'Impostos' },
  { tipo: 'despesa', rotulo: 'Outras despesas' },
];

const state = {
  sessao: getSessao(),
  tab: 'painel',
  tipo: 'fornecedor',
  contas: [],
  fornecedores: [],
  painel: null,
  statusFiltro: '',
  carregando: false,
  erro: null,
  loginErro: null,
  baixaAbertaId: null,
};

const root = document.getElementById('app');

function rotuloTipo(tipo) {
  const t = TIPOS.find((x) => x.tipo === tipo);
  return t ? t.rotulo : tipo;
}

function podeGerenciar() {
  return state.sessao && state.sessao.usuario.role !== 'loja';
}

// Painel do dia é só para Master e Gerente. O backend também bloqueia — esconder
// a aba aqui é conveniência, não a regra de segurança.
function podeVerPainel() {
  return podeGerenciar();
}

function abaInicial() {
  return podeVerPainel() ? 'painel' : 'contas';
}

async function carregarDados() {
  state.carregando = true;
  state.erro = null;
  render();
  try {
    if (state.tab === 'painel') {
      state.painel = await apiFetch('/painel-do-dia');
    } else {
      const params = new URLSearchParams({ tipo: state.tipo });
      if (state.statusFiltro) params.set('status', state.statusFiltro);
      const [contas, fornecedores] = await Promise.all([
        apiFetch(`/contas?${params}`),
        apiFetch('/fornecedores'),
      ]);
      state.contas = contas;
      state.fornecedores = fornecedores;
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
        <h1>Mercado Favalessa ERP</h1>
        <p class="subtitulo">Contas a pagar &middot; Fornecedores</p>
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

function badgeStatus(conta) {
  return conta.quitado
    ? '<span class="badge quitado">Quitado</span>'
    : '<span class="badge pendente">Pendente</span>';
}

function linhaConta(conta) {
  const podeGerir = podeGerenciar();
  const baixaAberta = state.baixaAbertaId === conta.id;

  return `
    <tr>
      <td>${(conta.tipo === 'fornecedor' ? conta.fornecedor_nome : conta.categoria) || '—'}</td>
      <td>${conta.descricao}</td>
      <td>${dateBR(conta.vencimento)}</td>
      <td>${brl(conta.valor)}</td>
      <td>${brl(conta.saldo)}</td>
      <td>${badgeStatus(conta)}</td>
      <td class="ações">
        ${
          podeGerir && !conta.quitado
            ? `<button data-action="toggle-baixa" data-id="${conta.id}">${baixaAberta ? 'Cancelar' : 'Dar baixa'}</button>`
            : ''
        }
        ${podeGerir ? `<button data-action="excluir" data-id="${conta.id}" class="perigo">Excluir</button>` : ''}
      </td>
    </tr>
    ${
      baixaAberta
        ? `<tr class="linha-baixa"><td colspan="7">
            <form data-action="form-baixa" data-id="${conta.id}" class="form-inline">
              <label>Valor <input type="number" step="0.01" min="0.01" name="valor" required value="${conta.saldo > 0 ? conta.saldo : ''}" /></label>
              <label>Data <input type="date" name="data_pagamento" required value="${todayISO()}" /></label>
              <label>Forma <input type="text" name="forma_pagamento" placeholder="pix, dinheiro..." /></label>
              <button type="submit">Confirmar pagamento</button>
            </form>
          </td></tr>`
        : ''
    }
  `;
}

function cabecalhoHTML(titulo) {
  const { usuario } = state.sessao;
  return `
    <div class="topo">
      <div>
        <h1>${titulo}</h1>
        <p class="usuario-atual">${usuario.nome} <span class="badge role">${usuario.role}</span></p>
      </div>
      <button id="btn-logout">Sair</button>
    </div>

    <nav class="abas">
      ${podeVerPainel() ? `<button data-tab="painel" class="${state.tab === 'painel' ? 'ativo' : ''}">Painel do dia</button>` : ''}
      <button data-tab="contas" class="${state.tab === 'contas' ? 'ativo' : ''}">Contas a pagar</button>
    </nav>

    ${state.erro ? `<div class="alerta erro">${state.erro}</div>` : ''}
  `;
}

function grupoPainelHTML(titulo, contas, total, classe) {
  return `
    <section class="grupo-painel ${classe}">
      <div class="grupo-cabecalho">
        <h2>${titulo}</h2>
        <span class="grupo-total">${brl(total)} <small>em ${contas.length} conta(s)</small></span>
      </div>
      ${
        contas.length
          ? `<table class="tabela-contas">
              <thead><tr><th>Tipo</th><th>Fornecedor / Categoria</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Saldo</th></tr></thead>
              <tbody>
                ${contas
                  .map(
                    (c) => `<tr>
                      <td><span class="badge tipo">${rotuloTipo(c.tipo)}</span></td>
                      <td>${(c.tipo === 'fornecedor' ? c.fornecedor_nome : c.categoria) || '—'}</td>
                      <td>${c.descricao}</td>
                      <td>${dateBR(c.vencimento)}</td>
                      <td>${brl(c.valor)}</td>
                      <td>${brl(c.saldo)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
          : '<p class="vazio">Nada aqui.</p>'
      }
    </section>
  `;
}

function painelHTML() {
  const cabecalho = cabecalhoHTML('Painel do dia');

  if (!state.painel) {
    return `${cabecalho}${state.carregando ? '<p>Carregando…</p>' : ''}`;
  }

  const p = state.painel;
  return `
    ${cabecalho}
    <p class="usuario-atual">Referência: ${dateBR(p.hoje)}</p>

    <div class="cartoes-resumo">
      <div class="cartao-resumo vencidas">
        <span class="rotulo">Vencidas</span>
        <strong>${brl(p.totais.vencidas)}</strong>
        <small>${p.vencidas.length} conta(s)</small>
      </div>
      <div class="cartao-resumo hoje">
        <span class="rotulo">Vencem hoje</span>
        <strong>${brl(p.totais.vencem_hoje)}</strong>
        <small>${p.vencem_hoje.length} conta(s)</small>
      </div>
      <div class="cartao-resumo proximos">
        <span class="rotulo">Próximos 7 dias</span>
        <strong>${brl(p.totais.proximos_7_dias)}</strong>
        <small>${p.proximos_7_dias.length} conta(s)</small>
      </div>
    </div>

    ${
      p.por_tipo && p.por_tipo.length
        ? `<section class="por-tipo">
            <h2>Em aberto por tela</h2>
            <div class="linha-tipos">
              ${p.por_tipo
                .map(
                  (t) => `<div class="chip-tipo">
                    <span>${t.rotulo}</span>
                    <strong>${brl(t.total)}</strong>
                    <small>${t.quantidade} conta(s)</small>
                  </div>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    ${grupoPainelHTML('Vencidas', p.vencidas, p.totais.vencidas, 'vencidas')}
    ${grupoPainelHTML('Vencem hoje', p.vencem_hoje, p.totais.vencem_hoje, 'hoje')}
    ${grupoPainelHTML('Próximos 7 dias', p.proximos_7_dias, p.totais.proximos_7_dias, 'proximos')}
  `;
}

function contasHTML() {
  const podeGerir = podeGerenciar();
  const ehFornecedor = state.tipo === 'fornecedor';
  const ehDespesa = state.tipo === 'despesa';
  const totalEmAberto = state.contas.reduce(
    (acc, c) => (c.quitado ? acc : acc + Number(c.saldo)),
    0
  );

  return `
    ${cabecalhoHTML(`Contas a pagar &middot; ${rotuloTipo(state.tipo)}`)}

    <div class="sub-abas">
      ${TIPOS.map(
        (t) => `<button data-tipo="${t.tipo}" class="${state.tipo === t.tipo ? 'ativo' : ''}">${t.rotulo}</button>`
      ).join('')}
    </div>

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
                  ${state.fornecedores.map((f) => `<option value="${f.id}">${f.nome}</option>`).join('')}
                </select>
              </label>`
            : ''
        }
        <label>Descrição <input type="text" name="descricao" required /></label>
        ${ehDespesa ? '<label>Categoria <input type="text" name="categoria" placeholder="Manutenção, Outros..." /></label>' : ''}
        <label>Valor <input type="number" step="0.01" min="0" name="valor" required /></label>
        <label>${ehDespesa ? 'Data' : 'Vencimento'} <input type="date" name="vencimento" required /></label>
        <button type="submit">Cadastrar</button>
      </form>
    </section>

    <div class="filtros">
      <button data-status="" class="${state.statusFiltro === '' ? 'ativo' : ''}">Todas</button>
      <button data-status="pendente" class="${state.statusFiltro === 'pendente' ? 'ativo' : ''}">Pendentes</button>
      <button data-status="quitado" class="${state.statusFiltro === 'quitado' ? 'ativo' : ''}">Quitadas</button>
      <span class="resumo-lista">${state.contas.length} lançamento(s) &middot; em aberto <strong>${brl(totalEmAberto)}</strong></span>
    </div>

    ${state.carregando ? '<p>Carregando…</p>' : ''}

    <table class="tabela-contas">
      <thead>
        <tr>
          <th>${ehFornecedor ? 'Fornecedor' : 'Categoria'}</th>
          <th>Descrição</th><th>${ehDespesa ? 'Data' : 'Vencimento'}</th><th>Valor</th><th>Saldo</th><th>Status</th>
          <th${podeGerir ? '' : ' style="display:none"'}>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${
          state.contas.length
            ? state.contas.map(linhaConta).join('')
            : '<tr><td colspan="7">Nenhum lançamento cadastrado.</td></tr>'
        }
      </tbody>
    </table>
  `;
}

function telaHTML() {
  if (!state.sessao) return loginHTML();
  return state.tab === 'painel' && podeVerPainel() ? painelHTML() : contasHTML();
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
    state.sessao = null;
    state.contas = [];
    state.fornecedores = [];
    state.painel = null;
    render();
  });

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.tab === btn.dataset.tab) return;
      state.tab = btn.dataset.tab;
      state.baixaAbertaId = null;
      carregarDados();
    });
  });

  root.querySelectorAll('[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.tipo === btn.dataset.tipo) return;
      state.tipo = btn.dataset.tipo;
      state.baixaAbertaId = null;
      carregarDados();
    });
  });

  root.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.statusFiltro = btn.dataset.status;
      carregarDados();
    });
  });

  const formFornecedor = root.querySelector('[data-action="novo-fornecedor"]');
  if (formFornecedor) formFornecedor.addEventListener('submit', onNovoFornecedor);

  const formConta = root.querySelector('[data-action="nova-conta"]');
  if (formConta) formConta.addEventListener('submit', onNovaConta);

  root.querySelectorAll('[data-action="toggle-baixa"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      state.baixaAbertaId = state.baixaAbertaId === id ? null : id;
      render();
    });
  });

  root.querySelectorAll('[data-action="excluir"]').forEach((btn) => {
    btn.addEventListener('click', () => onExcluir(Number(btn.dataset.id)));
  });

  root.querySelectorAll('[data-action="form-baixa"]').forEach((form) => {
    form.addEventListener('submit', onFormBaixa);
  });
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
  try {
    await apiFetch('/contas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: state.tipo,
        fornecedor_id: fd.get('fornecedor_id') || null,
        categoria: fd.get('categoria') || null,
        descricao: fd.get('descricao'),
        valor: fd.get('valor'),
        vencimento: fd.get('vencimento'),
      }),
    });
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
      }),
    });
    state.baixaAbertaId = null;
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
