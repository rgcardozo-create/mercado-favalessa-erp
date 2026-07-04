'use client'

import { useMemo, useState } from 'react'
import { Search, Users, Sun, Moon, Sunset } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { funcionarios, formatBRL, formatData } from '@/lib/data'

function iniciais(nome: string) {
  return nome.split(' ').map((n) => n[0]).slice(0, 2).join('')
}

const statusMap = {
  ativo: { label: 'Ativo', variant: 'default' as const },
  ferias: { label: 'Férias', variant: 'secondary' as const },
  afastado: { label: 'Afastado', variant: 'outline' as const },
}

const turnoIcon = {
  Manhã: Sun,
  Tarde: Sunset,
  Noite: Moon,
}

export default function FuncionariosPage() {
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return funcionarios
    return funcionarios.filter(
      (f) =>
        f.nome.toLowerCase().includes(q) ||
        f.cargo.toLowerCase().includes(q) ||
        f.setor.toLowerCase().includes(q),
    )
  }, [busca])

  const ativos = funcionarios.filter((f) => f.status === 'ativo').length
  const folha = funcionarios.reduce((s, f) => s + f.salario, 0)
  const setores = new Set(funcionarios.map((f) => f.setor)).size

  return (
    <>
      <PageHeader
        titulo="Funcionários"
        descricao="Equipe do mercado, cargos, turnos e folha de pagamento"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard titulo="Total de funcionários" valor={String(funcionarios.length)} icon={Users} />
        <StatCard titulo="Ativos" valor={String(ativos)} icon={Users} />
        <StatCard titulo="Setores" valor={String(setores)} icon={Users} />
        <StatCard titulo="Folha mensal" valor={formatBRL(folha)} icon={Users} />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Equipe</CardTitle>
            <div className="relative mt-2 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, cargo ou setor..."
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead className="hidden sm:table-cell">Setor</TableHead>
                  <TableHead>Turno</TableHead>
                  <TableHead className="hidden md:table-cell">Admissão</TableHead>
                  <TableHead className="text-right">Salário</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((f) => {
                  const TurnoIcon = turnoIcon[f.turno]
                  const st = statusMap[f.status]
                  return (
                    <TableRow key={f.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9">
                            <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                              {iniciais(f.nome)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium">{f.nome}</p>
                            <p className="text-xs text-muted-foreground">{f.cargo}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="secondary">{f.setor}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <TurnoIcon className="size-3.5 text-muted-foreground" />
                          {f.turno}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatData(f.admissao)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBRL(f.salario)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filtrados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Nenhum funcionário encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
