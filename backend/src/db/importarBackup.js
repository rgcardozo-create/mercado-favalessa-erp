require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

// Importa um backup JSON exportado pelo sistema v3 (single-user, localStorage) para
// o banco novo: fornecedores, contas a pagar (nas quatro telas), conciliação das
// maquininhas e acumulados.
//
// É idempotente: cada registro carrega o `legado_id` do sistema antigo, então rodar
// duas vezes atualiza em vez de duplicar.
//
// Uso: node src/db/importarBackup.js caminho/do/backup.json [--dry-run]

// Insere em lotes para não fazer milhares de round-trips (a conciliação sozinha
// traz ~4,5 mil transações).
async function inserirEmLote(client, { tabela, colunas, linhas, chaveConflito, tamanhoLote = 500 }) {
  let inseridas = 0;

  for (let i = 0; i < linhas.length; i += tamanhoLote) {
    const lote = linhas.slice(i, i + tamanhoLote);
    const params = [];
    const grupos = lote.map((linha) => {
      const marcadores = linha.map((valor) => {
        params.push(valor);
        return `$${params.length}`;
      });
      return `(${marcadores.join(', ')})`;
    });

    const atualizacoes = colunas
      .filter((c) => c !== chaveConflito)
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');

    await client.query(
      `INSERT INTO ${tabela} (${colunas.join(', ')})
       VALUES ${grupos.join(', ')}
       ON CONFLICT (${chaveConflito}) DO UPDATE SET ${atualizacoes}`,
      params
    );
    inseridas += lote.length;
  }

  return inseridas;
}

const ADQUIRENTES = ['cielo', 'stone', 'itau', 'tickets'];

function normalizarNome(nome) {
  return String(nome || '').trim();
}

function chaveNome(nome) {
  return normalizarNome(nome).toUpperCase();
}

function paraNumero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function paraInteiroOuNull(valor) {
  const n = parseInt(valor, 10);
  return Number.isFinite(n) ? n : null;
}

function textoOuNull(valor) {
  const t = String(valor ?? '').trim();
  return t === '' ? null : t;
}

// No sistema antigo só `contas` e `despesas` guardam um array `pagamentos[]`.
// `fixas` e `impostos` registram um pagamento único solto no próprio registro
// (valorPago/dataPagamento/formaPagamento). Aqui os dois formatos viram a mesma
// coisa: linhas na tabela de baixas, de onde o saldo é sempre calculado.
function baixasDoRegistro(registro) {
  if (Array.isArray(registro.pagamentos) && registro.pagamentos.length) {
    return registro.pagamentos.map((p) => ({
      valor: paraNumero(p.valor),
      data: p.data,
      forma: p.forma,
      origem: p.origem,
      obs: p.obs,
      legadoId: p.id,
    }));
  }

  const valorPago = paraNumero(registro.valorPago);
  if (valorPago <= 0 || !registro.dataPagamento) return [];

  return [
    {
      valor: valorPago,
      data: registro.dataPagamento,
      forma: registro.formaPagamento,
      origem: registro.origemPagamento,
      obs: registro.obsPagamento,
      // O pagamento não tem id próprio no backup; derivamos um a partir do
      // registro pai para a importação continuar idempotente.
      legadoId: `${registro.id}:pag`,
    },
  ];
}

async function gravarConta(client, { registro, tipo, fornecedorId = null, vencimento, categoria = null, resumo }) {
  const { rows } = await client.query(
    `INSERT INTO contas
       (tipo, categoria, fornecedor_id, descricao, valor, vencimento, prioridade,
        parcela, total_parcelas, observacoes, legado_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (legado_id) DO UPDATE
       SET tipo = EXCLUDED.tipo,
           categoria = EXCLUDED.categoria,
           fornecedor_id = EXCLUDED.fornecedor_id,
           descricao = EXCLUDED.descricao,
           valor = EXCLUDED.valor,
           vencimento = EXCLUDED.vencimento,
           prioridade = EXCLUDED.prioridade,
           parcela = EXCLUDED.parcela,
           total_parcelas = EXCLUDED.total_parcelas,
           observacoes = EXCLUDED.observacoes,
           atualizado_em = now()
     RETURNING id`,
    [
      tipo,
      textoOuNull(categoria),
      fornecedorId,
      normalizarNome(registro.desc) || '(sem descrição)',
      paraNumero(registro.valor),
      vencimento,
      paraInteiroOuNull(registro.prio),
      paraInteiroOuNull(registro.parcela),
      paraInteiroOuNull(registro.totalParcelas),
      textoOuNull(registro.obs),
      registro.id,
    ]
  );
  const contaId = rows[0].id;
  resumo.contasImportadas[tipo] += 1;

  for (const b of baixasDoRegistro(registro)) {
    if (b.valor <= 0 || !b.data) continue; // a tabela exige valor > 0 e data
    await client.query(
      `INSERT INTO contas_pagamentos
         (conta_id, valor, data_pagamento, forma_pagamento, origem, observacoes, legado_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (legado_id) DO UPDATE
         SET conta_id = EXCLUDED.conta_id,
             valor = EXCLUDED.valor,
             data_pagamento = EXCLUDED.data_pagamento,
             forma_pagamento = EXCLUDED.forma_pagamento,
             origem = EXCLUDED.origem,
             observacoes = EXCLUDED.observacoes`,
      [contaId, b.valor, b.data, textoOuNull(b.forma), textoOuNull(b.origem), textoOuNull(b.obs), b.legadoId]
    );
    resumo.pagamentosImportados += 1;
  }

  return contaId;
}

