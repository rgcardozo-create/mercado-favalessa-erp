// Decide qual boleto cadastrado cada pagamento do relatório do banco quitou.
//
// Função pura, sem banco de dados: recebe os pagamentos lidos e as contas, e
// devolve a proposta. Quem grava é o controller, depois que o dono confere.
//
// A ordem das tentativas é a ordem de confiança:
//   1. Código de barras: o "Nosso Número" do relatório do BB é o campo livre do
//      código de barras. Lido pelo leitor no cadastro, é exato.
//   2. Nosso número digitado à mão (o final, sem leitor), dentro do mesmo CNPJ.
//   3. CNPJ do fornecedor + valor igual ao saldo.
//   4. CNPJ + valor um pouco maior, com o boleto já vencido no dia do
//      pagamento: é a parcela paga atrasada, com juros e multa.
//   5. Sem CNPJ no cadastro, o nome do fornecedor — e aí só como sugestão.
//
// Quando sobra mais de uma conta possível (três parcelas iguais da BRF, todas
// em aberto), a proposta é a de vencimento mais antigo — é a que se paga
// primeiro —, mas a tela mostra as outras para o dono trocar.

const CENTAVO = 0.005;

// Até quanto acima do saldo ainda é juros e multa, e não outra conta: multa de
// 2% mais mora de alguns meses, com folga. Acima disso o valor é de outra coisa.
const JUROS_MAXIMO = 0.25;

const soDigitos = (t) => String(t ?? '').replace(/\D/g, '');
const semZeros = (t) => soDigitos(t).replace(/^0+(?=\d)/, '');

const PALAVRAS_GENERICAS = new Set([
  'LTDA', 'SA', 'S/A', 'ME', 'EPP', 'EIRELI', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'O', 'A',
  'COMERCIO', 'COMERCIAL', 'DISTRIBUIDORA', 'DISTRIBUICAO', 'INDUSTRIA', 'INDUSTRIAL',
  'IMPORTACAO', 'EXPORTACAO', 'SERVICOS', 'PRODUTOS', 'BRASIL', 'DO BRASIL', 'CIA', 'GRUPO',
]);

function palavrasDoNome(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PALAVRAS_GENERICAS.has(p));
}

// "BRF S.A." e "BRF" casam; "NESTLE BRASIL LTDA." e "NESTLE" casam. A primeira
// palavra que importa precisa ser a mesma — é o nome de fato da empresa.
function nomesParecidos(a, b) {
  const pa = palavrasDoNome(a);
  const pb = palavrasDoNome(b);
  return Boolean(pa[0] && pb[0] && pa[0] === pb[0]);
}

const porVencimento = (a, b) => String(a.vencimento).localeCompare(String(b.vencimento));

function resumoConta(c, pagamento) {
  const diferenca = Number((pagamento.valor - Number(c.saldo)).toFixed(2));
  return {
    id: c.id,
    fornecedor: c.fornecedor_nome || null,
    descricao: c.descricao,
    vencimento: c.vencimento,
    valor: Number(c.valor),
    saldo: Number(c.saldo),
    diferenca,
  };
}

// Entre contas possíveis, as que o valor pago explica: saldo igual, ou saldo
// menor com o boleto vencido (juros). Ordenadas pelo vencimento.
function explicadasPeloValor(pagamento, contas) {
  const iguais = contas.filter((c) => Math.abs(Number(c.saldo) - pagamento.valor) < CENTAVO);
  if (iguais.length) return { contas: iguais.sort(porVencimento), juros: false };

  const comJuros = contas.filter((c) => {
    const saldo = Number(c.saldo);
    return pagamento.valor > saldo &&
      pagamento.valor <= saldo * (1 + JUROS_MAXIMO) &&
      String(c.vencimento) < String(pagamento.data);
  });
  return { contas: comJuros.sort(porVencimento), juros: comJuros.length > 0 };
}

/**
 * @param pagamentos  lidos do relatório ({ data, nome, cnpj, nosso_numero, valor, ... })
 * @param contas      todas as contas a considerar, abertas e quitadas, com
 *                    { id, fornecedor_id, fornecedor_nome, fornecedor_cnpj, descricao,
 *                      valor, saldo, quitado, vencimento, codigo_barras, nosso_numero,
 *                      pagamentos: [{ data_pagamento, valor }] }
 * @param jaImportadas Set de referências já gravadas por importações anteriores
 */
