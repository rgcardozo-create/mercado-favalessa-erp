# Backend — Mercado Favalessa ERP (Fase 1)

Backend Node.js/Express + PostgreSQL do sistema multiusuário, conforme `SPEC.md` na raiz do repositório.

## Escopo desta Fase 1

- Autenticação com JWT (login por usuário/senha, sem mais senha única).
- 3 perfis: `master`, `gerente`, `loja`.
- Fornecedores e Contas a pagar (cadastro de boleto) com pagamentos parciais (baixas) em tabela filha.
- Auditoria básica (quem cadastrou/editou/pagou o quê e quando).

## Regras de permissão implementadas

| Ação | Master | Gerente | Loja |
|---|---|---|---|
| Ver fornecedores/contas | ✅ | ✅ | ✅ |
| Cadastrar fornecedor / boleto | ✅ | ✅ | ✅ |
| Editar / excluir conta | ✅ | ✅ | ❌ |
| Registrar pagamento (baixa) | ✅ | ✅ | ❌ |

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

## Endpoints

- `POST /api/auth/login` — `{ email, senha }` → `{ token, usuario }`
- `GET /api/auth/me` — dados do usuário autenticado
- `GET /api/fornecedores` / `POST /api/fornecedores`
- `GET /api/contas` (aceita `?status=pendente|quitado`)
- `GET /api/contas/:id` — inclui lista de pagamentos
- `POST /api/contas` — cadastra uma conta/boleto
- `PUT /api/contas/:id` / `DELETE /api/contas/:id`
- `POST /api/contas/:id/pagamentos` — registra uma baixa (parcial ou total)

Todas as rotas exigem `Authorization: Bearer <token>`, exceto `/api/auth/login` e `/api/health`.

## Deploy no Railway

1. Criar um serviço PostgreSQL no Railway e copiar a `DATABASE_URL` gerada.
2. Criar um serviço a partir deste diretório `backend/` (build automático via `package.json`).
3. Configurar as variáveis de ambiente do `.env.example` no serviço.
4. Rodar `npm run migrate` e `npm run seed` uma vez (via Railway shell ou job) para inicializar o banco.

## O que falta para fechar a Fase 1 (ver `SPEC.md`)

- Painel do dia (dashboard de contas vencendo).
- Importação do backup JSON atual para popular o banco novo.
- Frontend (PWA) consumindo esta API — o scaffold estático em `frontend/` ainda não está conectado ao backend.
