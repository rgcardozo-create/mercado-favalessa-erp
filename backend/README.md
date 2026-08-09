# Backend — Mercado Favalessa ERP

Backend Node.js/Express + PostgreSQL do sistema multiusuário, conforme `SPEC.md` na raiz do repositório.

## O que já está implementado

- Autenticação com JWT (login por usuário/senha, sem mais senha única).
- 3 perfis: `master`, `gerente`, `loja`.
- **Contas a pagar nas quatro telas** — Fornecedores, Despesas fixas, Impostos e Outras despesas — com pagamentos parciais (baixas) em tabela filha.
- Painel do dia (vencidas / vencem hoje / próximos 7 dias, com quebra por tela), só para Master e Gerente.
- **Conciliação** das maquininhas (Cielo, Stone, Itaú, Tickets) e do dinheiro por PDV.
- **Acumulado** (conferência de caixa), só para Master e Gerente.
- Importação do backup JSON da v3.
- Auditoria básica (quem cadastrou/editou/pagou o quê e quando).

### Como as quatro telas são modeladas

As quatro compartilham a mesma estrutura, então vivem na tabela `contas` separadas pela coluna `tipo` (`fornecedor`, `fixa`, `imposto`, `despesa`). Saldo, baixas parciais, filtros e Painel do dia valem para todas sem duplicação de código. A tela é escolhida por `?tipo=` na listagem.

`pessoais` e `extras` (Fases 3 e 4) **não** vão entrar nessa tabela de propósito: contas pessoais nunca podem aparecer em nenhum total da empresa, e extras já são descontados na folha. Mantê-las em tabelas próprias torna impossível vazarem para os totais por descuido (`SPEC.md`, regras 1 e 3).

## Regras de permissão implementadas

| Ação | Master | Gerente | Loja |
|---|---|---|---|
| Ver fornecedores/contas (todas as telas) | ✅ | ✅ | ✅ |
| Cadastrar fornecedor / lançamento | ✅ | ✅ | ✅ |
| Editar / excluir conta | ✅ | ✅ | ❌ |
| Registrar pagamento (baixa) | ✅ | ✅ | ❌ |
| Ver o Painel do dia | ✅ | ✅ | ❌ |
| Ver a Conciliação | ✅ | ✅ | ✅ |
| Ver / lançar Acumulado | ✅ | ✅ | ❌ |

> Assunção adotada para esta primeira versão: o login "Loja" pode cadastrar boletos mas não dar baixa nem editar/excluir, seguindo a frase da spec "cadastro de boleto pelos funcionários, pagamento só por quem tem permissão". Isso é exatamente um dos "itens em aberto" do `SPEC.md` (seção 6) — ajuste fácil em `src/routes/contas.routes.js` caso a decisão final seja outra (ex: Loja no mesmo nível de Gerente em tudo).

## Rodando localmente

```bash
cp .env.example .env
# edite .env com sua string de conexão Postgres e defina as senhas dos 3 usuários iniciais

npm install
npm run migrate   # cria as tabelas
npm run seed      # cria os 3 usuários iniciais (master/gerente/loja)
npm run dev        # inicia o servidor com reload automático
```

Health check: `GET /api/health`.

## Importando o backup do sistema antigo

```bash
npm run importar-backup -- caminho/do/backup.json            # importa
npm run importar-backup -- caminho/do/backup.json --dry-run  # simula, sem gravar
```

Importa `fornecedores`, `contas`, `fixas`, `impostos` e `despesas` do JSON exportado pela v3. Rodar mais de uma vez **não duplica** nada: cada registro guarda o `legado_id` do sistema antigo e é atualizado no lugar.

Detalhes de como o backup é interpretado:

- No sistema antigo `conta.fornecedor` é o **nome**, não um id. Nomes que aparecem em contas mas não estão no cadastro geram um fornecedor novo (marcado nas observações), em vez de perder o vínculo.
- Só `contas` e `despesas` guardam um array `pagamentos[]`. `fixas` e `impostos` registram um pagamento único solto no próprio registro (`valorPago`/`dataPagamento`) — o importador converte os dois formatos em linhas de `contas_pagamentos`, de onde o saldo é sempre calculado. O campo `pago` do JSON antigo é ignorado de propósito.
- `despesas` não têm vencimento próprio: a `data` da despesa é usada como vencimento, e a `categoria` é preservada.
- Campos preservados: parcela/total de parcelas, prioridade, observações, forma e origem do pagamento.
- A conciliação (~4,5 mil transações) é inserida em lotes; `hora` fica como texto porque os extratos usam formatos diferentes ("08:21", "9:45:46").

