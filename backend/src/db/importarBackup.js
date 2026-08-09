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

async function importar(caminho, { dryRun = false } = {}) {
  const backup = JSON.parse(fs.readFileSync(caminho, 'utf8'));

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

    // 5) Acumulados (conferência de caixa)
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
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha na importação:', err.message);
    process.exit(1);
  });
}

module.exports = { importar };
