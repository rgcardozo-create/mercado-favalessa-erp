import { apiFetch, getSessao, salvarSessao, limparSessao, setFolhaToken, getFolhaToken } from './api.js';
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
  conciliacao: null,
  acumulados: null,
  vendaPrazo: null,
  cadastros: null,
  cadastroTipo: 'clientes',
  folha: null,
  extras: null,
  folhaErro: null,
  relatorio: null,
  auditoria: null,
  importacao: null,
  importando: false,
  // O conteúdo do arquivo fica aqui porque o input é recriado a cada render:
  // sem isso, o arquivo escolhido some depois da simulação.
  arquivoImportacao: null,
  periodo: { de: '', ate: '' },
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
      state.painel = await apiFetch('/painel-do-dia');
    } else if (state.tab === 'conciliacao') {
      state.conciliacao = await apiFetch('/conciliacao');
    } else if (state.tab === 'acumulado') {
      state.acumulados = await apiFetch('/acumulados');
    } else if (state.tab === 'venda-prazo') {
      state.vendaPrazo = await apiFetch('/venda-prazo');
    } else if (state.tab === 'cadastros') {
      state.cadastros = await apiFetch(`/cadastros/${state.cadastroTipo}`);
    } else if (state.tab === 'folha') {
      // Sem token da folha a API responde 423 — a tela então pede a senha.
      if (getFolhaToken()) {
        const [folha, extras] = await Promise.all([apiFetch('/folha'), apiFetch('/folha/extras')]);
        state.folha = folha;
        state.extras = extras;
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

function conciliacaoHTML() {
  const cabecalho = cabecalhoHTML('Conciliação');
  if (!state.conciliacao) {
    return `${cabecalho}${state.carregando ? '<p>Carregando…</p>' : ''}`;
  }

  const c = state.conciliacao;
  return `
    ${cabecalho}

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

function acumuladoHTML() {
  const cabecalho = cabecalhoHTML('Acumulado');
  if (!state.acumulados) {
    return `${cabecalho}${state.carregando ? '<p>Carregando…</p>' : ''}`;
  }

  const { acumulados, totais } = state.acumulados;
  return `
    ${cabecalho}

    <section class="cartoes-form">
      <form data-action="novo-acumulado" class="form-inline">
        <h2>Conferência do dia</h2>
        <label>Data <input type="date" name="data" required value="${todayISO()}" /></label>
        <label>Dinheiro <input type="number" step="0.01" name="dinheiro" /></label>
        <label>Cartão <input type="number" step="0.01" name="cartao" /></label>
        <label>PIX <input type="number" step="0.01" name="pix" /></label>
        <label>Tickets <input type="number" step="0.01" name="tickets" /></label>
        <label>Outras <input type="number" step="0.01" name="outras" /></label>
        <button type="submit">Salvar</button>
      </form>
    </section>
    <p class="usuario-atual">Uma conferência por dia — salvar a mesma data atualiza o registro existente.</p>

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Histórico</h2>
        <span class="grupo-total">${brl(totais.total)} <small>em ${acumulados.length} dia(s)</small></span>
      </div>
      ${
        acumulados.length
          ? `<table class="tabela-contas">
              <thead><tr><th>Data</th><th>Dinheiro</th><th>Cartão</th><th>PIX</th><th>Tickets</th><th>Outras</th><th>Total</th><th>Ações</th></tr></thead>
              <tbody>
                ${acumulados
                  .map(
                    (a) => `<tr>
                      <td>${dateBR(a.data)}</td>
                      <td>${brl(a.dinheiro)}</td>
                      <td>${brl(a.cartao)}</td>
                      <td>${brl(a.pix)}</td>
                      <td>${brl(a.tickets)}</td>
                      <td>${brl(a.outras)}</td>
                      <td><strong>${brl(a.total)}</strong></td>
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
];

function cadastrosHTML() {
  const cabecalho = cabecalhoHTML('Cadastros');
  const tipo = state.cadastroTipo;
  const registros = state.cadastros || [];

  const colunas = {
    clientes: ['codigo', 'nome', 'telefone', 'cpf_cnpj'],
    funcionarios: ['codigo', 'nome', 'telefone', 'cpf', 'pix'],
    bancos: ['nome'],
  }[tipo];

  const rotulos = {
    codigo: 'Código', nome: 'Nome', telefone: 'Telefone',
    cpf_cnpj: 'CPF/CNPJ', cpf: 'CPF', pix: 'PIX',
  };

  return `
    ${cabecalho}

    <div class="sub-abas">
      ${CADASTROS.map(
        (c) => `<button data-cadastro="${c.chave}" class="${tipo === c.chave ? 'ativo' : ''}">${c.rotulo}</button>`
      ).join('')}
    </div>

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
                    <td>${podeGerenciar() ? `<button data-action="excluir-cadastro" data-id="${r.id}" class="perigo">Excluir</button>` : ''}</td>
                  </tr>`
                )
                .join('')
            : `<tr><td colspan="${colunas.length + 1}">Nenhum registro.</td></tr>`
        }
      </tbody>
    </table>
  `;
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

    <section class="grupo-painel">
      <div class="grupo-cabecalho">
        <h2>Lançamentos</h2>
        <button id="btn-trancar-folha">Trancar folha</button>
      </div>
      <table class="tabela-contas">
        <thead><tr><th>Funcionário</th><th>Ref.</th><th>Salário</th><th>Bonif.</th><th>Compras</th><th>Líquido</th><th>Pago</th><th>Saldo</th><th>Status</th></tr></thead>
        <tbody>
          ${lancamentos
            .map(
              (l) => `<tr>
                <td>${l.nome}</td>
                <td>${l.data_ref ? dateBR(l.data_ref) : '—'}</td>
                <td>${brl(l.salario)}</td>
                <td>${brl(l.bonificacao)}</td>
                <td>${brl(l.compras)}</td>
                <td><strong>${brl(l.liquido)}</strong></td>
                <td>${brl(l.total_pago)}</td>
                <td>${brl(l.saldo)}</td>
                <td>${l.quitado ? '<span class="badge quitado">Quitado</span>' : '<span class="badge pendente">Pendente</span>'}</td>
              </tr>`
            )
            .join('')}
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

  const formAcumulado = root.querySelector('[data-action="novo-acumulado"]');
  if (formAcumulado) formAcumulado.addEventListener('submit', onNovoAcumulado);

  const formPrazo = root.querySelector('[data-action="novo-mov-prazo"]');
  if (formPrazo) formPrazo.addEventListener('submit', onNovoMovPrazo);

  const formCadastro = root.querySelector('[data-action="novo-cadastro"]');
  if (formCadastro) formCadastro.addEventListener('submit', onNovoCadastro);

  const formFolhaSenha = root.querySelector('#form-folha-senha');
  if (formFolhaSenha) formFolhaSenha.addEventListener('submit', onDestravarFolha);

  const btnTrancar = root.querySelector('#btn-trancar-folha');
  if (btnTrancar) btnTrancar.addEventListener('click', onTrancarFolha);

  const formPeriodo = root.querySelector('[data-action="filtro-periodo"]');
  if (formPeriodo) formPeriodo.addEventListener('submit', onFiltroPeriodo);

  const btnBackup = root.querySelector('#btn-exportar-backup');
  if (btnBackup) btnBackup.addEventListener('click', onExportarBackup);

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
        outras: fd.get('outras') || 0,
      }),
    });
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
