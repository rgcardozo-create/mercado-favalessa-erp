# Mercado Favalessa — Migração para sistema multiusuário em nuvem

> Documento de especificação técnica. Objetivo: servir de ponto de partida para uma sessão de **Claude Code**, contendo todo o contexto do sistema atual e o plano da nova arquitetura, sem precisar reexplicar tudo do zero.

---

## 1. Contexto — o que existe hoje

O sistema atual (`mercado_favalessa_v3_21_0_...html`, v3.21.0) é um **único arquivo HTML autocontido**, sem backend, com todos os dados salvos no `localStorage` do navegador (chave `mfv3_db`). Funciona muito bem para uso individual, mas **não suporta múltiplos usuários**: dados de um navegador não aparecem em outro, não existe login, e não há como dar permissões diferentes por pessoa.

Arquitetura interna do sistema atual (referência para reaproveitar lógica de negócio, não para reaproveitar código diretamente):

- Objeto global `state` (aba atual, edições em andamento) + `state.db` (dados).
- `render()` despacha para função `xxxHTML()` conforme `state.tab`, gera HTML via template literal, `bind()` reatribui os eventos.
- Helpers de dinheiro/data: `brl()`, `parseMoney()`, `today()` (fuso America/Sao_Paulo), `dateBR()`, `monthNow()`, `addDays()`, `mesAdd()`, `primeiroDiaMes()`, `ultimoDiaMes()`.
- **Padrão de pagamento parcial**: array `pagamentos[]`/`baixas[]` dentro de cada registro, nunca um simples `pago:true/false` quando existe parcial. Entidades que seguem esse padrão: `contas`, `folha`, `extras`, `despesas`, `pessoais`.

### Regras de negócio que NÃO podem ser perdidas na migração

1. **Contas pessoais nunca aparecem fora da própria tela de Contas pessoais** — não entram em nenhum total da empresa, dashboard ou relatório. Regra explícita do usuário.
2. **Nome de funcionário na Folha só aparece com a Folha destravada por senha.** Com a folha trancada, aparece como "Folha de pagamento" genérico nos relatórios; só o valor entra nos totais.
3. **`extras[]` (adiantamentos/vales) fica fora das somas de despesa da empresa** — já é descontado na folha; contar de novo duplicaria.
4. **Nunca esconder um registro só porque o saldo está zerado** — é preciso que exista pagamento registrado (`saldo<=0 && pago>0`) para considerar quitado. Um lançamento com valor líquido zero/negativo sem pagamento não pode sumir da lista.
5. **Gráficos nunca usam eixo duplo**, sempre uma escala só. Cores padrão: Receita `#059669`, Despesa `#DC2626`.

### Coleções de dados principais (hoje em `state.db`)

`contas[]` (fornecedores), `fixas[]`, `impostos[]`, `despesas[]` (outras despesas), `pessoais[]`, `folha[]`, `extras[]`, `funcionarios[]`, `fornecedores[]`, `clientes[]`, `movPrazo[]` (venda a prazo), `bancos[]`, `acumulados[]`, `pdvs[]` (legado, só leitura), `conciliacoes{dinheiro,cielo,stone,itau,tickets}`, `entradas[]`.

O usuário tem **backups em JSON** exportados regularmente (pasta `BKPS\Backup_1..7`) — serão a fonte para a migração de dados para o banco novo.

---

## 2. Decisões já tomadas com o usuário

| Decisão | Escolha |
|---|---|
| Hospedagem | **Nuvem** (não servidor físico na loja) — evita dependência de energia/internet da loja |
| Provedor sugerido | **Railway** para começar (Postgres integrado, custo baixo, simples de configurar). Migrar depois se crescer. |
| Acesso do usuário | Navegador (responsivo/PWA), sem necessidade de app nativo em loja de aplicativos |
| Número de usuários inicial | Até 3 logins simultâneos possíveis, sendo 3 perfis definidos |
| Ferramenta de desenvolvimento | Claude Code (projeto grande, contínuo, precisa de repositório real, testes, deploy) |

---

## 3. Perfis de acesso (RBAC)

| Perfil | Quem usa | Acesso |
|---|---|---|
| **Master** | Raphael (dono) | Acesso total a todas as telas, incluindo **Folha de pagamento** e **Extras de funcionários** (protegido por senha adicional, como já é hoje) |
| **Gerente** | A gerente da loja | Acesso quase total: Contas a pagar (Fornecedores, Despesas fixas, Impostos, Outras despesas — **exceto Folha/Extras**), Conciliação, Venda a prazo, Cadastros, Relatórios. **Não vê Folha nem Extras de funcionários.** |
| **Loja (geral)** | Login compartilhado para cobrir ausência da gerente (férias etc.) ou outro funcionário | Mesmo nível da Gerente por padrão. *(Ajustável depois para um nível mais restrito — ex. só cadastro de boletos — se o usuário quiser.)* |

