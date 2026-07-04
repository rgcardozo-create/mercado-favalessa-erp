'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type User = {
  nome: string
  email: string
  cargo: string
}

type AuthContextType = {
  user: User | null
  loading: boolean
  login: (email: string, senha: string) => { ok: boolean; erro?: string }
  logout: () => void
}

const STORAGE_KEY = 'favalessa-erp-user'

// Usuário de demonstração (dados de exemplo)
const DEMO_EMAIL = 'admin@favalessa.com'
const DEMO_SENHA = 'favalessa123'
const DEMO_USER: User = {
  nome: 'Beatriz Souza',
  email: DEMO_EMAIL,
  cargo: 'Gerente Geral',
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {
      // ignore
    }
    setLoading(false)
  }, [])

  function login(email: string, senha: string) {
    if (email.trim().toLowerCase() === DEMO_EMAIL && senha === DEMO_SENHA) {
      setUser(DEMO_USER)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_USER))
      return { ok: true }
    }
    return { ok: false, erro: 'E-mail ou senha inválidos.' }
  }

  function logout() {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
