# Mercado Favalessa ERP

Sistema multiusuário em nuvem do Mercado Favalessa, substituindo a versão single-user em HTML/localStorage. Contexto completo, decisões e plano de fases em [`SPEC.md`](./SPEC.md).

## Estrutura do repositório

- `backend/` — API Node.js/Express + PostgreSQL (autenticação JWT, RBAC, regras de negócio). Ver [`backend/README.md`](./backend/README.md).
- `frontend/` — interface web (PWA instalável), em JavaScript puro. Ver [`frontend/README.md`](./frontend/README.md).

## Status

Todas as quatro fases do `SPEC.md` estão implementadas e validadas com o backup real de 08/08/2026:

| Fase | O que entrou |
|---|---|
| 1 | Autenticação com 3 perfis, Contas a pagar > Fornecedores, Painel do dia, importação do backup |
| 2 | Despesas fixas, Impostos, Outras despesas, Conciliação das maquininhas, Acumulado |
| 3 | Venda a prazo, Cadastros, Relatórios, Folha e Extras (Master + senha adicional) |
| 4 | PWA instalável, trilha de auditoria, exportação de backup |

**Contas pessoais foi retirada do escopo** por decisão do usuário — será tratada fora deste sistema.

## Colocando no ar

Passo a passo em [`DEPLOY.md`](./DEPLOY.md). Em produção o backend serve também o frontend, então **um serviço só** no Railway coloca o sistema inteiro no ar, com a interface e a API no mesmo endereço.

Resumo: criar o Postgres, criar o serviço a partir deste repositório, configurar as variáveis (senhas e `JWT_SECRET`), rodar `npm run migrate` e `npm run seed`, e importar o backup mais recente.

Conforme o `SPEC.md`, o sistema HTML atual deve seguir rodando em paralelo até isso estar validado em uso real.

## Rodando localmente

```bash
npm install          # instala o backend
cp backend/.env.example backend/.env   # preencha as variáveis
npm run migrate && npm run seed
npm start            # sistema completo em http://localhost:3000
```

Uma pendência conhecida: **carregar novos extratos de cartão** ainda não é possível pela tela — a conciliação hoje mostra o histórico importado. Detalhes em `backend/README.md`.
