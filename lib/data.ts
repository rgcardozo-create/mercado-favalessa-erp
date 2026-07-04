export type Produto = {
  id: string
  nome: string
  categoria: string
  preco: number
  estoque: number
  codigo: string
}

export type Cliente = {
  id: string
  nome: string
  email: string
  telefone: string
  cidade: string
  desde: string
  totalGasto: number
  compras: number
  pontos: number
  status: 'ativo' | 'inativo'
}

export type Funcionario = {
  id: string
  nome: string
  cargo: string
  setor: string
  email: string
  telefone: string
  admissao: string
  salario: number
  turno: 'Manhã' | 'Tarde' | 'Noite'
  status: 'ativo' | 'afastado' | 'ferias'
}

export type Venda = {
  id: string
  data: string
  cliente: string
  operador: string
  itens: number
  total: number
  pagamento: 'Dinheiro' | 'Cartão de Crédito' | 'Cartão de Débito' | 'Pix'
}

export type Transacao = {
  id: string
  data: string
  descricao: string
  categoria: string
  tipo: 'receita' | 'despesa'
  valor: number
  status: 'pago' | 'pendente'
}

export const produtos: Produto[] = [
  { id: 'p1', nome: 'Arroz Branco 5kg', categoria: 'Mercearia', preco: 27.9, estoque: 120, codigo: '7891000010101' },
  { id: 'p2', nome: 'Feijão Carioca 1kg', categoria: 'Mercearia', preco: 8.49, estoque: 84, codigo: '7891000010102' },
  { id: 'p3', nome: 'Óleo de Soja 900ml', categoria: 'Mercearia', preco: 6.99, estoque: 60, codigo: '7891000010103' },
  { id: 'p4', nome: 'Açúcar Refinado 1kg', categoria: 'Mercearia', preco: 4.59, estoque: 12, codigo: '7891000010104' },
  { id: 'p5', nome: 'Café Torrado 500g', categoria: 'Mercearia', preco: 15.9, estoque: 45, codigo: '7891000010105' },
  { id: 'p6', nome: 'Leite Integral 1L', categoria: 'Laticínios', preco: 5.29, estoque: 200, codigo: '7891000010106' },
  { id: 'p7', nome: 'Queijo Mussarela 500g', categoria: 'Laticínios', preco: 24.9, estoque: 30, codigo: '7891000010107' },
  { id: 'p8', nome: 'Iogurte Natural 170g', categoria: 'Laticínios', preco: 3.49, estoque: 8, codigo: '7891000010108' },
  { id: 'p9', nome: 'Banana Prata kg', categoria: 'Hortifruti', preco: 5.99, estoque: 40, codigo: '2000000000009' },
  { id: 'p10', nome: 'Tomate kg', categoria: 'Hortifruti', preco: 7.49, estoque: 25, codigo: '2000000000010' },
  { id: 'p11', nome: 'Refrigerante Cola 2L', categoria: 'Bebidas', preco: 9.99, estoque: 90, codigo: '7891000010111' },
  { id: 'p12', nome: 'Água Mineral 1,5L', categoria: 'Bebidas', preco: 2.99, estoque: 150, codigo: '7891000010112' },
  { id: 'p13', nome: 'Cerveja Lata 350ml', categoria: 'Bebidas', preco: 3.79, estoque: 240, codigo: '7891000010113' },
  { id: 'p14', nome: 'Detergente 500ml', categoria: 'Limpeza', preco: 2.49, estoque: 70, codigo: '7891000010114' },
  { id: 'p15', nome: 'Sabão em Pó 1kg', categoria: 'Limpeza', preco: 12.9, estoque: 55, codigo: '7891000010115' },
  { id: 'p16', nome: 'Pão Francês kg', categoria: 'Padaria', preco: 14.9, estoque: 18, codigo: '2000000000016' },
  { id: 'p17', nome: 'Bolo de Fubá un', categoria: 'Padaria', preco: 12.5, estoque: 6, codigo: '2000000000017' },
  { id: 'p18', nome: 'Sabonete 90g', categoria: 'Higiene', preco: 2.19, estoque: 110, codigo: '7891000010118' },
]

