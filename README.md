# Mercado Favalessa ERP

Sistema multiusuário em nuvem do Mercado Favalessa, substituindo a versão single-user em HTML/localStorage. Contexto completo, decisões e plano de fases em [`SPEC.md`](./SPEC.md).

## Estrutura do repositório

- `backend/` — API Node.js/Express + PostgreSQL (autenticação JWT, RBAC, regras de negócio). Ver `backend/README.md`.
- `frontend/` — scaffold estático inicial da interface (PWA), ainda não conectado ao backend.

## Status

Fase 1 em andamento: autenticação com 3 perfis (Master/Gerente/Loja) e Fornecedores/Contas a pagar completos no backend. Próximos passos em `backend/README.md` e na seção 5 do `SPEC.md`.
