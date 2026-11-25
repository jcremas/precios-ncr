import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

/** Un usuario de la app (tabla usuarios_autorizados). */
export interface Usuario { email: string; nombre: string | null; es_admin: boolean; cambiar_clave: boolean }

interface Ctx {
  /** Email del usuario logueado (en minúsculas). */
  yo: string
  /** Si el usuario logueado es administrador (edita lista general, SKUs y niveles). */
  esAdmin: boolean
  /** Tiene la contraseña temporal: la app lo manda a Mi cuenta a cambiarla (0014). */
  debeCambiarClave: boolean
  /** Ya se leyó la tabla y el email logueado no está autorizado (no ve nada). */
  noAutorizado: boolean
  usuarios: Usuario[]
  /** Nombre corto de un usuario por su email ("Javier"); si no tiene nombre, el email. */
  nombreDe: (email: string | null | undefined) => string
  /** Si el usuario logueado puede modificar un cliente con ese dueño. */
  puedeEditar: (dueno: string | null | undefined) => boolean
  recargar: () => Promise<void>
}

const UsuariosCtx = createContext<Ctx>({
  yo: '', esAdmin: false, debeCambiarClave: false, noAutorizado: false, usuarios: [], nombreDe: (e) => e ?? '', puedeEditar: () => false, recargar: async () => {},
})

export function UsuariosProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const yo = (session?.user.email ?? '').toLowerCase()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  // Hasta correr la migración 0013 no existe es_admin ni clientes.dueno:
  // en ese caso la app sigue como antes (todos editan todo).
  const [sinMultiusuario, setSinMultiusuario] = useState(false)
  const [cargado, setCargado] = useState(false)

  const recargar = useCallback(async () => {
    const { data } = await supabase.from('usuarios_autorizados').select('*').order('creado_en')
    const filas = (data ?? []) as Partial<Usuario>[]
    setSinMultiusuario(filas.length > 0 && filas.every((u) => u.es_admin === undefined))
    setCargado(true)
    setUsuarios(filas.map((u) => ({ email: u.email ?? '', nombre: u.nombre ?? null, es_admin: !!u.es_admin, cambiar_clave: !!u.cambiar_clave })))
  }, [])
  useEffect(() => {
    if (yo) recargar()
  }, [yo, recargar])

  const esAdmin = sinMultiusuario || usuarios.some((u) => u.email === yo && u.es_admin)
  // Un email no autorizado no ve ninguna fila de la tabla (ni la suya).
  const noAutorizado = cargado && !usuarios.some((u) => u.email === yo)
  const debeCambiarClave = usuarios.some((u) => u.email === yo && u.cambiar_clave)
  const nombreDe = (email: string | null | undefined) => {
    if (!email) return ''
    return usuarios.find((u) => u.email === email)?.nombre || email
  }
  const puedeEditar = (dueno: string | null | undefined) => (dueno === undefined ? true : dueno === yo)

  return (
    <UsuariosCtx.Provider value={{ yo, esAdmin, debeCambiarClave, noAutorizado, usuarios, nombreDe, puedeEditar, recargar }}>
      {children}
    </UsuariosCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUsuarios = () => useContext(UsuariosCtx)
