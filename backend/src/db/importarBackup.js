require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

// Importa um backup JSON exportado pelo sistema v3 (single-user, localStorage) para
// o banco novo. Escopo Fase 1: fornecedores, contas a pagar e seus pagamentos.
//
// É idempotente: cada registro carrega o `legado_id` do sistema antigo, então rodar
// duas vezes atualiza em vez de duplicar.
//
// Uso: node src/db/importarBackup.js caminho/do/backup.json [--dry-run]

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

async function importar(caminho, { dryRun = false } = {}) {
  const backup = JSON.parse(fs.readFileSync(caminho, 'utf8'));

  const fornecedoresBackup = backup.fornecedores || [];
  const contasBackup = backup.contas || [];

  const resumo = {
    fornecedoresImportados: 0,
    fornecedoresCriadosPorReferencia: 0,
    contasImportadas: 0,
    pagamentosImportados: 0,
    contasSemFornecedor: 0,
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

      const { rows: contaRows } = await client.query(
        `INSERT INTO contas
           (fornecedor_id, descricao, valor, vencimento, prioridade, parcela,
            total_parcelas, observacoes, legado_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (legado_id) DO UPDATE
           SET fornecedor_id = EXCLUDED.fornecedor_id,
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
          fornecedorId,
          normalizarNome(c.desc) || '(sem descrição)',
          paraNumero(c.valor),
          c.vencimento,
          paraInteiroOuNull(c.prio),
          paraInteiroOuNull(c.parcela),
          paraInteiroOuNull(c.totalParcelas),
          textoOuNull(c.obs),
          c.id,
        ]
      );
      const contaId = contaRows[0].id;
      resumo.contasImportadas += 1;

      // 3) Pagamentos (baixas). Nunca derivamos "pago" de um booleano: cada baixa
      // registrada no array vira uma linha, e o saldo/quitação é calculado a partir delas.
      for (const p of c.pagamentos || []) {
        const valorPago = paraNumero(p.valor);
        if (valorPago <= 0) continue; // a tabela exige valor > 0

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
          [
            contaId,
            valorPago,
            p.data,
            textoOuNull(p.forma),
            textoOuNull(p.origem),
            textoOuNull(p.obs),
            p.id,
          ]
        );
        resumo.pagamentosImportados += 1;
      }
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
  console.log('Importação concluída:');
  console.log(`  Fornecedores do cadastro:            ${resumo.fornecedoresImportados}`);
  console.log(`  Fornecedores criados por referência: ${resumo.fornecedoresCriadosPorReferencia}`);
  console.log(`  Contas:                              ${resumo.contasImportadas}`);
  console.log(`  Pagamentos (baixas):                 ${resumo.pagamentosImportados}`);
  console.log(`  Contas sem fornecedor informado:     ${resumo.contasSemFornecedor}`);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha na importação:', err.message);
    process.exit(1);
  });
}

module.exports = { importar };
