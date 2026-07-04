import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatCard({
  titulo,
  valor,
  variacao,
  icon: Icon,
}: {
  titulo: string
  valor: string
  variacao?: { valor: string; positiva: boolean }
  icon: LucideIcon
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{titulo}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight">{valor}</p>
          {variacao && (
            <p
              className={cn(
                'mt-2 flex items-center gap-1 text-xs font-medium',
                variacao.positiva ? 'text-primary' : 'text-destructive',
              )}
            >
              {variacao.positiva ? (
                <ArrowUpRight className="size-3.5" />
              ) : (
                <ArrowDownRight className="size-3.5" />
              )}
              {variacao.valor}
              <span className="text-muted-foreground">vs. mês anterior</span>
            </p>
          )}
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  )
}