function casarPagamentos(pagamentos, contas, jaImportadas = new Set()) {
  const usadas = new Set();
  const vistas = new Map();
  const abertas = () => contas.filter((c) => !c.quitado && Number(c.saldo) > 0 && !usadas.has(c.id));

  return pagamentos.map((p, indice) => {
    // Referência estável do pagamento, para reimportar o mesmo relatório não
    // dar baixa duas vezes. Dois pagamentos idênticos no mesmo dia (três DARF
    // de R$ 300,98) se separam pela ordem de aparição.
    const base = ['bb', p.data, p.nosso_numero || p.cnpj || p.nome, p.valor.toFixed(2)].join('|');
    const n = (vistas.get(base) || 0) + 1;
    vistas.set(base, n);
    const ref = n === 1 ? base : `${base}#${n}`;

    const item = { indice, ref, pagamento: p, situacao: null, conta_id: null, opcoes: [], motivo: null };

    if (jaImportadas.has(ref)) {
      return { ...item, situacao: 'ja_importado', motivo: 'Já importado antes deste relatório.' };
    }

    const nn = soDigitos(p.nosso_numero);

    // 1. Código de barras.
    if (nn.length === 25) {
      const pelaBarra = contas.find((c) => c.codigo_barras && c.codigo_barras.length === 44 &&
        c.codigo_barras.slice(19) === nn);
      if (pelaBarra) {
        if (pelaBarra.quitado || usadas.has(pelaBarra.id)) {
          return {
            ...item, situacao: 'ja_baixado', conta_id: pelaBarra.id,
            opcoes: [resumoConta(pelaBarra, p)],
            motivo: 'O boleto deste código já está quitado no sistema.',
          };
        }
        usadas.add(pelaBarra.id);
        return {
          ...item, situacao: 'codigo', conta_id: pelaBarra.id, opcoes: [resumoConta(pelaBarra, p)],
          motivo: 'Código de barras igual ao do boleto cadastrado.',
        };
      }
    }

    const cnpj = soDigitos(p.cnpj);
    const mesmoCnpj = (c) => cnpj && soDigitos(c.fornecedor_cnpj) === cnpj;
    // Sem CNPJ no cadastro do fornecedor não há como dizer que é outro: conta.
    const cnpjCompativel = (c) => !cnpj || !soDigitos(c.fornecedor_cnpj) || mesmoCnpj(c);

    // 2. Nosso número digitado à mão (só o final). Curto se repete entre
    // bancos, então precisa estar contido no do relatório E o CNPJ não pode
    // contradizer.
    if (nn) {
      const pelosNumeros = abertas().filter((c) => !c.codigo_barras && c.nosso_numero &&
        semZeros(c.nosso_numero).length >= 3 && nn.includes(semZeros(c.nosso_numero)) && cnpjCompativel(c));
      if (pelosNumeros.length === 1) {
        usadas.add(pelosNumeros[0].id);
        return {
          ...item, situacao: 'nosso_numero', conta_id: pelosNumeros[0].id,
          opcoes: [resumoConta(pelosNumeros[0], p)],
          motivo: 'Nosso número cadastrado aparece no do pagamento.',
        };
      }
    }

    // Pagamento que já foi baixado à mão antes da importação: mesma data,
    // mesmo valor, mesmo fornecedor. Não pode virar uma segunda baixa.
    const baixadaAMao = contas.find((c) =>
      (mesmoCnpj(c) || (!cnpj && nomesParecidos(c.fornecedor_nome, p.nome))) &&
      (c.pagamentos || []).some((pg) => String(pg.data_pagamento).slice(0, 10) === p.data &&
        Math.abs(Number(pg.valor) - p.valor) < CENTAVO));
    if (baixadaAMao) {
      return {
        ...item, situacao: 'ja_baixado', conta_id: baixadaAMao.id, opcoes: [resumoConta(baixadaAMao, p)],
        motivo: 'Já existe uma baixa deste valor, nesta data, para este fornecedor.',
      };
    }

    // 3 e 4. CNPJ + valor.
    const doCnpj = abertas().filter(mesmoCnpj);
    if (doCnpj.length) {
      const { contas: possiveis, juros } = explicadasPeloValor(p, doCnpj);
      if (possiveis.length) {
        const escolhida = possiveis[0];
        usadas.add(escolhida.id);
        return {
          ...item,
          situacao: possiveis.length > 1 ? 'escolher' : juros ? 'juros' : 'cnpj_valor',
          conta_id: escolhida.id,
          opcoes: possiveis.map((c) => resumoConta(c, p)),
          motivo: possiveis.length > 1
            ? `${possiveis.length} boletos deste fornecedor servem. Escolhi o de vencimento mais antigo; confira.`
            : juros
              ? 'Mesmo CNPJ. Pago depois do vencimento, com juros/multa.'
              : 'Mesmo CNPJ e mesmo valor.',
        };
      }
      // Fornecedor certo, valor que não explica nenhuma conta: mostra as
      // abertas para ele escolher, sem marcar nenhuma.
      return {
        ...item, situacao: 'escolher', conta_id: null,
        opcoes: doCnpj.sort(porVencimento).map((c) => resumoConta(c, p)),
        motivo: 'O fornecedor tem boletos em aberto, mas nenhum com este valor.',
      };
    }

    // 5. Pelo nome, quando o fornecedor não tem CNPJ no cadastro. Nunca
    // automático: nome engana.
    const peloNome = abertas().filter((c) => !soDigitos(c.fornecedor_cnpj) && nomesParecidos(c.fornecedor_nome, p.nome));
    if (peloNome.length) {
      const { contas: possiveis } = explicadasPeloValor(p, peloNome);
      const lista = possiveis.length ? possiveis : peloNome.sort(porVencimento);
      // Com valor que bate, já deixa a conta escolhida — mas a tela vem com a
      // caixa desmarcada: quem confirma é o dono.
      const sugerida = possiveis.length ? possiveis[0].id : null;
      if (sugerida) usadas.add(sugerida);
      return {
        ...item, situacao: 'pelo_nome', conta_id: sugerida,
        opcoes: lista.map((c) => resumoConta(c, p)),
        motivo: 'O fornecedor não tem CNPJ no cadastro; achei pelo nome. Confirme a conta.',
      };
    }

    return {
      ...item, situacao: 'sem_cadastro',
      motivo: p.tipo === 'Boleto'
        ? 'Nenhum boleto em aberto deste fornecedor no sistema.'
        : 'Não é boleto de fornecedor cadastrado (imposto, PIX, débito automático...).',
    };
  });
}

module.exports = { casarPagamentos, nomesParecidos, JUROS_MAXIMO };
