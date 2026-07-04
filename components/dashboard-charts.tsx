'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { fluxoMensal, vendasPorCategoria, vendasSemana } from '@/lib/data'

const vendasConfig = {
  vendas: { label: 'Vendas', color: 'var(--chart-1)' },
} satisfies ChartConfig

const fluxoConfig = {
  receita: { label: 'Receita', color: 'var(--chart-1)' },
  despesa: { label: 'Despesa', color: 'var(--chart-4)' },
} satisfies ChartConfig

const categoriaConfig = {
  valor: { label: 'Faturamento', color: 'var(--chart-2)' },
} satisfies ChartConfig

const compact = (v: number) =>
  'R$ ' + Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v)

export function VendasSemanaChart() {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Vendas da semana</CardTitle>
        <CardDescription>Faturamento diário dos últimos 7 dias</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={vendasConfig} className="h-[280px] w-full">
          <BarChart data={vendasSemana} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="dia" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={compact}
            />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(v) => compact(Number(v))} />}
            />
            <Bar dataKey="vendas" fill="var(--color-vendas)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export function CategoriaChart() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendas por categoria</CardTitle>
        <CardDescription>Faturamento do mês por setor</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={categoriaConfig} className="h-[280px] w-full">
          <BarChart
            data={vendasPorCategoria}
            layout="vertical"
            margin={{ left: 8, right: 16 }}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" hide />
            <YAxis
              dataKey="categoria"
              type="category"
              tickLine={false}
              axisLine={false}
              width={80}
            />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(v) => compact(Number(v))} />}
            />
            <Bar dataKey="valor" fill="var(--color-valor)" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export function FluxoChart() {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Fluxo de caixa</CardTitle>
        <CardDescription>Receitas e despesas nos últimos 6 meses</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={fluxoConfig} className="h-[280px] w-full">
          <AreaChart data={fluxoMensal} margin={{ left: 4, right: 4, top: 8 }}>
            <defs>
              <linearGradient id="fillReceita" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-receita)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-receita)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="fillDespesa" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-despesa)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-despesa)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={compact}
            />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(v) => compact(Number(v))} />}
            />
            <Area
              dataKey="receita"
              type="monotone"
              stroke="var(--color-receita)"
              fill="url(#fillReceita)"
              strokeWidth={2}
            />
            <Area
              dataKey="despesa"
              type="monotone"
              stroke="var(--color-despesa)"
              fill="url(#fillDespesa)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
