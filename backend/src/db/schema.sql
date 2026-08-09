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
