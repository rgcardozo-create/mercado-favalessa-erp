import { TrendingUp, TrendingDown, Scale, Clock } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { FluxoChart } from '@/components/dashboard-charts'
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
import { cn } from '@/lib/utils'
import { formatBRL, formatData, transacoes } from '@/lib/data'

export default function FinanceiroPage() {
  const receitas = transacoes
    .filter((t) => t.tipo === 'receita')
    .reduce((s, t) => s + t.valor, 0)
  const despesas = transacoes
    .filter((t) => t.tipo === 'despesa')
    .reduce((s, t) => s + t.valor, 0)
  const saldo = receitas - despesas
  const pendentes = transacoes
    .filter((t) => t.status === 'pendente')
    .reduce((s, t) => s + t.valor, 0)

  const ordenadas = [...transacoes].sort((a, b) => b.data.localeCompare(a.data))

  return (
    <>
      <PageHeader
        titulo="Financeiro"
        descricao="Controle de receitas, despesas e fluxo de caixa"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard titulo="Receitas" valor={formatBRL(receitas)} icon={TrendingUp} />
        <StatCard titulo="Despesas" valor={formatBRL(despesas)} icon={TrendingDown} />
        <StatCard titulo="Saldo" valor={formatBRL(saldo)} icon={Scale} />
        <StatCard titulo="A pagar (pendente)" valor={formatBRL(pendentes)} icon={Clock} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FluxoChart />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Movimentações</CardTitle>
            <CardDescription>
              Contas a pagar, a receber e lançamentos recentes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenadas.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatData(t.data)}
                    </TableCell>
                    <TableCell className="font-medium">{t.descricao}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="secondary">{t.categoria}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === 'pago' ? 'default' : 'outline'}>
                        {t.status === 'pago' ? 'Pago' : 'Pendente'}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold whitespace-nowrap',
                        t.tipo === 'receita' ? 'text-primary' : 'text-destructive',
                      )}
                    >
                      {t.tipo === 'receita' ? '+ ' : '- '}
                      {formatBRL(t.valor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
