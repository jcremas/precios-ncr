import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { Dialogo } from '@/components/Dialogo'

/** Cambios sin guardar: cada pantalla avisa con useCambiosSinGuardar(hay) y acá se frena la salida
 *  (otro menú, otra ficha, cerrar o recargar la pestaña) con un aviso. */

interface Ctx { hay: boolean; marcar: (id: symbol, sucio: boolean) => void }
const Contexto = createContext<Ctx>({ hay: false, marcar: () => {} })

export function CambiosProvider({ children }: { children: ReactNode }) {
  const [sucios, setSucios] = useState<ReadonlySet<symbol>>(new Set())
  const marcar = useCallback((id: symbol, sucio: boolean) => {
    setSucios((prev) => {
      if (prev.has(id) === sucio) return prev
      const sig = new Set(prev)
      if (sucio) sig.add(id)
      else sig.delete(id)
      return sig
    })
  }, [])
  const hay = sucios.size > 0

  // Navegar dentro de la app a otra pantalla.
  const bloqueo = useBlocker(({ currentLocation, nextLocation }) => hay && currentLocation.pathname !== nextLocation.pathname)

  // Cerrar o recargar la pestaña: el navegador muestra su propio aviso (no deja poner texto).
  useEffect(() => {
    if (!hay) return
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', antes)
    return () => window.removeEventListener('beforeunload', antes)
  }, [hay])

  const seguir = useCallback(() => bloqueo.state === 'blocked' && bloqueo.reset(), [bloqueo])

  return (
    <Contexto.Provider value={{ hay, marcar }}>
      {children}
      {bloqueo.state === 'blocked' && (
        <Dialogo titulo="Tenés cambios sin guardar" aceptar="Salir sin guardar" cancelar="Quedarme" peligro
          onAceptar={() => bloqueo.proceed()} onCancelar={seguir}>
          <p>Si salís de esta pantalla, los precios que escribiste y no guardaste se pierden.</p>
        </Dialogo>
      )}
    </Contexto.Provider>
  )
}

/** La pantalla avisa si tiene cambios sin guardar. */
export function useCambiosSinGuardar(hay: boolean) {
  const { marcar } = useContext(Contexto)
  const [id] = useState(() => Symbol('cambios'))
  useEffect(() => {
    marcar(id, hay)
  }, [marcar, id, hay])
  useEffect(() => () => marcar(id, false), [marcar, id])
}

/** ¿Hay algo sin guardar en alguna pantalla? (para el botón Salir). */
export const useHayCambios = () => useContext(Contexto).hay
