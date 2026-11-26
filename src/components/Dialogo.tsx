import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** Ventana de confirmación simple (sin librerías). Esc o clic afuera = cancelar. */
export function Dialogo({ titulo, children, aceptar, cancelar, onAceptar, onCancelar, peligro }: {
  titulo: string
  children?: ReactNode
  aceptar: string
  cancelar: string
  onAceptar: () => void
  onCancelar: () => void
  /** Botón de aceptar en rojo (ej. "Guardar igual", "Salir sin guardar"). */
  peligro?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // El foco va a "cancelar": un Enter apurado no guarda nada raro.
    ref.current?.focus()
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCancelar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCancelar])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialogo-titulo" className="grid max-h-[85vh] w-full max-w-2xl gap-4 overflow-hidden rounded-lg border bg-background p-5 shadow-lg">
        <h2 id="dialogo-titulo" className="text-lg font-semibold">{titulo}</h2>
        {children && <div className="min-h-0 overflow-y-auto text-sm">{children}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button ref={ref} variant="outline" onClick={onCancelar}>{cancelar}</Button>
          <Button variant={peligro ? 'destructive' : 'default'} onClick={onAceptar}>{aceptar}</Button>
        </div>
      </div>
    </div>
  )
}

interface Pedido { titulo: string; contenido?: ReactNode; aceptar?: string; cancelar?: string; peligro?: boolean }

/** Como window.confirm pero con nuestra ventana: `if (!(await confirmar({...}))) return`.
 *  Hay que poner `dialogo` en el JSX del componente. */
export function useConfirmar() {
  const [pedido, setPedido] = useState<(Pedido & { responder: (si: boolean) => void }) | null>(null)
  const confirmar = useCallback((p: Pedido) => new Promise<boolean>((responder) => setPedido({ ...p, responder })), [])
  const cerrar = useCallback((si: boolean) => {
    pedido?.responder(si)
    setPedido(null)
  }, [pedido])
  const cancelarCb = useCallback(() => cerrar(false), [cerrar])
  const dialogo = pedido && (
    <Dialogo titulo={pedido.titulo} aceptar={pedido.aceptar ?? 'Aceptar'} cancelar={pedido.cancelar ?? 'Cancelar'} peligro={pedido.peligro}
      onAceptar={() => cerrar(true)} onCancelar={cancelarCb}>
      {pedido.contenido}
    </Dialogo>
  )
  return { confirmar, dialogo }
}
