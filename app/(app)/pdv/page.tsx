'use client'

import { useMemo, useState } from 'react'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CreditCard,
  Banknote,
  QrCode,
  Receipt,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  formatBRL,
  formatDataHora,
  produtos,
  vendas,
  type Produto,
} from '@/lib/data'

type ItemCarrinho = { produto: Produto; qtd: number }

const pagamentos = [
  { id: 'Dinheiro', label: 'Dinheiro', icon: Banknote },
  { id: 'Pix', label: 'Pix', icon: QrCode },
  { id: 'Cartão de Débito', label: 'Débito', icon: CreditCard },
  { id: 'Cartão de Crédito', label: 'Crédito', icon: CreditCard },
] as const

export default function PdvPage() {
  const [busca, setBusca] = useState('')
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [pagamento, setPagamento] = useState<string>('Dinheiro')

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return produtos
    return produtos.filter(
      (p) => p.nome.toLowerCase().includes(q) || p.codigo.includes(q),
    )
  }, [busca])

  const total = carrinho.reduce((s, i) => s + i.produto.preco * i.qtd, 0)
  const totalItens = carrinho.reduce((s, i) => s + i.qtd, 0)

  function adicionar(produto: Produto) {
    setCarrinho((prev) => {
      const existe = prev.find((i) => i.produto.id === produto.id)
      if (existe) {
        return prev.map((i) =>
          i.produto.id === produto.id ? { ...i, qtd: i.qtd + 1 } : i,
        )
      }
      return [...prev, { produto, qtd: 1 }]
    })
  }

  function alterarQtd(id: string, delta: number) {
    setCarrinho((prev) =>
      prev
        .map((i) =>
          i.produto.id === id ? { ...i, qtd: Math.max(0, i.qtd + delta) } : i,
        )
        .filter((i) => i.qtd > 0),
    )
  }

  function remover(id: string) {
    setCarrinho((prev) => prev.filter((i) => i.produto.id !== id))
  }

  function finalizar() {
    if (carrinho.length === 0) {
      toast.error('Adicione produtos ao carrinho.')
      return
    }
    toast.success('Venda finalizada!', {
      description: `${totalItens} itens · ${formatBRL(total)} · ${pagamento}`,
    })
    setCarrinho([])
    setPagamento('Dinheiro')
  }

  return (
    <>
      <PageHeader
        titulo="PDV / Vendas"
        descricao="Registre novas vendas e acompanhe o histórico"
      />

      <Tabs defaultValue="nova">
        <TabsList>
          <TabsTrigger value="nova">Nova venda</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="nova" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Produtos */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Produtos</CardTitle>
                  <CardDescription>
                    Busque por nome ou código de barras e toque para adicionar
                  </CardDescription>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar produto..."
                      className="pl-9"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {filtrados.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => adicionar(p)}
                        className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent/50"
                      >
                        <Badge variant="secondary" className="mb-1 text-[10px]">
                          {p.categoria}
                        </Badge>
                        <span className="line-clamp-2 text-sm font-medium leading-snug">
                          {p.nome}
                        </span>
                        <span className="mt-auto pt-1 text-sm font-bold text-primary">
                          {formatBRL(p.preco)}
                        </span>
                      </button>
                    ))}
                    {filtrados.length === 0 && (
                      <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                        Nenhum produto encontrado.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Carrinho */}
            <div>
              <Card className="sticky top-20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="size-5" />
                    Carrinho
                    {totalItens > 0 && (
                      <Badge className="ml-auto">{totalItens}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {carrinho.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum item adicionado.
                    </p>
                  ) : (
                    <ScrollArea className="h-[240px] pr-3">
                      <div className="flex flex-col gap-3">
                        {carrinho.map((i) => (
                          <div key={i.produto.id} className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {i.produto.nome}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatBRL(i.produto.preco)} un
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="outline"
                                className="size-7"
                                onClick={() => alterarQtd(i.produto.id, -1)}
                              >
                                <Minus className="size-3" />
                              </Button>
                              <span className="w-6 text-center text-sm font-medium">
                                {i.qtd}
                              </span>
                              <Button
                                size="icon"
                                variant="outline"
                                className="size-7"
                                onClick={() => alterarQtd(i.produto.id, 1)}
                              >
                                <Plus className="size-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-destructive"
                                onClick={() => remover(i.produto.id)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}

                  <Separator />

                  <div>
                    <p className="mb-2 text-sm font-medium">Pagamento</p>
                    <div className="grid grid-cols-2 gap-2">
                      {pagamentos.map((p) => (
                        <Button
                          key={p.id}
                          type="button"
                          variant={pagamento === p.id ? 'default' : 'outline'}
                          size="sm"
                          className="justify-start"
                          onClick={() => setPagamento(p.id)}
                        >
                          <p.icon className="size-4" />
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-lg font-bold">
                    <span>Total</span>
                    <span>{formatBRL(total)}</span>
                  </div>

                  <Button size="lg" onClick={finalizar}>
                    <Receipt className="size-4" />
                    Finalizar venda
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de vendas</CardTitle>
              <CardDescription>Todas as vendas registradas no PDV</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venda</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="hidden md:table-cell">Operador</TableHead>
                    <TableHead className="hidden sm:table-cell">Pagamento</TableHead>
                    <TableHead className="text-center">Itens</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendas.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">
                        #{v.id.replace('v', '')}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDataHora(v.data)}
                      </TableCell>
                      <TableCell>{v.cliente}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {v.operador}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="secondary">{v.pagamento}</Badge>
                      </TableCell>
                      <TableCell className="text-center">{v.itens}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBRL(v.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
