import { useEffect, useRef, useState } from 'react'
import { createBrowserRouter, createRoutesFromElements, Link, Navigate, NavLink, Outlet, Route, RouterProvider, useLocation } from 'react-router-dom'
import { ChevronDown, LogOut, Menu, X } from 'lucide-react'
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

// Menú: los de todos los días a la vista; el resto agrupado.
type Seccion = { a: string; texto: string }
type Grupo = { texto: string; items: Seccion[] }
const MENU: (Seccion | Grupo)[] = [
  { a: '/inicio', texto: 'Inicio' },
  { a: '/clientes', texto: 'Clientes' },
  { a: '/cotizar', texto: 'Cotizar' },
  { a: '/enviar', texto: 'Enviar listas' },
  { texto: 'Precios', items: [{ a: '/ajuste', texto: 'Ajuste mensual' }, { a: '/lista', texto: 'Lista general' }] },
  { texto: 'Análisis', items: [{ a: '/consultas', texto: 'Consultas' }, { a: '/competencia', texto: 'Competencia' }] },
  { texto: 'Configuración', items: [{ a: '/skus', texto: 'SKUs' }, { a: '/niveles', texto: 'Niveles' }, { a: '/cuenta', texto: 'Mi cuenta' }] },
]
const esGrupo = (x: Seccion | Grupo): x is Grupo => 'items' in x
const activa = (pathname: string, a: string) => pathname === a || pathname.startsWith(a + '/')

/** Botón del menú que despliega un grupo (Precios, Análisis, Configuración). */
function MenuGrupo({ grupo, pathname }: { grupo: Grupo; pathname: string }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('keydown', cerrar)
    return () => { document.removeEventListener('mousedown', cerrar); document.removeEventListener('keydown', cerrar) }
  }, [abierto])
  const dentro = grupo.items.some((i) => activa(pathname, i.a))
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}
        className={cn('flex items-center gap-1 rounded-md px-3 py-1.5 text-sm hover:bg-accent', dentro && 'bg-accent font-medium')}>
        {grupo.texto}<ChevronDown className="size-3.5 opacity-60" />
      </button>
      {abierto && (
        <div className="absolute left-0 top-full z-30 mt-1 grid min-w-44 gap-0.5 rounded-md border bg-background p-1 shadow-md">
          {grupo.items.map((i) => (
            <NavLink key={i.a} to={i.a} onClick={() => setAbierto(false)}
              className={({ isActive }) => cn('rounded px-3 py-1.5 text-sm hover:bg-accent', isActive && 'bg-accent font-medium')}>
              {i.texto}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function Layout() {
  return <CambiosProvider><Marco /></CambiosProvider>
}

function Marco() {
  const { session } = useAuth()
  const hayCambios = useHayCambios()
  const [confirmarSalir, setConfirmarSalir] = useState(false)
  const [menuCel, setMenuCel] = useState(false)
  const { esAdmin, nombreDe, yo, debeCambiarClave, noAutorizado } = useUsuarios()
  const { pathname } = useLocation()
  if (noAutorizado) return <NoAutorizado email={session?.user.email ?? ''} />
  // Con la contraseña temporal, primero hay que cambiarla.
  if (debeCambiarClave && pathname !== '/cuenta') return <Navigate to="/cuenta" replace />
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menú" aria-expanded={menuCel} onClick={() => setMenuCel(!menuCel)}>
            {menuCel ? <X /> : <Menu />}
          </Button>
          <Link to="/inicio" className="mr-2 font-semibold whitespace-nowrap">Precios NCR</Link>
          <nav className="hidden items-center gap-0.5 lg:flex">
            {MENU.map((s) => esGrupo(s) ? <MenuGrupo key={s.texto} grupo={s} pathname={pathname} /> : (
              <NavLink key={s.a} to={s.a}
                className={({ isActive }) => cn('rounded-md px-3 py-1.5 text-sm whitespace-nowrap hover:bg-accent', isActive && 'bg-accent font-medium')}>
                {s.texto}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/cuenta" className="hidden whitespace-nowrap hover:underline sm:inline" title={`${session?.user.email} · Mi cuenta (cambiar contraseña)`}>{nombreDe(yo) || session?.user.email}</Link>
            {esAdmin && <span className="hidden rounded bg-accent px-1.5 py-0.5 text-xs sm:inline" title="Administrador">Admin</span>}
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
        {menuCel && (
          <nav className="grid gap-3 border-t px-4 py-3 lg:hidden">
            <div className="grid grid-cols-2 gap-1">
              {MENU.filter((s): s is Seccion => !esGrupo(s)).map((s) => (
                <NavLink key={s.a} to={s.a} onClick={() => setMenuCel(false)}
                  className={({ isActive }) => cn('rounded-md px-3 py-2 text-sm hover:bg-accent', isActive && 'bg-accent font-medium')}>{s.texto}</NavLink>
              ))}
            </div>
            {MENU.filter(esGrupo).map((g) => (
              <div key={g.texto}>
                <p className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase">{g.texto}</p>
                <div className="grid grid-cols-2 gap-1">
                  {g.items.map((i) => (
                    <NavLink key={i.a} to={i.a} onClick={() => setMenuCel(false)}
                      className={({ isActive }) => cn('rounded-md px-3 py-2 text-sm hover:bg-accent', isActive && 'bg-accent font-medium')}>{i.texto}</NavLink>
                  ))}
                </div>
              </div>
            ))}
            <p className="px-3 text-xs text-muted-foreground">{nombreDe(yo) || session?.user.email}{esAdmin && ' · Administrador'}</p>
          </nav>
        )}
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
