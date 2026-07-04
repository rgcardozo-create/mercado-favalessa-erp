import { DollarSign, ShoppingCart, Users, Package } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import {
  CategoriaChart,
  FluxoChart,
  VendasSemanaChart,
} from '@/components/dashboard-charts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBRL, formatDataHora, produtos, vendas } from '@/lib/data'

export default function DashboardPage() {
  const baixoEstoque = produtos.filter((p) => p.estoque <= 12)

  return (
    <>
      <PageHeader
        titulo="Dashboard"
        descricao="Visão geral do desempenho do Mercado Favalessa"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          titulo="Faturamento (mês)"
          valor={formatBRL(241000)}
          variacao={{ valor: '+7,6%', positiva: true }}
          icon={DollarSign}
        />
        <StatCard
          titulo="Vendas (hoje)"
          valor="128"
          variacao={{ valor: '+12,4%', positiva: true }}
          icon={ShoppingCart}
        />
        <StatCard
          titulo="Clientes ativos"
          valor="1.204"
          variacao={{ valor: '+3,1%', positiva: true }}
          icon={Users}
        />
        <StatCard
          titulo="Ticket médio"
          valor={formatBRL(68.32)}
          variacao={{ valor: '-1,8%', positiva: false }}
          icon={Package}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <VendasSemanaChart />
        <CategoriaChart />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FluxoChart />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Vendas recentes</CardTitle>
            <CardDescription>Últimas transações registradas no PDV</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venda</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden sm:table-cell">Data</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendas.slice(0, 6).map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">#{v.id.replace('v', '')}</TableCell>
                    <TableCell>{v.cliente}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDataHora(v.data)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatBRL(v.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estoque baixo</CardTitle>
            <CardDescription>Produtos que precisam de reposição</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {baixoEstoque.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.nome}</p>
                  <p className="text-xs text-muted-foreground">{p.categoria}</p>
                </div>
                <Badge variant="destructive">{p.estoque} un</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
