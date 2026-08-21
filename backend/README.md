# Backend — Mercado Favalessa ERP

Backend Node.js/Express + PostgreSQL do sistema multiusuário, conforme `SPEC.md` na raiz do repositório.

## O que já está implementado

- Autenticação com JWT (login por usuário/senha, sem mais senha única).
- 3 perfis: `master`, `gerente`, `loja`.
- **Parcelamento no cadastro**: informe quantas parcelas e de quanto em quanto tempo (mensal no mesmo dia, ou 7/15/20/21/30 dias) e o sistema cria todas de uma vez, cada uma com seu vencimento e sua numeração. Serve tanto para o boleto em 3x quanto para o financiamento em 48x das despesas fixas. Tudo numa transação: ou nascem todas, ou nenhuma.
- **Forma de pagamento prevista** por lançamento (`forma_prevista`): separa em listas quem se paga por PIX de quem manda boleto, e já vem escolhida na hora de dar baixa. É previsão — o que foi pago de fato continua em `contas_pagamentos`.
- **Aviso de lançamento repetido**: cadastrar (ou editar para) fornecedor, descrição, vencimento e valor iguais aos de outra conta responde `409` com a conta que já existe. Repetir só o fornecedor e a descrição é normal e passa direto; parcelas diferem no vencimento e dois boletos do mesmo dia diferem no valor. Para casos legítimos, o mesmo POST/PUT com `permitir_duplicado: true` grava assim mesmo.
- **Contas a pagar nas quatro telas** — Fornecedores, Despesas fixas, Impostos e Outras despesas — com pagamentos parciais (baixas) em tabela filha.
- Painel do dia (despesas fixas, impostos e outras despesas vencidos ou de hoje, mais os boletos de fornecedor do recorte escolhido), só para Master e Gerente.
- **Conciliação** das maquininhas (Cielo, Stone, Itaú, Tickets) e do dinheiro por PDV.
- **Acumulado** (conferência de caixa), só para Master e Gerente. A tela mostra o que os extratos já importados trazem para o dia e preenche o formulário com isso — mas quem confere e salva é a pessoa, porque um dia com só um adquirente importado daria um fechamento pela metade com cara de fechado. Resumo de vendas: hoje contra o mesmo dia da semana passada, últimos 7 dias contra os 7 anteriores, mês até hoje contra o mesmo período do mês passado, série de 30 dias e a lista dos dias sem lançamento.
- **Venda a prazo** com saldo devedor por cliente e extrato individual.
- **Cadastros** de clientes, funcionários, bancos e formas de pagamento.
- **Correção de lançamento e de baixa**: dá para editar a conta (descrição, valor, vencimento, fornecedor) e também corrigir ou estornar um pagamento já registrado — data trocada e valor digitado errado se resolvem sem apagar a conta inteira.
- **Baixa com forma de pagamento e banco**: ao dar baixa, o valor vem preenchido com o saldo mas é editável (pagamento parcial), a forma sai do cadastro de formas de pagamento e o banco do cadastro de bancos. O banco é opcional — dinheiro do caixa não sai de banco nenhum.
- **Folha** com recorte por mês (mês atual como padrão), lançamento pela tela e coluna de adiantamento. Registrar um vale deixa ele em aberto; lançar a folha do funcionário desconta o vale e dá baixa nele na mesma transação — o mesmo dinheiro não fica cobrado duas vezes.
- **Compras do funcionário ligadas ao caderno de fiado** pelo código: cliente e funcionário com o mesmo código são a mesma pessoa. Ao lançar a folha, o campo Compras vem com o que ele deve no caderno, e salvar registra o pagamento lá — a dívida não fica de pé depois de já ter saído do salário.
- **Relatórios** por período.
- **Folha de pagamento e Extras**, só para Master e ainda atrás de uma senha adicional.
- **Administração** (Master): trilha de auditoria e exportação de backup em JSON.
- Importação do backup JSON da v3.
- Auditoria de quem cadastrou/editou/pagou o quê e quando.

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
| Venda a prazo (ver e lançar) | ✅ | ✅ | ✅ |
| Cadastros (ver, criar, editar) | ✅ | ✅ | ✅ |
| Cadastros (excluir) | ✅ | ✅ | ❌ |
| Relatórios | ✅ | ✅ | ❌ |
| Folha e Extras | ✅ (+ senha) | ❌ | ❌ |
| Auditoria e exportar backup | ✅ | ❌ | ❌ |

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

