import { useState } from 'react'
import { createBrowserRouter, createRoutesFromElements, Link, Navigate, NavLink, Outlet, Route, RouterProvider, useLocation } from 'react-router-dom'
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
import EnviarListas from '@/pages/EnviarListas'
import Skus from '@/pages/Skus'
import ListaGeneral from '@/pages/ListaGeneral'
import Consultas from '@/pages/Consultas'
import Inicio from '@/pages/Inicio'
import Competencia from '@/pages/Competencia'
import Niveles from '@/pages/Niveles'
import MiCuenta from '@/pages/MiCuenta'
import { NivelesProvider } from '@/lib/niveles'
import { UsuariosProvider, useUsuarios } from '@/lib/usuarios'
import { CambiosProvider, useHayCambios } from '@/lib/cambios'
import { Dialogo } from '@/components/Dialogo'

const SECCIONES = [
  { a: '/inicio', texto: 'Inicio' },
  { a: '/ajuste', texto: 'Ajuste mensual' },
  { a: '/lista', texto: 'Lista general' },
  { a: '/clientes', texto: 'Clientes' },
  { a: '/consultas', texto: 'Consultas' },
  { a: '/competencia', texto: 'Competencia' },
  { a: '/cotizar', texto: 'Cotizar' },
  { a: '/enviar', texto: 'Enviar listas' },
  { a: '/skus', texto: 'SKUs' },
  { a: '/niveles', texto: 'Niveles' },
]

function Layout() {
  return <CambiosProvider><Marco /></CambiosProvider>
}

function Marco() {
  const { session } = useAuth()
  const hayCambios = useHayCambios()
  const [confirmarSalir, setConfirmarSalir] = useState(false)
  const { esAdmin, nombreDe, yo, debeCambiarClave, noAutorizado } = useUsuarios()
  const { pathname } = useLocation()
  if (noAutorizado) return <NoAutorizado email={session?.user.email ?? ''} />
  // Con la contraseña temporal, primero hay que cambiarla.
  if (debeCambiarClave && pathname !== '/cuenta') return <Navigate to="/cuenta" replace />
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
            <Link to="/cuenta" className="hover:underline" title={`${session?.user.email} · Mi cuenta (cambiar contraseña)`}>{nombreDe(yo) || session?.user.email}</Link>
            {esAdmin && <span className="rounded bg-accent px-1.5 py-0.5 text-xs">Administrador</span>}
            <Button variant="ghost" size="sm" onClick={() => (hayCambios ? setConfirmarSalir(true) : supabase.auth.signOut())}>
              <LogOut /> Salir
            </Button>
          </div>
          {confirmarSalir && (
            <Dialogo titulo="Tenés cambios sin guardar" aceptar="Salir sin guardar" cancelar="Quedarme" peligro
              onAceptar={() => supabase.auth.signOut()} onCancelar={() => setConfirmarSalir(false)}>
              <p>Si cerrás la sesión, los precios que escribiste y no guardaste se pierden.</p>
            </Dialogo>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

function NoAutorizado({ email }: { email: string }) {
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-xl font-semibold">Usuario sin acceso</h1>
      <p className="mb-4 text-muted-foreground">
        Entraste como <strong>{email}</strong>, pero ese email no está autorizado en Precios NCR, así que no ve ningún dato.
        Salí y entrá con tu email autorizado, o pedile al administrador que te agregue.
      </p>
      <Button onClick={() => supabase.auth.signOut()}><LogOut /> Salir</Button>
    </div>
  )
}

function Protegido() {
  const { session, cargando } = useAuth()
  if (cargando) return <p className="p-8 text-muted-foreground">Cargando…</p>
  if (!session) return <Navigate to="/login" replace />
  return <UsuariosProvider><NivelesProvider><Layout /></NivelesProvider></UsuariosProvider>
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

// Router "de datos" (createBrowserRouter): hace falta para avisar al salir con cambios sin guardar (useBlocker).
const router = createBrowserRouter(createRoutesFromElements(
  <>
    <Route path="/login" element={<Login />} />
    <Route element={<Protegido />}>
      <Route index element={<Navigate to="/inicio" replace />} />
      <Route path="/inicio" element={<Inicio />} />
      <Route path="/ajuste" element={<EnvioMensual />} />
      <Route path="/envio" element={<Navigate to="/ajuste" replace />} />
      <Route path="/clientes" element={<Clientes />} />
      <Route path="/clientes/:id" element={<ClienteDetalle />} />
      <Route path="/lista" element={<ListaGeneral />} />
      <Route path="/consultas" element={<Consultas />} />
      <Route path="/competencia" element={<Competencia />} />
      <Route path="/cotizar" element={<Cotizar />} />
      <Route path="/enviar" element={<EnviarListas />} />
      <Route path="/skus" element={<Skus />} />
      <Route path="/niveles" element={<Niveles />} />
      <Route path="/cuenta" element={<MiCuenta />} />
      <Route path="*" element={<Navigate to="/inicio" replace />} />
    </Route>
  </>,
))

export default function App() {
  if (configFaltante) return <FaltaConfig />
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
