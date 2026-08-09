# Mercado Favalessa ERP

Sistema multiusuário em nuvem do Mercado Favalessa, substituindo a versão single-user em HTML/localStorage. Contexto completo, decisões e plano de fases em [`SPEC.md`](./SPEC.md).

## Estrutura do repositório

- `backend/` — API Node.js/Express + PostgreSQL (autenticação JWT, RBAC, regras de negócio). Ver `backend/README.md`.
- `frontend/` — scaffold estático inicial da interface (PWA), ainda não conectado ao backend.

## Status

**Fase 1 concluída**: autenticação com 3 perfis (Master/Gerente/Loja), Contas a pagar com baixas parciais, Painel do dia (Master/Gerente) e importação do backup JSON da v3 — validada com os dados reais.

**Fase 2 concluída**: Despesas fixas, Impostos, Outras despesas, Conciliação das maquininhas e Acumulado — todos importados do backup real. Fica pendente o upload de novos extratos (detalhes em `backend/README.md`).

**Fase 3 concluída**: Venda a prazo, Cadastros, Relatórios e Folha/Extras (Master, com senha adicional).

Falta o deploy no Railway. Próximos passos em `backend/README.md` e na seção 5 do `SPEC.md`.