**Pela tela** (recomendado): Administração → *Importar backup do sistema antigo*. Escolha o arquivo, clique em **Simular** para conferir os números sem gravar nada e depois em **Importar de verdade**. É o caminho que funciona em nuvem, onde o arquivo está no computador do usuário e não no disco do servidor.

**Por linha de comando** (para uso local):

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
- A conciliação é inserida em lotes; `hora` fica como texto porque os extratos usam formatos diferentes ("08:21", "9:45:46").
- **Transações de cartão são identificadas pelo conteúdo** (adquirente + data + hora + valor + bandeira + forma), não pelo id do sistema antigo. Ao recarregar um extrato, a v3 gera ids novos para as mesmas vendas — usar o id faria o faturamento do período aparecer em dobro numa segunda importação. Vendas genuinamente idênticas (mesmo minuto, mesmo valor) são preservadas via sufixo `#2`, `#3`. O mesmo vale para o dinheiro por PDV.

> **Dado inconsistente conhecido:** no extrato do Itaú o valor bruto (R$ 86,58) não bate com o líquido (R$ 2.473,56) — o parser do sistema atual trouxe esses campos incompletos. A importação preserva os valores como estão, sem "corrigir" histórico. Vale revisar quando a importação de extratos for reescrita.

> Os arquivos de backup **não devem ser commitados**: além dos dados financeiros, o bloco `meta` contém as senhas da Folha e das Contas particulares. O `.gitignore` já bloqueia os nomes usuais.

## Endpoints

- `POST /api/auth/login` — `{ email, senha }` → `{ token, usuario }`
- `GET /api/auth/me` — dados do usuário autenticado
- `GET /api/fornecedores` / `POST /api/fornecedores`
- `GET /api/contas` (aceita `?status=vencidas|a_vencer|quitado|pendente`, `?tipo=fornecedor|fixa|imposto|despesa`, `?busca=` e `?mes=atual|anterior`)
  - `vencidas` (o padrão da tela) traz o que já venceu mais o que vence hoje; `a_vencer`, só o que vence depois de hoje; `pendente` continua valendo como os dois juntos.
  - `busca` procura em fornecedor, descrição e categoria de uma vez, ignorando acento e maiúscula. `%` e `_` digitados valem como texto.
  - `mes` recorta pelo mês: conta quitada entra pela data do pagamento, pendente pelo vencimento. Sem o parâmetro, todo o período.
  - cada conta traz `ultimo_pagamento` (data da última baixa) além de `total_pago`, `saldo` e `quitado`.
- `GET /api/contas/:id` — inclui lista de pagamentos
- `POST /api/contas` — cadastra um lançamento (`tipo` padrão `fornecedor`; `categoria` usada em Outras despesas; `forma_prevista` opcional)
  - `parcelas` (1 a 60, padrão 1) e `intervalo` (`mensal` padrão, ou `7`/`15`/`20`/`21`/`30` dias) geram o carnê inteiro; o `valor` informado é o de **cada** parcela
  - a resposta traz `parcelas_criadas` e a lista completa em `contas`