export const clientes: Cliente[] = [
  { id: 'c1', nome: 'Maria Oliveira', email: 'maria.oliveira@email.com', telefone: '(11) 98765-4321', cidade: 'São Paulo', desde: '2022-03-14', totalGasto: 8420.55, compras: 142, pontos: 842, status: 'ativo' },
  { id: 'c2', nome: 'João Santos', email: 'joao.santos@email.com', telefone: '(11) 91234-5678', cidade: 'Guarulhos', desde: '2021-11-02', totalGasto: 12980.1, compras: 210, pontos: 1298, status: 'ativo' },
  { id: 'c3', nome: 'Ana Costa', email: 'ana.costa@email.com', telefone: '(11) 99876-1122', cidade: 'São Paulo', desde: '2023-01-20', totalGasto: 3210.0, compras: 58, pontos: 321, status: 'ativo' },
  { id: 'c4', nome: 'Carlos Pereira', email: 'carlos.pereira@email.com', telefone: '(11) 97654-3210', cidade: 'Osasco', desde: '2020-07-09', totalGasto: 21500.9, compras: 340, pontos: 2150, status: 'ativo' },
  { id: 'c5', nome: 'Fernanda Lima', email: 'fernanda.lima@email.com', telefone: '(11) 96543-2109', cidade: 'São Paulo', desde: '2022-09-30', totalGasto: 1540.2, compras: 27, pontos: 154, status: 'inativo' },
  { id: 'c6', nome: 'Roberto Alves', email: 'roberto.alves@email.com', telefone: '(11) 95432-1098', cidade: 'Diadema', desde: '2023-05-11', totalGasto: 6720.75, compras: 98, pontos: 672, status: 'ativo' },
  { id: 'c7', nome: 'Juliana Rocha', email: 'juliana.rocha@email.com', telefone: '(11) 94321-0987', cidade: 'São Paulo', desde: '2021-02-18', totalGasto: 9830.4, compras: 165, pontos: 983, status: 'ativo' },
  { id: 'c8', nome: 'Pedro Martins', email: 'pedro.martins@email.com', telefone: '(11) 93210-9876', cidade: 'Santo André', desde: '2023-08-04', totalGasto: 780.0, compras: 14, pontos: 78, status: 'inativo' },
]

export const funcionarios: Funcionario[] = [
  { id: 'f1', nome: 'Beatriz Souza', cargo: 'Gerente Geral', setor: 'Administração', email: 'beatriz.souza@favalessa.com', telefone: '(11) 98111-2233', admissao: '2019-04-01', salario: 7800, turno: 'Manhã', status: 'ativo' },
  { id: 'f2', nome: 'Ricardo Gomes', cargo: 'Operador de Caixa', setor: 'PDV', email: 'ricardo.gomes@favalessa.com', telefone: '(11) 98222-3344', admissao: '2021-06-15', salario: 2400, turno: 'Manhã', status: 'ativo' },
  { id: 'f3', nome: 'Camila Dias', cargo: 'Operadora de Caixa', setor: 'PDV', email: 'camila.dias@favalessa.com', telefone: '(11) 98333-4455', admissao: '2022-01-10', salario: 2400, turno: 'Tarde', status: 'ativo' },
  { id: 'f4', nome: 'Marcos Ferreira', cargo: 'Repositor', setor: 'Estoque', email: 'marcos.ferreira@favalessa.com', telefone: '(11) 98444-5566', admissao: '2020-09-23', salario: 2100, turno: 'Noite', status: 'ferias' },
  { id: 'f5', nome: 'Patrícia Nunes', cargo: 'Açougueira', setor: 'Açougue', email: 'patricia.nunes@favalessa.com', telefone: '(11) 98555-6677', admissao: '2018-11-05', salario: 3200, turno: 'Manhã', status: 'ativo' },
  { id: 'f6', nome: 'Anderson Silva', cargo: 'Padeiro', setor: 'Padaria', email: 'anderson.silva@favalessa.com', telefone: '(11) 98666-7788', admissao: '2017-03-19', salario: 3400, turno: 'Manhã', status: 'ativo' },
  { id: 'f7', nome: 'Tatiane Ribeiro', cargo: 'Auxiliar Financeiro', setor: 'Financeiro', email: 'tatiane.ribeiro@favalessa.com', telefone: '(11) 98777-8899', admissao: '2022-07-28', salario: 2900, turno: 'Tarde', status: 'afastado' },
  { id: 'f8', nome: 'Diego Carvalho', cargo: 'Repositor', setor: 'Estoque', email: 'diego.carvalho@favalessa.com', telefone: '(11) 98888-9900', admissao: '2023-02-14', salario: 2100, turno: 'Tarde', status: 'ativo' },
]

