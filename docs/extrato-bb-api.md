# Extrato do Banco do Brasil pela API

Em vez de baixar o extrato e enviar o arquivo, o sistema busca os lançamentos
direto no Banco do Brasil, pela **API Extratos v2**, e passa pelo mesmo
importador do arquivo: as mesmas regras, a mesma proteção contra lançar em
dobro, as mesmas contas criadas como pagas.

## O que acontece todo dia

Com a busca automática ligada, no horário marcado (7h por padrão, horário de
Brasília) o servidor:

1. Busca os lançamentos dos últimos dias (5 por padrão), até ontem. Olhar mais
   de um dia cobre fim de semana e lançamento que o banco contabiliza atrasado;
   repetir não duplica, porque cada lançamento tem identidade própria.
2. Separa as **saídas**. Recebimentos, saldos, limites, lançamentos futuros e
   em processamento ficam de fora.
3. Aplica só o que já foi **ensinado**: saída com regra "lançar" vira conta já
   paga; com "ignorar" (transferência entre contas suas, por exemplo), fica de
   lado. Saída **sem regra não é lançada**: espera alguém dizer o que é.
4. Registra o resultado. A tela de Conciliação, em "Banco (conta corrente)",
   mostra a última busca: quantas lançou, quantas esperam regra, e o erro, se
   houve.

Para classificar o que ficou sem regra: Conciliação → Importar arquivo →
De onde veio: **Banco (conta corrente)** → De qual conta: **Banco do Brasil** →
Como trazer: **Buscar no banco** → escolha o período → Conferir antes de
importar. A partir daí é igual ao arquivo: diga o que é cada tipo e grave. O
que você ensinar passa a valer na busca automática do dia seguinte.

O botão **Buscar agora** faz a mesma busca da madrugada na hora — serve para
conferir a configuração sem esperar o dia seguinte.

## Configurar

### 1. No Portal Developers BB

- A API Extratos é só para **pessoa jurídica** com conta corrente ativa no BB.
- Na sua aplicação, com a API Extratos adicionada, em **Credenciais**, ficam:
  - `client_id` e `client_secret`;
  - `developer_application_key` (a "chave da aplicação").
- A API exige **certificado digital do cliente (mTLS)** nos dois ambientes — o
  próprio endereço dela é `extratos.mtls.api...`. Cadastre o certificado da
  empresa na aplicação, como o portal pedir. Sem ele o banco recusa a conexão
  antes de olhar as credenciais.
- Comece pelo **ambiente de testes** (homologação). Quando funcionar, peça a
  produção no portal e troque as credenciais.

### 2. Converter o certificado

Variável de ambiente não guarda arquivo, então o certificado vai em base64.
Num computador com o arquivo `.pfx` da empresa:

```bash
base64 -w0 certificado.pfx > certificado.pfx.b64
```

No Mac, `base64 -i certificado.pfx -o certificado.pfx.b64`. O conteúdo do
`.b64` é o valor de `BB_CERT_PFX_BASE64`. Se o certificado vier em `.pem`
(certificado e chave separados), use `BB_CERT_PEM_BASE64` e `BB_KEY_PEM_BASE64`
no lugar.

### 3. Variáveis no Railway

No serviço do sistema, em **Variables**:

| Variável | O que é |
|---|---|
| `BB_EXTRATOS_AMBIENTE` | `teste` ou `producao` |
| `BB_CLIENT_ID` | client_id da aplicação |
| `BB_CLIENT_SECRET` | client_secret da aplicação |
| `BB_APP_KEY` | developer_application_key |
| `BB_AGENCIA` | agência, sem dígito |
| `BB_CONTA` | conta, sem dígito |
| `BB_CERT_PFX_BASE64` | o certificado `.pfx` em base64 |
| `BB_CERT_SENHA` | a senha do `.pfx` |
| `BB_BANCO_NOME` | o nome da conta no cadastro de Bancos do sistema (padrão: `Banco do Brasil`) |
| `BB_EXTRATOS_AUTOMATICO` | `true` para buscar sozinho todo dia |
| `BB_EXTRATOS_HORA` | horário da busca, padrão `07:00` |
| `BB_EXTRATOS_DIAS` | quantos dias para trás olhar, padrão `5` |

Essas credenciais dão acesso à movimentação da conta: ficam **só** nas
variáveis do Railway. Nunca no repositório, nunca em chat ou e-mail.

A conta precisa existir em **Cadastros → Bancos** com o nome de `BB_BANCO_NOME`.
É ela que guarda as regras — as que já foram ensinadas importando a planilha do
BB passam a valer para a API também, desde que a descrição bata (veja abaixo).

### 4. Conferir

Depois de salvar as variáveis (o Railway reinicia o serviço), abra a
Conciliação, escolha Banco (conta corrente) e Banco do Brasil. A faixa
"Banco do Brasil pela API" deve aparecer; se faltar algo, ela diz o quê.
Clique em **Buscar agora**.

## Cuidados

- **Regras da planilha × API.** A chave de cada regra sai da descrição do
  lançamento. A API manda a natureza (`textoDescricaoSubHistorico`, como
  "Pix - Enviado") e o complemento (`textoInformacaoComplementar`) — o mesmo que
  as colunas Lançamento e Detalhes da planilha. Se o banco escrever diferente
  num caso ou noutro, aquele tipo aparece "sem regra" uma vez e basta ensinar
  de novo.
- **Arquivo agrupado.** A API traz os lançamentos um a um. Um período já
  importado com o extrato **agrupado** é recusado pela busca (os Pix agrupados
  não têm número de documento e entrariam em dobro). A tela mostra o aviso.
- **Arquivo × API no mesmo período.** A identidade de cada lançamento usa data,
  valor e número do documento. Se o número da API for o mesmo da coluna
  Documento do arquivo, importar pelos dois caminhos não duplica. Isso ainda
  precisa ser confirmado com o extrato real: na primeira busca de um período já
  importado por arquivo, confira na prévia se as saídas aparecem como
  "já lançado".
- **Recebimentos** ainda não entram, como no arquivo.

## Para testar sem o banco

`BB_EXTRATOS_URL_TOKEN` e `BB_EXTRATOS_URL_API` trocam os endereços do BB por
um servidor de teste. Em uso normal ficam **vazias**.