- `PUT /api/contas/:id` / `DELETE /api/contas/:id`
- `POST /api/contas/:id/pagamentos` — registra uma baixa (parcial ou total); aceita `forma_pagamento` (nome) e `banco_id` (opcional)
- `PUT /api/contas/:id/pagamentos/:pagamentoId` — corrige uma baixa (valor, data, forma, banco)
- `DELETE /api/contas/:id/pagamentos/:pagamentoId` — estorna a baixa; a conta volta a ficar pendente pelo valor
- `GET /api/painel-do-dia` — fixas, impostos e boletos com totais (Master/Gerente).
  - `?filtro=` recorta os boletos de fornecedor: `hoje` (padrão), `ontem`, `atrasados`, `semana`.
  - `?filtroFixas=`, `?filtroImpostos=` e `?filtroDespesas=` recortam os três blocos fixos: `ate_hoje` (padrão — vencidas mais as de hoje), `atrasados`, `hoje`, `semana`, `todos`.
  - Valor desconhecido cai no padrão; nada do parâmetro entra no SQL.
- `GET /api/conciliacao` — resumo por adquirente e dinheiro por PDV (aceita `?de=&ate=`)
- `GET /api/conciliacao/transacoes` — listagem paginada (`?adquirente=&de=&ate=&pagina=&limite=`)
- `POST /api/conciliacao/extratos/analisar` — lê a planilha e devolve o que entendeu, sem gravar (Master/Gerente)
- `POST /api/conciliacao/extratos` — grava as transações do extrato (Master/Gerente)
- `GET /api/acumulados` (aceita `?de=&ate=`) / `POST /api/acumulados` / `DELETE /api/acumulados/:id` — Master e Gerente
- `GET /api/acumulados/sugestao?data=AAAA-MM-DD` — o que a conciliação já tem para o dia (bruto por adquirente, dinheiro do PDV e até quando cada adquirente foi importado). Sugere o fechamento; não grava.
- `GET /api/acumulados/resumo` — comparativos (hoje × mesmo dia da semana passada, 7 dias × 7 anteriores, mês até hoje × mesmo período do mês passado), série de 30 dias e os dias sem lançamento das duas últimas semanas
- `GET /api/venda-prazo` — saldo devedor por cliente; `GET /api/venda-prazo/clientes/:id` — extrato
- `POST /api/venda-prazo/movimentos` — lança compra ou pagamento do cliente
- `GET|POST /api/cadastros/{clientes,funcionarios,bancos,formas-pagamento}` (+ `PUT`/`DELETE` por id)
  - nome repetido em formas de pagamento responde `409` (índice único ignorando caixa e espaços)
- `GET /api/relatorios?de=&ate=` — consolidado do período (Master e Gerente)
- `GET /api/folha/compras-prazo/:id` — quanto o funcionário deve no caderno de fiado (vínculo pelo código)
- `GET /api/folha/pendencias` — quantas folhas estão em aberto e desde quando. **Não exige a senha adicional** (só o perfil Master) porque é o aviso do painel: nome e valor continuam atrás da senha.
- `POST /api/folha/desbloquear` — troca a senha da folha por um token curto
- `GET|POST /api/folha`, `POST /api/folha/:id/pagamentos`, `GET|POST /api/folha/extras` — Master, com folha destravada
- `GET /api/admin/auditoria` — trilha paginada (`?entidade=&de=&ate=&pagina=&limite=`) — Master
- `GET /api/admin/backup` — exporta tudo em JSON — Master. **A folha só entra no arquivo se estiver destravada**, para um backup baixado por engano não expor salários.
- `POST /api/admin/importar` — importa um backup enviado pela tela (aceita `?dry_run=true` para simular) — Master. Esta rota tem limite de corpo próprio (`LIMITE_IMPORTACAO`, padrão 25 MB), porque o backup passa dos 2 MB e o limite global é 1 MB.

### A senha adicional da Folha

Além de ser Master, é preciso informar a senha da folha (`FOLHA_SENHA`). O desbloqueio devolve um **token separado do token de sessão**, enviado no header `X-Folha-Token` e válido por 30 minutos (`FOLHA_TOKEN_EXPIRES_IN`). O frontend guarda esse token só em memória, então fechar a aba tranca a folha de novo.

Esse token é amarrado ao usuário que o gerou: o token da folha do Master não destrava nada para outro usuário.

