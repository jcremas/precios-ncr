import type { ReactNode } from 'react'
import { nombreMes, pct, precio } from '@/lib/formato'
import type { Aviso, TipoAviso } from '@/lib/controles'

const MAX_FILAS = 12

/** Contenido de la ventana "Revisá antes de guardar": los avisos agrupados por tipo. */
export function AvisosPrecios({ avisos, intro, umbralSuba, umbralBaja = 0, pie }: {
  avisos: Aviso[]
  intro?: ReactNode
  umbralSuba: number
  umbralBaja?: number
  pie?: ReactNode
}) {
  const grupos: { tipo: TipoAviso; titulo: string; ayuda: string }[] = [
    { tipo: 'minimo', titulo: 'Por debajo del precio mínimo', ayuda: 'El piso es el mínimo de la lista general vigente.' },
    { tipo: 'suba', titulo: `Suben más de ${umbralSuba}%`, ayuda: '¿Un cero de más o una coma mal puesta?' },
    { tipo: 'baja', titulo: umbralBaja ? `Bajan más de ${umbralBaja}%` : 'Bajan respecto del mes anterior', ayuda: '¿Es una rebaja a propósito o un error de tipeo?' },
  ]
  return (
    <div className="grid gap-4">
      {intro && <div>{intro}</div>}
      {grupos.map((g) => {
        const lista = avisos.filter((a) => a.tipo === g.tipo)
        if (!lista.length) return null
        return (
          <section key={g.tipo} className="grid gap-1">
            <h3 className={g.tipo === 'minimo' || g.tipo === 'baja' ? 'font-medium text-red-700' : 'font-medium text-amber-800'}>
              {g.titulo} ({lista.length})
            </h3>
            <p className="text-xs text-muted-foreground">{g.ayuda}</p>
            <table className="w-full table-fixed text-sm">
              <colgroup><col /><col className="w-28" /><col className="w-72" /></colgroup>
              <tbody>
                {lista.slice(0, MAX_FILAS).map((a, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2">{a.etiqueta}</td>
                    <td className="py-1 pr-2 text-right font-medium whitespace-nowrap tabular-nums">{precio(a.nuevo)}</td>
                    <td className="py-1 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                      {g.tipo === 'minimo'
                        ? `mínimo ${precio(a.minimo)}`
                        : <>antes {precio(a.anterior)}{a.anteriorMes ? ` (${nombreMes(a.anteriorMes)})` : ''} · <span className={g.tipo === 'baja' ? 'text-red-700' : 'text-amber-800'}>{pct(a.variacion)}</span></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lista.length > MAX_FILAS && <p className="text-xs text-muted-foreground">… y {lista.length - MAX_FILAS} más.</p>}
          </section>
        )
      })}
      {pie && <div>{pie}</div>}
    </div>
  )
}
