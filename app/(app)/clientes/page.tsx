'use client'

import { useMemo, useState } from 'react'
import { Search, Users, UserCheck, Star, Mail, Phone } from 'lucide-react'
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
import { clientes, formatBRL, formatData } from '@/lib/data'

function iniciais(nome: string) {
  return nome.split(' ').map((n) => n[0]).slice(0, 2).join('')
}

export default function ClientesPage() {
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return clientes
    return clientes.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.cidade.toLowerCase().includes(q),
    )
  }, [busca])

  const ativos = clientes.filter((c) => c.status === 'ativo').length
  const totalGasto = clientes.reduce((s, c) => s + c.totalGasto, 0)
  const pontos = clientes.reduce((s, c) => s + c.pontos, 0)

  return (
    <>
      <PageHeader
        titulo="Clientes"
        descricao="Cadastro, histórico de compras e programa de fidelidade"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard titulo="Total de clientes" valor={String(clientes.length)} icon={Users} />
        <StatCard titulo="Clientes ativos" valor={String(ativos)} icon={UserCheck} />
        <StatCard titulo="Receita gerada" valor={formatBRL(totalGasto)} icon={Star} />
        <StatCard
          titulo="Pontos fidelidade"
          valor={pontos.toLocaleString('pt-BR')}
          icon={Star}
        />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Lista de clientes</CardTitle>
            <div className="relative mt-2 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, e-mail ou cidade..."
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Contato</TableHead>
                  <TableHead className="hidden sm:table-cell">Desde</TableHead>
                  <TableHead className="text-center">Compras</TableHead>
                  <TableHead className="text-right">Total gasto</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                            {iniciais(c.nome)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium">{c.nome}</p>
                          <p className="text-xs text-muted-foreground">{c.cidade}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Mail className="size-3" />
                          {c.email}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Phone className="size-3" />
                          {c.telefone}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatData(c.desde)}
                    </TableCell>
                    <TableCell className="text-center">{c.compras}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatBRL(c.totalGasto)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={c.status === 'ativo' ? 'default' : 'secondary'}>
                        {c.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {filtrados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Nenhum cliente encontrado.
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
