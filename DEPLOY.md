# Deploy no Railway — passo a passo

O backend serve também o frontend, então **um serviço só** no Railway coloca o sistema inteiro no ar. A interface e a API ficam no mesmo endereço, o que evita configuração de proxy e de CORS.

---

## 1. Criar o banco

1. No Railway, abra seu projeto → **New** → **Database** → **Add PostgreSQL**.
2. Abra o serviço do Postgres → aba **Variables** → copie o valor de `DATABASE_URL`.

## 2. Criar o serviço do sistema

1. **New** → **GitHub Repo** → escolha `rgcardozo-create/mercado-favalessa-erp`.
2. Selecione a branch que você quer publicar.
3. **Não** mexa em "Root Directory" — o repositório inteiro precisa ser copiado, porque o backend serve os arquivos do `frontend/`.

O build é automático: o `package.json` da raiz instala o backend e o `railway.json` define o comando de start e o health check em `/api/health`.

## 3. Configurar as variáveis

No serviço do sistema, aba **Variables**, adicione:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a string copiada do Postgres |
| `JWT_SECRET` | um valor aleatório longo — gere com `openssl rand -hex 32` |
| `FOLHA_SENHA` | a senha adicional da Folha |
| `SEED_MASTER_SENHA` | senha do seu login |
| `SEED_GERENTE_SENHA` | senha da gerente |
| `SEED_LOJA_SENHA` | senha do login compartilhado da loja |
| `NODE_ENV` | `production` |

Opcionais: `SEED_MASTER_EMAIL`, `SEED_GERENTE_EMAIL`, `SEED_LOJA_EMAIL` (se quiser e-mails diferentes dos padrões), `JWT_EXPIRES_IN` (padrão `8h`), `FOLHA_TOKEN_EXPIRES_IN` (padrão `30m`).

Não é preciso definir `PORT` — o Railway injeta sozinho.

> As senhas ficam **só** nas variáveis do Railway. Nunca as coloque em arquivo no repositório.

## 4. Inicializar o banco

Depois do primeiro deploy, no serviço do sistema abra o terminal do Railway e rode:

```bash
npm run migrate   # cria as tabelas
npm run seed      # cria os 3 usuários e grava a senha da Folha
```

## 5. Importar os dados atuais

Pela tela, sem terminal: entre como Master → aba **Administração** → seção **Importar backup do sistema antigo**.

1. Escolha o arquivo JSON exportado pela versão antiga.
2. Clique em **Simular** — nada é gravado, só mostra quantos registros de cada tipo seriam importados. Confira se os números fazem sentido.
3. Se estiver certo, clique em **Importar de verdade**.

Pode repetir quantas vezes quiser: a importação é idempotente e **atualiza no lugar em vez de duplicar**. Na prática, dá para reimportar um backup mais novo sempre que quiser, até o dia em que o sistema antigo for desligado.

> Também existe o caminho por linha de comando, se preferir: `npm run importar-backup -- caminho/do/backup.json` (aceita `--dry-run`).

## 6. Publicar o endereço

No serviço, aba **Settings** → **Networking** → **Generate Domain**. O endereço gerado já serve a interface. Para usar domínio próprio, é nessa mesma tela.

## 7. Conferir

1. Abra o endereço e faça login como Master.
2. Veja se o Painel do dia mostra as contas vencendo.
3. Confira um total conhecido (ex.: Fornecedores) contra o sistema antigo.
4. No celular, use "Adicionar à tela de início" para instalar o app.

---

## Backup automático do Postgres

O `SPEC.md` deixou em aberto a política de backup. Duas frentes, que se complementam:

- **No Railway**: o serviço do Postgres tem backups no próprio painel (aba **Backups**). Vale configurar a frequência e conferir a retenção do seu plano.
- **No sistema**: a tela **Administração** exporta tudo em JSON, do mesmo jeito que você já fazia com a v3. Vale manter o hábito de baixar periodicamente e guardar fora do Railway.

> A folha só entra no arquivo exportado se estiver destravada. Se quiser um backup completo, destrave a folha antes de baixar.

## Enquanto o sistema antigo continua rodando

Conforme o `SPEC.md`, o HTML atual deve seguir em uso em paralelo até este sistema estar validado no dia a dia. Nesse período, o fluxo é: continuar usando o antigo como fonte oficial, reimportar o backup aqui de tempos em tempos, e ir conferindo os números. Quando bater com confiança, aí sim vira o oficial.

## Problemas comuns

**A tela abre mas o login falha.** Quase sempre é `DATABASE_URL` ou `JWT_SECRET` faltando. Veja os logs do serviço.

**Erro de SSL no banco.** O padrão já é SSL ligado, que é o que o Railway usa. Só defina `DATABASE_SSL=false` se estiver rodando num Postgres local sem SSL.

**A folha não destrava.** `FOLHA_SENHA` precisa estar definida **antes** de rodar `npm run seed` — é o seed que grava o hash. Se definiu depois, rode o seed de novo.

**Deploy sobe mas o health check falha.** O health check aponta para `/api/health`. Se ele não responde, o serviço não conseguiu conectar no banco — confira `DATABASE_URL`.