Nos **relatórios** a folha se comporta como o `SPEC.md` manda: com a folha trancada, ela aparece como uma linha genérica "Folha de pagamento" — o valor entra normalmente nos totais, mas nenhum nome de funcionário é exposto.

O "hoje" do painel é calculado no fuso `America/Sao_Paulo` dentro do banco, não no fuso do servidor — o Railway roda em UTC, e depois das 21h de Brasília a data viraria antes da hora.

Todas as rotas exigem `Authorization: Bearer <token>`, exceto `/api/auth/login` e `/api/health`.

## Deploy

Passo a passo completo em [`DEPLOY.md`](../DEPLOY.md) na raiz do repositório.

**O banco é preparado no boot** (`src/db/bootstrap.js`): o servidor aplica o schema e configura os acessos a partir das variáveis de ambiente antes de aceitar requisições. Em PaaS não há terminal para rodar migração à mão, e subir com o schema desatualizado só produziria erro na primeira tela aberta. Repetir é seguro — o schema é todo `IF NOT EXISTS` e os usuários entram com `ON CONFLICT DO UPDATE`.

Os comandos `npm run migrate` e `npm run seed` continuam existindo para uso local.

Em produção este backend **também serve o frontend** (`../frontend`), então um serviço só coloca o sistema inteiro no ar e o `/api` do frontend resolve no mesmo domínio. Por isso o CORS fica desligado quando `NODE_ENV=production`, a menos que `CORS_ORIGIN` seja definido — útil apenas se a interface for hospedada em outro domínio.

## Status por fase

- **Fase 1 — concluída.** Autenticação com os 3 perfis, Fornecedores/Contas a pagar, Painel do dia e importação do backup, testados com os dados reais.
- **Fase 2 — concluída.** Despesas fixas, Impostos, Outras despesas, Conciliação e Acumulado, todos importados do backup real. Fica pendente a **importação de novos extratos** (ver abaixo).
- **Fase 3 — concluída.** Venda a prazo, Cadastros, Relatórios e Folha/Extras (Master + senha), todos importados do backup real.
- **Fase 4 — concluída.** PWA instalável, tela de auditoria e exportação de backup.

> **Contas pessoais saiu do escopo** por decisão do usuário: será tratada fora deste sistema. A regra de nunca misturar valores pessoais com totais da empresa continua valendo — nada pessoal entra no banco.

### Importação de extratos de cartão

O sistema antigo lia a pasta `EXTRATOS\` do computador da loja, o que não funciona em nuvem. Aqui o arquivo é carregado **pela tela de Conciliação** (Master/Gerente), em dois passos: o sistema lê a planilha e mostra o que entendeu — quais colunas, quantas transações, para onde vão — e só grava depois da confirmação.

Como cada adquirente entrega um layout diferente, o cabeçalho é localizado por nome de coluna (`src/utils/lerPlanilha.js`), não por posição fixa. Isso tolera as linhas de título que os relatórios costumam trazer antes da tabela.

Duas regras derivadas dos dados reais do sistema antigo (`src/utils/extrato.js`):

- **Voucher vai para Tickets**, mesmo vindo do arquivo da Stone ou da Rede. Foi assim que o sistema atual sempre separou: no extrato da Stone, as linhas de voucher aparecem em Tickets, não em Stone.
- **Quando o extrato não traz o líquido**, ele é derivado do bruto menos a tarifa.

Se a planilha não for reconhecida, a tela mostra os nomes de coluna encontrados — é o que basta para adicionar o layout novo em `SINONIMOS`.

> O rótulo `itau` no banco corresponde ao extrato da **Rede** (é a conta que recebe). Mantido assim por compatibilidade com o histórico importado.

Falta antes de usar em produção: subir no Railway (banco + serviço), definir as senhas reais dos 3 usuários e rodar a importação do backup mais recente. Conforme o `SPEC.md`, o sistema HTML atual deve seguir rodando em paralelo até estar validado em uso real.
