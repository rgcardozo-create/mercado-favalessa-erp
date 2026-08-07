-- Mercado Favalessa ERP — schema Fase 1
-- Perfis de acesso, fornecedores e contas a pagar (com pagamentos como tabela filha)

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('master', 'gerente', 'loja');
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

CREATE TABLE IF NOT EXISTS fornecedores (
  id             SERIAL PRIMARY KEY,
  nome           VARCHAR(160) NOT NULL,
  cnpj_cpf       VARCHAR(20),
  telefone       VARCHAR(30),
  observacoes    TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Contas" = contas a pagar / boletos de fornecedores (Fase 1: Contas a pagar > Fornecedores)
CREATE TABLE IF NOT EXISTS contas (
  id             SERIAL PRIMARY KEY,
  fornecedor_id  INTEGER REFERENCES fornecedores(id),
  descricao      VARCHAR(200) NOT NULL,
  valor          NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
  vencimento     DATE NOT NULL,
  criado_por     INTEGER REFERENCES usuarios(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pagamentos/baixas parciais de uma conta — nunca um simples pago:true/false
-- (equivalente ao array pagamentos[]/baixas[] do sistema atual, agora como tabela filha)
CREATE TABLE IF NOT EXISTS contas_pagamentos (
  id               SERIAL PRIMARY KEY,
  conta_id         INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  valor            NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  data_pagamento   DATE NOT NULL,
  forma_pagamento  VARCHAR(40),
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

CREATE INDEX IF NOT EXISTS idx_contas_vencimento ON contas(vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_fornecedor ON contas(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagamentos_conta ON contas_pagamentos(conta_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id);
