'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ShoppingBasket, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading, login } = useAuth()
  const [email, setEmail] = useState('admin@favalessa.com')
  const [senha, setSenha] = useState('favalessa123')
  const [erro, setErro] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [loading, user, router])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setSubmitting(true)
    const res = login(email, senha)
    if (res.ok) {
      router.replace('/dashboard')
    } else {
      setErro(res.erro ?? 'Não foi possível entrar.')
      setSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Formulário */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShoppingBasket className="size-6" />
            </div>
            <div className="leading-tight">
              <p className="text-lg font-bold tracking-tight">Mercado Favalessa</p>
              <p className="text-sm text-muted-foreground">Sistema de Gestão · ERP</p>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-balance">
            Bem-vindo de volta
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acesse o painel de gestão do mercado.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@favalessa.com"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {erro && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erro}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Entrar
            </Button>
          </form>

          <div className="mt-6 rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Acesso de demonstração</p>
            <p className="mt-1">E-mail: admin@favalessa.com</p>
            <p>Senha: favalessa123</p>
          </div>
        </div>
      </div>

      {/* Painel visual */}
      <div className="relative hidden lg:block">
        <Image
          src="/mercado-hero.png"
          alt="Interior do Mercado Favalessa"
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-primary/70 via-primary/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12 text-primary-foreground">
          <p className="max-w-md text-2xl font-semibold leading-snug text-balance">
            Gestão completa do seu mercado em um só lugar.
          </p>
          <p className="mt-2 max-w-md text-sm text-primary-foreground/80">
            PDV, financeiro, clientes, funcionários e relatórios integrados.
          </p>
        </div>
      </div>
    </main>
  )
}
