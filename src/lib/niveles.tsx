import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

/** Un nivel de descuento, tal como está en la tabla niveles. */
export interface NivelDescuento { id: number; nombre: string; descuento_pct: number; orden: number }

interface Ctx {
  niveles: NivelDescuento[]
  /** % de descuento de un nivel por su número (0 si no existe). */
  descuento: (id: number | null | undefined) => number
  /** Nombre de un nivel por su número ('' si no tiene). */
  nombre: (id: number | null | undefined) => string
  /** Nivel con el mayor descuento (el "piso" de los genéricos). */
  mayor: NivelDescuento | null
  recargar: () => Promise<void>
}

const NivelesCtx = createContext<Ctx>({ niveles: [], descuento: () => 0, nombre: () => '', mayor: null, recargar: async () => {} })

export function NivelesProvider({ children }: { children: ReactNode }) {
  const [niveles, setNiveles] = useState<NivelDescuento[]>([])
  const recargar = useCallback(async () => {
    const { data } = await supabase.from('niveles').select('id, nombre, descuento_pct, orden').order('orden').order('nombre')
    setNiveles((data ?? []).map((n) => ({ ...n, descuento_pct: Number(n.descuento_pct) })))
  }, [])
  useEffect(() => {
    recargar()
  }, [recargar])
  const descuento = (id: number | null | undefined) => niveles.find((n) => n.id === id)?.descuento_pct ?? 0
  const nombre = (id: number | null | undefined) => niveles.find((n) => n.id === id)?.nombre ?? ''
  const mayor = niveles.reduce<NivelDescuento | null>((m, n) => (!m || n.descuento_pct > m.descuento_pct ? n : m), null)
  return <NivelesCtx.Provider value={{ niveles, descuento, nombre, mayor, recargar }}>{children}</NivelesCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useNiveles = () => useContext(NivelesCtx)

/** Texto "MEDIO (3%)". */
// eslint-disable-next-line react-refresh/only-export-components
export const etiquetaNivel = (n: NivelDescuento) => `${n.nombre} (${String(n.descuento_pct).replace('.', ',')}%)`