**Acumulado (conferência de caixa/PDV):** visível apenas para **Master** e **Gerente** — não entra no login "Loja" geral. Decisão do usuário: é uma conferência que só faz sentido com supervisão.

Regras de visibilidade herdadas do sistema atual (item 1, 2 e 3 da seção anterior) continuam valendo — inclusive por perfil: **Contas pessoais só aparece para Master.**

---

## 4. Arquitetura proposta

```
┌─────────────────────┐
│   Frontend (PWA)     │  React ou similar, responsivo, instalável na tela
│   navegador / celular │  inicial do celular (sem loja de app)
└──────────┬───────────┘
           │ HTTPS (API REST/JSON)
┌──────────▼───────────┐
│   Backend (Node.js)   │  Autenticação (JWT/sessão), regras de permissão,
│   Express/Fastify      │  lógica de negócio (equivalente às funções xxxHTML
│                        │  de hoje, mas server-side)
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│   PostgreSQL (Railway) │  Uma tabela por coleção atual (contas, fixas,
│                        │  impostos, despesas, pessoais, folha, extras,
│                        │  funcionarios, fornecedores, clientes, movPrazo,
│                        │  conciliacoes, entradas, acumulados...)
└───────────────────────┘
```

- **Autenticação**: login com usuário/senha por pessoa (não mais só a senha única da Folha). Senhas com hash (bcrypt), sessão via JWT.
- **Autorização**: middleware no backend checando perfil (Master/Gerente/Loja) em cada rota — a regra não pode depender só do frontend esconder botão, tem que bloquear no servidor também.
- **Banco de dados**: schema relacional espelhando as coleções atuais, com `pagamentos`/`baixas` como tabelas filhas (chave estrangeira) em vez de array embutido — mais robusto para múltiplos usuários mexendo ao mesmo tempo.
- **Auditoria** (recomendado, novo): registrar quem cadastrou/editou/pagou o quê e quando — importante já que várias pessoas vão mexer no mesmo sistema. Não existia necessidade disso na versão single-user.

---

## 5. Plano de fases

### Fase 1 (começar agora)
- Backend + banco Postgres no Railway, do zero.
- Autenticação com os 3 perfis.
- **Contas a pagar > Fornecedores** completo e multiusuário (cadastro de boleto pelos funcionários, pagamento só por quem tem permissão).
- **Painel do dia** (dashboard de contas vencendo) para Master e Gerente.
- Importação do backup JSON atual para popular o banco novo sem perder histórico.

### Fase 2
- Despesas fixas, Impostos, Outras despesas.
- Conciliação (Cielo/Stone/Rede/Dinheiro/Tickets) — inclusive a importação automática da pasta `EXTRATOS\` (ver observação abaixo).
- Acumulado (Master + Gerente apenas).

### Fase 3
- Venda a prazo, Cadastros (clientes/fornecedores/funcionários/bancos).
- Relatórios com filtro de período (equivalente ao que já existe na v3.20.0).
- Folha de pagamento + Extras de funcionários (Master apenas).

### Fase 4
- ~~Contas pessoais (Master apenas — nunca visível a outros perfis).~~ **Retirado do escopo** por decisão do usuário: será tratado fora deste sistema, possivelmente em um aplicativo separado. A regra de nunca misturar valores pessoais com os totais da empresa continua valendo — nada pessoal entra neste banco.
- Refinamentos de UX/PWA, auditoria, exportação de backup.

> Observação sobre a pasta `EXTRATOS\`: a versão atual do sistema lê essa pasta local via File System Access API do navegador (só funciona rodando localmente). Num sistema em nuvem isso precisa ser repensado — provavelmente upload manual do arquivo pela tela (Gerente ou Master), já que o servidor não tem acesso ao disco do computador da loja. Avaliar na Fase 2.

---

## 6. Itens em aberto para decidir durante o desenvolvimento

- Nível de acesso exato do login "Loja" (igual à Gerente, ou mais restrito só a cadastro de boleto?).
- Se cada funcionário que só cadastra boleto deveria ter login individual (rastreabilidade) em vez de dividir um único login "Loja" — vale reconsiderar mais pra frente, mesmo não sendo prioridade agora.
- Domínio/URL do sistema em produção.
- Política de backup automático do Postgres no Railway (frequência, retenção).

---

## 7. Como retomar isso numa sessão de Claude Code

1. Criar repositório novo (ex: `mercado-favalessa-web`).
2. Colar este documento como `SPEC.md` na raiz do projeto.
3. Levar também os arquivos de histórico do sistema atual (`sistema-financeiro-historico.md`, `sistema-financeiro-overview.md`) para servir de referência de regras de negócio ao portar cada tela.
4. Começar pela Fase 1: schema do banco → autenticação → tela de Fornecedores → importação do backup JSON.
5. Manter o sistema HTML atual funcionando em paralelo até a Fase 1 estar validada em uso real — sem desligar o que já funciona.