> **Dado inconsistente conhecido:** no extrato do Itaú o valor bruto (R$ 86,58) não bate com o líquido (R$ 2.473,56) — o parser do sistema atual trouxe esses campos incompletos. A importação preserva os valores como estão, sem "corrigir" histórico. Vale revisar quando a importação de extratos for reescrita.

> Os arquivos de backup **não devem ser commitados**: além dos dados financeiros, o bloco `meta` contém as senhas da Folha e das Contas particulares. O `.gitignore` já bloqueia os nomes usuais.

## Endpoints

- `POST /api/auth/login` — `{ email, senha }` → `{ token, usuario }`
- `GET /api/auth/me` — dados do usuário autenticado
- `GET /api/fornecedores` / `POST /api/fornecedores`
- `GET /api/contas` (aceita `?status=pendente|quitado` e `?tipo=fornecedor|fixa|imposto|despesa`)
- `GET /api/contas/:id` — inclui lista de pagamentos
- `POST /api/contas` — cadastra um lançamento (`tipo` padrão `fornecedor`; `categoria` usada em Outras despesas)
- `PUT /api/contas/:id` / `DELETE /api/contas/:id`
- `POST /api/contas/:id/pagamentos` — registra uma baixa (parcial ou total)
- `GET /api/painel-do-dia` — vencidas, vencem hoje e próximos 7 dias, com totais (Master/Gerente)
- `GET /api/conciliacao` — resumo por adquirente e dinheiro por PDV (aceita `?de=&ate=`)
- `GET /api/conciliacao/transacoes` — listagem paginada (`?adquirente=&de=&ate=&pagina=&limite=`)
- `GET /api/acumulados` (aceita `?de=&ate=`) / `POST /api/acumulados` / `DELETE /api/acumulados/:id` — Master e Gerente

O "hoje" do painel é calculado no fuso `America/Sao_Paulo` dentro do banco, não no fuso do servidor — o Railway roda em UTC, e depois das 21h de Brasília a data viraria antes da hora.

Todas as rotas exigem `Authorization: Bearer <token>`, exceto `/api/auth/login` e `/api/health`.

## Deploy no Railway

1. Criar um serviço PostgreSQL no Railway e copiar a `DATABASE_URL` gerada.
2. Criar um serviço a partir deste diretório `backend/` (build automático via `package.json`).
3. Configurar as variáveis de ambiente do `.env.example` no serviço.
4. Rodar `npm run migrate` e `npm run seed` uma vez (via Railway shell ou job) para inicializar o banco.

## Status por fase

- **Fase 1 — concluída.** Autenticação com os 3 perfis, Fornecedores/Contas a pagar, Painel do dia e importação do backup, testados com os dados reais.
- **Fase 2 — concluída.** Despesas fixas, Impostos, Outras despesas, Conciliação e Acumulado, todos importados do backup real. Fica pendente a **importação de novos extratos** (ver abaixo).
- **Fases 3 e 4** — não iniciadas: Venda a prazo, Cadastros, Relatórios, Folha/Extras (Master) e Contas pessoais (Master).

### Importação de novos extratos — em aberto

A conciliação hoje mostra o histórico que veio do backup. Para **carregar extratos novos**, o sistema atual lê a pasta `EXTRATOS\` do computador da loja via File System Access API, o que não funciona em nuvem — o servidor não enxerga o disco da loja.

O caminho previsto no `SPEC.md` é upload manual do arquivo pela tela. Isso ainda não foi feito porque exige um parser por adquirente (os arquivos são `.xlsx` com layouts diferentes: `CARTOES 01 S 23.xlsx`, `STONE 01 A 23.xlsx`), e escrever esse parser sem os arquivos reais em mãos seria chute. Assim que os arquivos de exemplo estiverem disponíveis, dá para implementar o upload.

Falta antes de usar em produção: subir no Railway (banco + serviço), definir as senhas reais dos 3 usuários e rodar a importação do backup mais recente. Conforme o `SPEC.md`, o sistema HTML atual deve seguir rodando em paralelo até estar validado em uso real.
