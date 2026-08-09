-- Mercado Favalessa ERP — schema Fase 1
-- Perfis de acesso, fornecedores e contas a pagar (com pagamentos como tabela filha)

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('master', 'gerente', 'loja');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- As quatro telas de Contas a pagar (Fornecedores, Despesas fixas, Impostos e
-- Outras despesas) compartilham a mesma estrutura, então vivem na mesma tabela
-- separadas por `tipo` — saldo, baixas parciais e Painel do dia valem para todas.
--
-- `pessoais` e `extras` NÃO entram aqui de propósito: contas pessoais nunca podem
-- aparecer em nenhum total da empresa, e extras (adiantamentos/vales) já são
-- descontados na folha. Mantê-las fora desta tabela torna impossível vazarem
-- para os totais por descuido (SPEC.md, regras 1 e 3).
DO $$ BEGIN
  CREATE TYPE conta_tipo AS ENUM ('fornecedor', 'fixa', 'imposto', 'despesa');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  email          VARCHAR(160) NOT NULL UNIQUE,
  senha_hash     VARCHAR(200) NOT NULL,
  role           user_role NOT NULL,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- legado_id guarda o id do registro no sistema v3 (localStorage), tornando a
-- importação do backup JSON idempotente — rodar duas vezes não duplica nada.
CREATE TABLE IF NOT EXISTS fornecedores (
  id             SERIAL PRIMARY KEY,
  nome           VARCHAR(160) NOT NULL,
  cnpj_cpf       VARCHAR(20),
  telefone       VARCHAR(30),
  pix            VARCHAR(140),
  observacoes    TEXT,
  legado_id      VARCHAR(40) UNIQUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Contas" = contas a pagar / boletos de fornecedores (Fase 1: Contas a pagar > Fornecedores)
CREATE TABLE IF NOT EXISTS contas (
  id              SERIAL PRIMARY KEY,
  tipo            conta_tipo NOT NULL DEFAULT 'fornecedor',
  categoria       VARCHAR(60),
  fornecedor_id   INTEGER REFERENCES fornecedores(id),
  descricao       VARCHAR(200) NOT NULL,
  valor           NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
  vencimento      DATE NOT NULL,
  prioridade      SMALLINT,
  parcela         SMALLINT,
  total_parcelas  SMALLINT,
  observacoes     TEXT,
  legado_id       VARCHAR(40) UNIQUE,
  criado_por      INTEGER REFERENCES usuarios(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pagamentos/baixas parciais de uma conta — nunca um simples pago:true/false
-- (equivalente ao array pagamentos[]/baixas[] do sistema atual, agora como tabela filha)
CREATE TABLE IF NOT EXISTS contas_pagamentos (
  id               SERIAL PRIMARY KEY,
  conta_id         INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  valor            NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  data_pagamento   DATE NOT NULL,
  forma_pagamento  VARCHAR(40),
  origem           VARCHAR(60),
  observacoes      TEXT,
  legado_id        VARCHAR(40) UNIQUE,
  pago_por         INTEGER REFERENCES usuarios(id),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Cadastros ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id          SERIAL PRIMARY KEY,
  codigo      VARCHAR(20) UNIQUE,
  nome        VARCHAR(160) NOT NULL,
  telefone    VARCHAR(30),
  cpf_cnpj    VARCHAR(20),
  observacoes TEXT,
  legado_id   VARCHAR(40) UNIQUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funcionarios (
  id          SERIAL PRIMARY KEY,
  codigo      VARCHAR(20),
  nome        VARCHAR(160) NOT NULL,
  telefone    VARCHAR(30),
  cpf         VARCHAR(20),
  pix         VARCHAR(140),
  observacoes TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  legado_id   VARCHAR(40) UNIQUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bancos (
  id          SERIAL PRIMARY KEY,
  nome        VARCHAR(120) NOT NULL,
  padrao      BOOLEAN NOT NULL DEFAULT false,
  legado_id   VARCHAR(40) UNIQUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Venda a prazo ──────────────────────────────────────────────────────────────
-- Movimentos do caderno de fiado: compras do cliente e pagamentos que ele faz.
DO $$ BEGIN
  CREATE TYPE mov_prazo_tipo AS ENUM ('compra', 'pagamento');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mov_prazo (
  id          SERIAL PRIMARY KEY,
  cliente_id  INTEGER REFERENCES clientes(id),
  tipo        mov_prazo_tipo NOT NULL DEFAULT 'compra',
  valor       NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
  data        DATE NOT NULL,
  observacoes TEXT,
  legado_id   VARCHAR(40) UNIQUE,
  criado_por  INTEGER REFERENCES usuarios(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Conciliação ────────────────────────────────────────────────────────────────
-- Transações das maquininhas/adquirentes. Os quatro extratos (Cielo, Stone, Itaú
-- e Tickets/Rede Compras) têm exatamente os mesmos campos, então ficam na mesma
-- tabela separados por `adquirente`.
--
-- `hora` fica como texto de propósito: os extratos vêm em formatos diferentes
-- ("08:21", "9:45:46") e converter perderia informação do arquivo original.
DO $$ BEGIN
  CREATE TYPE adquirente_tipo AS ENUM ('cielo', 'stone', 'itau', 'tickets');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS conciliacao_transacoes (
  id             SERIAL PRIMARY KEY,
  adquirente     adquirente_tipo NOT NULL,
  data           DATE NOT NULL,
  hora           VARCHAR(12),
  forma          VARCHAR(60),
  bandeira       VARCHAR(60),
  valor_bruto    NUMERIC(12,2) NOT NULL DEFAULT 0,
  tarifa         NUMERIC(12,6) NOT NULL DEFAULT 0,
  valor_liquido  NUMERIC(12,6) NOT NULL DEFAULT 0,
  categoria      VARCHAR(30),
  status         VARCHAR(30),
  lote           VARCHAR(60),
  arquivo        VARCHAR(160),
  importado_em   TIMESTAMPTZ,
  legado_id      VARCHAR(40) UNIQUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dinheiro é conferido por PDV, não vem de extrato de adquirente.
CREATE TABLE IF NOT EXISTS conciliacao_dinheiro (
  id          SERIAL PRIMARY KEY,
  data        DATE NOT NULL,
  pdv         VARCHAR(10),
  valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
  legado_id   VARCHAR(40) UNIQUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Acumulado (conferência de caixa) ───────────────────────────────────────────
-- Visível apenas para Master e Gerente (SPEC.md, seção 3).
CREATE TABLE IF NOT EXISTS acumulados (
  id            SERIAL PRIMARY KEY,
  data          DATE NOT NULL UNIQUE,
  dinheiro      NUMERIC(12,2) NOT NULL DEFAULT 0,
  cartao        NUMERIC(12,2) NOT NULL DEFAULT 0,
  pix           NUMERIC(12,2) NOT NULL DEFAULT 0,
  tickets       NUMERIC(12,2) NOT NULL DEFAULT 0,
  pos_sistema   NUMERIC(12,2) NOT NULL DEFAULT 0,
  pos_maquina   NUMERIC(12,2) NOT NULL DEFAULT 0,
  outras        NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacoes   TEXT,
  legado_id     VARCHAR(40) UNIQUE,
  criado_por    INTEGER REFERENCES usuarios(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Folha de pagamento ─────────────────────────────────────────────────────────
-- Master apenas, e ainda por trás de uma senha adicional (SPEC.md, seção 3).
--
-- O líquido nunca é armazenado: sai de salario + bonificacao - compras -
-- adiantamento - outras - descontos. Guardar o total deixaria o número defasado
-- quando alguém corrigisse uma das parcelas.
CREATE TABLE IF NOT EXISTS folha (
  id            SERIAL PRIMARY KEY,
  funcionario_id INTEGER REFERENCES funcionarios(id),
  nome          VARCHAR(160) NOT NULL,
  tipo          VARCHAR(30),
  data_ref      DATE,
  salario       NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonificacao   NUMERIC(12,2) NOT NULL DEFAULT 0,
  compras       NUMERIC(12,2) NOT NULL DEFAULT 0,
  adiantamento  NUMERIC(12,2) NOT NULL DEFAULT 0,
  outras        NUMERIC(12,2) NOT NULL DEFAULT 0,
  descontos     NUMERIC(12,2) NOT NULL DEFAULT 0,
  dias_ferias   SMALLINT,
  observacoes   TEXT,
  legado_id     VARCHAR(40) UNIQUE,
  criado_por    INTEGER REFERENCES usuarios(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS folha_pagamentos (
  id              SERIAL PRIMARY KEY,
  folha_id        INTEGER NOT NULL REFERENCES folha(id) ON DELETE CASCADE,
  valor           NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  data_pagamento  DATE NOT NULL,
  forma_pagamento VARCHAR(40),
  observacoes     TEXT,
  legado_id       VARCHAR(40) UNIQUE,
  pago_por        INTEGER REFERENCES usuarios(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extras = adiantamentos/vales de funcionário. Ficam FORA de qualquer soma de
-- despesa da empresa: já são descontados na folha, e contar de novo duplicaria
-- (SPEC.md, regra 3). Por isso não vivem na tabela `contas`.
CREATE TABLE IF NOT EXISTS extras (
  id             SERIAL PRIMARY KEY,
  funcionario_id INTEGER REFERENCES funcionarios(id),
  nome           VARCHAR(160) NOT NULL,
  codigo         VARCHAR(20),
  tipo           VARCHAR(30),
  valor          NUMERIC(12,2) NOT NULL DEFAULT 0,
  data           DATE NOT NULL,
  observacoes    TEXT,
  legado_id      VARCHAR(40) UNIQUE,
  criado_por     INTEGER REFERENCES usuarios(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extras_baixas (
  id          SERIAL PRIMARY KEY,
  extra_id    INTEGER NOT NULL REFERENCES extras(id) ON DELETE CASCADE,
  valor       NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  data        DATE NOT NULL,
  observacoes TEXT,
  legado_id   VARCHAR(40) UNIQUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configurações chave/valor (ex.: hash da senha adicional da Folha).
CREATE TABLE IF NOT EXISTS configuracoes (
  chave      VARCHAR(60) PRIMARY KEY,
  valor      TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auditoria: quem cadastrou/editou/pagou o quê e quando (novo requisito multiusuário)
CREATE TABLE IF NOT EXISTS auditoria (
  id           SERIAL PRIMARY KEY,
  usuario_id   INTEGER REFERENCES usuarios(id),
  acao         VARCHAR(40) NOT NULL,   -- create | update | delete | pagamento
  entidade     VARCHAR(40) NOT NULL,   -- 'contas', 'fornecedores', etc.
  entidade_id  INTEGER NOT NULL,
  dados        JSONB,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Colunas acrescentadas depois da primeira versão do schema: os CREATE TABLE acima
-- não alteram tabelas que já existem, então repetimos como ALTER idempotente.
ALTER TABLE fornecedores
  ADD COLUMN IF NOT EXISTS pix VARCHAR(140),
  ADD COLUMN IF NOT EXISTS legado_id VARCHAR(40) UNIQUE;

ALTER TABLE contas
  ADD COLUMN IF NOT EXISTS tipo conta_tipo NOT NULL DEFAULT 'fornecedor',
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(60),
  ADD COLUMN IF NOT EXISTS prioridade SMALLINT,
  ADD COLUMN IF NOT EXISTS parcela SMALLINT,
  ADD COLUMN IF NOT EXISTS total_parcelas SMALLINT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT,
  ADD COLUMN IF NOT EXISTS legado_id VARCHAR(40) UNIQUE;

ALTER TABLE contas_pagamentos
  ADD COLUMN IF NOT EXISTS origem VARCHAR(60),
  ADD COLUMN IF NOT EXISTS observacoes TEXT,
  ADD COLUMN IF NOT EXISTS legado_id VARCHAR(40) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_contas_vencimento ON contas(vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_tipo ON contas(tipo);
CREATE INDEX IF NOT EXISTS idx_contas_fornecedor ON contas(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagamentos_conta ON contas_pagamentos(conta_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_concil_data ON conciliacao_transacoes(data);
CREATE INDEX IF NOT EXISTS idx_concil_adquirente_data ON conciliacao_transacoes(adquirente, data);
CREATE INDEX IF NOT EXISTS idx_concil_dinheiro_data ON conciliacao_dinheiro(data);
CREATE INDEX IF NOT EXISTS idx_acumulados_data ON acumulados(data);
CREATE INDEX IF NOT EXISTS idx_mov_prazo_cliente ON mov_prazo(cliente_id);
CREATE INDEX IF NOT EXISTS idx_mov_prazo_data ON mov_prazo(data);
CREATE INDEX IF NOT EXISTS idx_folha_pagamentos_folha ON folha_pagamentos(folha_id);
CREATE INDEX IF NOT EXISTS idx_extras_baixas_extra ON extras_baixas(extra_id);
