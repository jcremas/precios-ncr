import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { AuthProvider, useAuth } from '@/lib/auth'
import { configFaltante, supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Login from '@/pages/Login'
import Clientes from '@/pages/Clientes'
import ClienteDetalle from '@/pages/ClienteDetalle'
import EnvioMensual from '@/pages/EnvioMensual'
import Cotizar from '@/pages/Cotizar'
import Skus from '@/pages/Skus'
import ListaGeneral from '@/pages/ListaGeneral'
import Consultas from '@/pages/Consultas'
import Niveles from '@/pages/Niveles'
import { NivelesProvider } from '@/lib/niveles'

const SECCIONES = [
  { a: '/envio', texto: 'Envío mensual' },
  { a: '/lista', texto: 'Lista general' },
  { a: '/clientes', texto: 'Clientes' },
  { a: '/consultas', texto: 'Consultas' },
  { a: '/cotizar', texto: 'Cotizar' },
  { a: '/skus', texto: 'SKUs' },
  { a: '/niveles', texto: 'Niveles' },
]

function Layout() {
  const { session } = useAuth()
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold">Precios NCR</span>
          <nav className="flex flex-wrap gap-1">
            {SECCIONES.map((s) => (
              <NavLink
                key={s.a}
                to={s.a}
                className={({ isActive }) =>
                  cn('rounded-md px-3 py-1.5 text-sm hover:bg-accent', isActive && 'bg-accent font-medium')
                }
              >
                {s.texto}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{session?.user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
              <LogOut /> Salir
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

function Protegido() {
  const { session, cargando } = useAuth()
  if (cargando) return <p className="p-8 text-muted-foreground">Cargando…</p>
  if (!session) return <Navigate to="/login" replace />
  return <NivelesProvider><Layout /></NivelesProvider>
}

function FaltaConfig() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-xl font-semibold">Falta configurar Supabase</h1>
      <p className="text-muted-foreground">
        Copiá el archivo <code>.env.example</code> como <code>.env</code> y completá{' '}
        <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> (ver README).
      </p>
    </div>
  )
}

export default function App() {
  if (configFaltante) return <FaltaConfig />
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protegido />}>
            <Route index element={<Navigate to="/envio" replace />} />
            <Route path="/envio" element={<EnvioMensual />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/clientes/:id" element={<ClienteDetalle />} />
            <Route path="/lista" element={<ListaGeneral />} />
            <Route path="/consultas" element={<Consultas />} />
            <Route path="/cotizar" element={<Cotizar />} />
            <Route path="/skus" element={<Skus />} />
            <Route path="/niveles" element={<Niveles />} />
            <Route path="*" element={<Navigate to="/envio" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