// Recebe o backup já em objeto. É esta função que a tela de Administração usa,
// para não depender de o arquivo estar no disco do servidor.
async function importarDados(backup, { dryRun = false } = {}) {
  if (!backup || typeof backup !== 'object') {
    throw new Error('Backup inválido: esperado um objeto JSON.');
  }

  const fornecedoresBackup = backup.fornecedores || [];
  const contasBackup = backup.contas || [];

  const resumo = {
    fornecedoresImportados: 0,
    fornecedoresCriadosPorReferencia: 0,
    contasImportadas: { fornecedor: 0, fixa: 0, imposto: 0, despesa: 0 },
    pagamentosImportados: 0,
    contasSemFornecedor: 0,
    conciliacao: { cielo: 0, stone: 0, itau: 0, tickets: 0, dinheiro: 0 },
    acumulados: 0,
    clientes: 0,
    funcionarios: 0,
    bancos: 0,
    movPrazo: 0,
    movPrazoSemCliente: 0,
    folha: 0,
    folhaPagamentos: 0,
    extras: 0,
    extrasBaixas: 0,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fornecedores que já existem no banco, indexados por nome. Sem isso, um fornecedor
    // criado por referência numa importação anterior (que não tem legado_id) seria
    // recriado a cada nova execução.
    const idPorNome = new Map();
    const { rows: existentes } = await client.query('SELECT id, nome FROM fornecedores');
    for (const f of existentes) {
      idPorNome.set(chaveNome(f.nome), f.id);
    }

    // 1) Fornecedores do cadastro
    for (const f of fornecedoresBackup) {
      const nome = normalizarNome(f.nome);
      if (!nome) continue;

      const { rows } = await client.query(
        `INSERT INTO fornecedores (nome, cnpj_cpf, telefone, pix, legado_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (legado_id) DO UPDATE
           SET nome = EXCLUDED.nome,
               cnpj_cpf = EXCLUDED.cnpj_cpf,
               telefone = EXCLUDED.telefone,
               pix = EXCLUDED.pix
         RETURNING id`,
        [nome, textoOuNull(f.doc), textoOuNull(f.contato), textoOuNull(f.pix), f.id]
      );
      idPorNome.set(chaveNome(nome), rows[0].id);
      resumo.fornecedoresImportados += 1;
    }

    // 2) Contas. No sistema antigo `conta.fornecedor` é o NOME, não um id —
    // e existem nomes usados em contas que nunca entraram no cadastro, então
    // criamos o fornecedor faltante em vez de perder o vínculo.
    for (const c of contasBackup) {
      const nomeFornecedor = normalizarNome(c.fornecedor);
      let fornecedorId = null;

      if (nomeFornecedor) {
        fornecedorId = idPorNome.get(chaveNome(nomeFornecedor)) || null;
        if (!fornecedorId) {
          const { rows } = await client.query(
            `INSERT INTO fornecedores (nome, observacoes)
             VALUES ($1, $2) RETURNING id`,
            [nomeFornecedor, 'Criado automaticamente na importação do backup (só aparecia em contas).']
          );
          fornecedorId = rows[0].id;
          idPorNome.set(chaveNome(nomeFornecedor), fornecedorId);
          resumo.fornecedoresCriadosPorReferencia += 1;
        }
      } else {
        resumo.contasSemFornecedor += 1;
      }

      await gravarConta(client, {
        registro: c,
        tipo: 'fornecedor',
        fornecedorId,
        vencimento: c.vencimento,
        resumo,
      });
    }

    // 3) Despesas fixas, Impostos e Outras despesas — mesma estrutura das contas de
    // fornecedor, então vão para a mesma tabela separadas por `tipo`.
    for (const f of backup.fixas || []) {
      await gravarConta(client, { registro: f, tipo: 'fixa', vencimento: f.vencimento, resumo });
    }
    for (const i of backup.impostos || []) {
      await gravarConta(client, { registro: i, tipo: 'imposto', vencimento: i.vencimento, resumo });
    }
    for (const dsp of backup.despesas || []) {
      // "Outras despesas" não têm vencimento próprio: a data da despesa é o que vale.
      await gravarConta(client, {
        registro: dsp,
        tipo: 'despesa',
        vencimento: dsp.data,
        categoria: dsp.categoria,
        resumo,
      });
    }

    // 4) Conciliação: transações das maquininhas + conferência de dinheiro por PDV.
    const conciliacoes = backup.conciliacoes || {};
    const transacoes = [];
    for (const adquirente of ADQUIRENTES) {
      for (const t of conciliacoes[adquirente] || []) {
        transacoes.push([
          adquirente,
          t.data,
          textoOuNull(t.hora),
          textoOuNull(t.forma),
          textoOuNull(t.bandeira),
          paraNumero(t.valorBruto),
          paraNumero(t.tarifa),
          paraNumero(t.valorLiquido),
          textoOuNull(t.categoria),
          textoOuNull(t.status),
          textoOuNull(t.lote),
          textoOuNull(t.arquivo),
          t.importadoEm || null,
          t.id,
        ]);
        resumo.conciliacao[adquirente] += 1;
      }
    }

    if (transacoes.length) {
      await inserirEmLote(client, {
        tabela: 'conciliacao_transacoes',
        colunas: [
          'adquirente', 'data', 'hora', 'forma', 'bandeira', 'valor_bruto', 'tarifa',
          'valor_liquido', 'categoria', 'status', 'lote', 'arquivo', 'importado_em', 'legado_id',
        ],
        linhas: transacoes,
        chaveConflito: 'legado_id',
      });
    }

    const dinheiro = (conciliacoes.dinheiro || []).map((d) => [
      d.data,
      textoOuNull(d.pdv),
      paraNumero(d.valor),
      d.id,
    ]);
    if (dinheiro.length) {
      await inserirEmLote(client, {
        tabela: 'conciliacao_dinheiro',
        colunas: ['data', 'pdv', 'valor', 'legado_id'],
        linhas: dinheiro,
        chaveConflito: 'legado_id',
      });
      resumo.conciliacao.dinheiro = dinheiro.length;
    }

    // 5) Cadastros: clientes, funcionários e bancos
    const clientes = (backup.clientes || []).map((c) => [
      textoOuNull(c.codigo),
      normalizarNome(c.nome) || '(sem nome)',
      textoOuNull(c.telefone),
      textoOuNull(c.doc),
      textoOuNull(c.obs),
      c.id,
    ]);
    if (clientes.length) {
      await inserirEmLote(client, {
        tabela: 'clientes',
        colunas: ['codigo', 'nome', 'telefone', 'cpf_cnpj', 'observacoes', 'legado_id'],
        linhas: clientes,
        chaveConflito: 'legado_id',
      });
      resumo.clientes = clientes.length;
    }

    const funcionarios = (backup.funcionarios || []).map((f) => [
      textoOuNull(f.codigo),
      normalizarNome(f.nome) || '(sem nome)',
      textoOuNull(f.telefone),
      textoOuNull(f.cpf),
      textoOuNull(f.pix),
      textoOuNull(f.obs),
      f.id,
    ]);
    if (funcionarios.length) {
      await inserirEmLote(client, {
        tabela: 'funcionarios',
        colunas: ['codigo', 'nome', 'telefone', 'cpf', 'pix', 'observacoes', 'legado_id'],
        linhas: funcionarios,
        chaveConflito: 'legado_id',
      });
      resumo.funcionarios = funcionarios.length;
    }

    const bancos = (backup.bancos || []).map((b) => [
      normalizarNome(b.nome) || '(sem nome)',
      Boolean(b.padrao),
      b.id,
    ]);
    if (bancos.length) {
      await inserirEmLote(client, {
        tabela: 'bancos',
        colunas: ['nome', 'padrao', 'legado_id'],
        linhas: bancos,
        chaveConflito: 'legado_id',
      });
      resumo.bancos = bancos.length;
    }

    // 6) Venda a prazo. No sistema antigo o movimento aponta para o CÓDIGO do
    // cliente, não para um id — resolvemos aqui para virar chave estrangeira.
    const { rows: clientesGravados } = await client.query('SELECT id, codigo FROM clientes');
    const idPorCodigo = new Map(clientesGravados.map((c) => [String(c.codigo), c.id]));

    const movimentos = (backup.movPrazo || []).map((m) => [
      idPorCodigo.get(String(m.codigo)) || null,
      m.tipo === 'pagamento' ? 'pagamento' : 'compra',
      paraNumero(m.valor),
      m.data,
      textoOuNull(m.obs),
      m.id,
    ]);
    if (movimentos.length) {
      await inserirEmLote(client, {
        tabela: 'mov_prazo',
        colunas: ['cliente_id', 'tipo', 'valor', 'data', 'observacoes', 'legado_id'],
        linhas: movimentos,
        chaveConflito: 'legado_id',
      });
      resumo.movPrazo = movimentos.length;
      resumo.movPrazoSemCliente = movimentos.filter((m) => m[0] === null).length;
    }

    // 7) Folha e Extras. Vinculamos ao funcionário pelo nome quando der — no
    // sistema antigo a folha guarda só o nome digitado, que nem sempre bate
    // exatamente com o cadastro (ex.: "MARIA DA PENHA" vs "MARIA DA PENHA FAVALESSA").
    const { rows: funcsGravados } = await client.query('SELECT id, nome, codigo FROM funcionarios');
    const acharFuncionario = (nome, codigo) => {
      if (codigo) {
        const porCodigo = funcsGravados.find((f) => String(f.codigo) === String(codigo));
        if (porCodigo) return porCodigo.id;
      }
      const alvo = chaveNome(nome);
      if (!alvo) return null;
      const exato = funcsGravados.find((f) => chaveNome(f.nome) === alvo);
      if (exato) return exato.id;
      const parcial = funcsGravados.find(
        (f) => alvo.startsWith(chaveNome(f.nome)) || chaveNome(f.nome).startsWith(alvo)
      );
      return parcial ? parcial.id : null;
    };

    for (const f of backup.folha || []) {
      const { rows } = await client.query(
        `INSERT INTO folha
           (funcionario_id, nome, tipo, data_ref, salario, bonificacao, compras,
            adiantamento, outras, descontos, dias_ferias, observacoes, legado_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (legado_id) DO UPDATE
           SET funcionario_id = EXCLUDED.funcionario_id, nome = EXCLUDED.nome,
               tipo = EXCLUDED.tipo, data_ref = EXCLUDED.data_ref,
               salario = EXCLUDED.salario, bonificacao = EXCLUDED.bonificacao,
               compras = EXCLUDED.compras, adiantamento = EXCLUDED.adiantamento,
               outras = EXCLUDED.outras, descontos = EXCLUDED.descontos,
               dias_ferias = EXCLUDED.dias_ferias, observacoes = EXCLUDED.observacoes,
               atualizado_em = now()
         RETURNING id`,
        [
          acharFuncionario(f.nome, null),
          normalizarNome(f.nome) || '(sem nome)',
          textoOuNull(f.tipo),
          f.dataRef || null,
          paraNumero(f.salario),
          paraNumero(f.bonificacao),
          paraNumero(f.compras),
          paraNumero(f.adiantamento),
          paraNumero(f.outras),
          paraNumero(f.descontos),
          paraInteiroOuNull(f.diasFerias),
          textoOuNull(f.obs),
          f.id,
        ]
      );
      resumo.folha += 1;

      for (const b of baixasDoRegistro(f)) {
        if (b.valor <= 0 || !b.data) continue;
        await client.query(
          `INSERT INTO folha_pagamentos (folha_id, valor, data_pagamento, forma_pagamento, observacoes, legado_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (legado_id) DO UPDATE
             SET folha_id = EXCLUDED.folha_id, valor = EXCLUDED.valor,
                 data_pagamento = EXCLUDED.data_pagamento,
                 forma_pagamento = EXCLUDED.forma_pagamento,
                 observacoes = EXCLUDED.observacoes`,
          [rows[0].id, b.valor, b.data, textoOuNull(b.forma), textoOuNull(b.obs), b.legadoId]
        );
        resumo.folhaPagamentos += 1;
      }
    }

    for (const e of backup.extras || []) {
      const { rows } = await client.query(
        `INSERT INTO extras (funcionario_id, nome, codigo, tipo, valor, data, observacoes, legado_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (legado_id) DO UPDATE
           SET funcionario_id = EXCLUDED.funcionario_id, nome = EXCLUDED.nome,
               codigo = EXCLUDED.codigo, tipo = EXCLUDED.tipo, valor = EXCLUDED.valor,
               data = EXCLUDED.data, observacoes = EXCLUDED.observacoes
         RETURNING id`,
        [
          acharFuncionario(e.funcionarioNome, e.funcionarioCodigo),
          normalizarNome(e.funcionarioNome) || '(sem nome)',
          textoOuNull(e.funcionarioCodigo),
          textoOuNull(e.tipo),
          paraNumero(e.valor),
          e.data,
          textoOuNull(e.obs),
          e.id,
        ]
      );
      resumo.extras += 1;

      for (const b of e.baixas || []) {
        const valor = paraNumero(b.valor);
        if (valor <= 0 || !b.data) continue;
        await client.query(
          `INSERT INTO extras_baixas (extra_id, valor, data, observacoes, legado_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (legado_id) DO UPDATE
             SET extra_id = EXCLUDED.extra_id, valor = EXCLUDED.valor,
                 data = EXCLUDED.data, observacoes = EXCLUDED.observacoes`,
          [rows[0].id, valor, b.data, textoOuNull(b.obs), b.id]
        );
        resumo.extrasBaixas += 1;
      }
    }

    // 8) Acumulados (conferência de caixa)
    const acumulados = (backup.acumulados || []).map((a) => [
      a.data,
      paraNumero(a.dinheiro),
      paraNumero(a.cartao),
      paraNumero(a.pix),
      paraNumero(a.tickets),
      paraNumero(a.posSistema),
      paraNumero(a.posMaquina),
      paraNumero(a.outras),
      textoOuNull(a.obs),
      a.id,
    ]);
    if (acumulados.length) {
      await inserirEmLote(client, {
        tabela: 'acumulados',
        colunas: [
          'data', 'dinheiro', 'cartao', 'pix', 'tickets', 'pos_sistema',
          'pos_maquina', 'outras', 'observacoes', 'legado_id',
        ],
        linhas: acumulados,
        chaveConflito: 'legado_id',
      });
      resumo.acumulados = acumulados.length;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('DRY RUN — nada foi gravado.');
    } else {
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return resumo;
}

// Versão por arquivo, usada pela linha de comando.
async function importar(caminho, opts = {}) {
  return importarDados(JSON.parse(fs.readFileSync(caminho, 'utf8')), opts);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const caminho = args.find((a) => !a.startsWith('--'));

  if (!caminho) {
    console.error('Uso: node src/db/importarBackup.js caminho/do/backup.json [--dry-run]');
    process.exit(1);
  }

  const resumo = await importar(path.resolve(caminho), { dryRun });
  const c = resumo.contasImportadas;
  console.log('Importação concluída:');
  console.log(`  Fornecedores do cadastro:            ${resumo.fornecedoresImportados}`);
  console.log(`  Fornecedores criados por referência: ${resumo.fornecedoresCriadosPorReferencia}`);
  console.log(`  Contas de fornecedor:                ${c.fornecedor}`);
  console.log(`  Despesas fixas:                      ${c.fixa}`);
  console.log(`  Impostos:                            ${c.imposto}`);
  console.log(`  Outras despesas:                     ${c.despesa}`);
  console.log(`  Pagamentos (baixas):                 ${resumo.pagamentosImportados}`);
  console.log(`  Contas sem fornecedor informado:     ${resumo.contasSemFornecedor}`);
  const cc = resumo.conciliacao;
  console.log(`  Conciliação — Cielo:                 ${cc.cielo}`);
  console.log(`  Conciliação — Stone:                 ${cc.stone}`);
  console.log(`  Conciliação — Itaú:                  ${cc.itau}`);
  console.log(`  Conciliação — Tickets:               ${cc.tickets}`);
  console.log(`  Conciliação — Dinheiro (PDV):        ${cc.dinheiro}`);
  console.log(`  Acumulados:                          ${resumo.acumulados}`);
  console.log(`  Clientes:                            ${resumo.clientes}`);
  console.log(`  Funcionários:                        ${resumo.funcionarios}`);
  console.log(`  Bancos:                              ${resumo.bancos}`);
  console.log(`  Venda a prazo (movimentos):          ${resumo.movPrazo}` +
    (resumo.movPrazoSemCliente ? ` (${resumo.movPrazoSemCliente} sem cliente)` : ''));
  console.log(`  Folha (lançamentos):                 ${resumo.folha}`);
  console.log(`  Folha (pagamentos):                  ${resumo.folhaPagamentos}`);
  console.log(`  Extras de funcionários:              ${resumo.extras}`);
  console.log(`  Extras (baixas):                     ${resumo.extrasBaixas}`);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha na importação:', err.message);
    process.exit(1);
  });
}

module.exports = { importar, importarDados };