export const vendas: Venda[] = [
  { id: 'v1024', data: '2026-07-03T09:14:00', cliente: 'Maria Oliveira', operador: 'Ricardo Gomes', itens: 12, total: 187.4, pagamento: 'Pix' },
  { id: 'v1023', data: '2026-07-03T09:02:00', cliente: 'Consumidor Final', operador: 'Camila Dias', itens: 3, total: 42.9, pagamento: 'Cartão de Débito' },
  { id: 'v1022', data: '2026-07-03T08:51:00', cliente: 'João Santos', operador: 'Ricardo Gomes', itens: 24, total: 356.75, pagamento: 'Cartão de Crédito' },
  { id: 'v1021', data: '2026-07-02T19:33:00', cliente: 'Consumidor Final', operador: 'Camila Dias', itens: 6, total: 78.2, pagamento: 'Dinheiro' },
  { id: 'v1020', data: '2026-07-02T18:12:00', cliente: 'Carlos Pereira', operador: 'Ricardo Gomes', itens: 18, total: 264.0, pagamento: 'Pix' },
  { id: 'v1019', data: '2026-07-02T17:40:00', cliente: 'Ana Costa', operador: 'Camila Dias', itens: 9, total: 121.35, pagamento: 'Cartão de Débito' },
  { id: 'v1018', data: '2026-07-02T16:05:00', cliente: 'Consumidor Final', operador: 'Ricardo Gomes', itens: 2, total: 19.8, pagamento: 'Dinheiro' },
  { id: 'v1017', data: '2026-07-01T15:22:00', cliente: 'Juliana Rocha', operador: 'Camila Dias', itens: 15, total: 203.6, pagamento: 'Cartão de Crédito' },
]

export const transacoes: Transacao[] = [
  { id: 't1', data: '2026-07-03', descricao: 'Vendas do dia (PDV)', categoria: 'Vendas', tipo: 'receita', valor: 8740.55, status: 'pago' },
  { id: 't2', data: '2026-07-02', descricao: 'Vendas do dia (PDV)', categoria: 'Vendas', tipo: 'receita', valor: 9210.3, status: 'pago' },
  { id: 't3', data: '2026-07-02', descricao: 'Fornecedor - Laticínios BR', categoria: 'Compra de Mercadoria', tipo: 'despesa', valor: 3200.0, status: 'pago' },
  { id: 't4', data: '2026-07-01', descricao: 'Energia elétrica', categoria: 'Contas Fixas', tipo: 'despesa', valor: 2450.9, status: 'pago' },
  { id: 't5', data: '2026-07-05', descricao: 'Fornecedor - Hortifruti Vale', categoria: 'Compra de Mercadoria', tipo: 'despesa', valor: 1870.4, status: 'pendente' },
  { id: 't6', data: '2026-07-05', descricao: 'Folha de pagamento', categoria: 'Salários', tipo: 'despesa', valor: 26300.0, status: 'pendente' },
  { id: 't7', data: '2026-07-04', descricao: 'Aluguel do imóvel', categoria: 'Contas Fixas', tipo: 'despesa', valor: 8500.0, status: 'pendente' },
  { id: 't8', data: '2026-07-01', descricao: 'Vendas do dia (PDV)', categoria: 'Vendas', tipo: 'receita', valor: 7980.2, status: 'pago' },
]

export const vendasSemana = [
  { dia: 'Seg', vendas: 6820, meta: 7000 },
  { dia: 'Ter', vendas: 7450, meta: 7000 },
  { dia: 'Qua', vendas: 6980, meta: 7000 },
  { dia: 'Qui', vendas: 8210, meta: 7000 },
  { dia: 'Sex', vendas: 9840, meta: 7000 },
  { dia: 'Sáb', vendas: 12480, meta: 7000 },
  { dia: 'Dom', vendas: 5320, meta: 7000 },
]

export const vendasPorCategoria = [
  { categoria: 'Mercearia', valor: 32400 },
  { categoria: 'Hortifruti', valor: 18600 },
  { categoria: 'Bebidas', valor: 15200 },
  { categoria: 'Laticínios', valor: 12800 },
  { categoria: 'Limpeza', valor: 8400 },
  { categoria: 'Padaria', valor: 7100 },
]

export const fluxoMensal = [
  { mes: 'Jan', receita: 198000, despesa: 152000 },
  { mes: 'Fev', receita: 182000, despesa: 148000 },
  { mes: 'Mar', receita: 210000, despesa: 161000 },
  { mes: 'Abr', receita: 205000, despesa: 158000 },
  { mes: 'Mai', receita: 224000, despesa: 168000 },
  { mes: 'Jun', receita: 241000, despesa: 174000 },
]

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
