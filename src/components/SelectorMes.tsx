import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { mesActual, nombreMes, sumarMeses } from '@/lib/formato'
import { cn } from '@/lib/utils'

/**
 * Selector de mes igual en todas las pantallas: ◀ NOV 2026 ▶.
 * Ofrece desde 3 años atrás hasta 1 año adelante (y siempre el mes elegido).
 * Las flechas avanzan o retroceden un mes calendario.
 */
export function SelectorMes({ id, value, onChange, className }: {
  id?: string
  value: string
  onChange: (mes: string) => void
  className?: string
}) {
  const opciones = useMemo(() => {
    const hoy = mesActual()
    const desde = sumarMeses(value < hoy ? value : hoy, -36)
    const hasta = sumarMeses(value > hoy ? value : hoy, 12)
    const lista: string[] = []
    for (let m = hasta; m >= desde; m = sumarMeses(m, -1)) lista.push(m)
    return lista
  }, [value])
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label="Mes anterior" title="Mes anterior"
        onClick={() => onChange(sumarMeses(value, -1))}><ChevronLeft /></Button>
      <Select id={id} className="w-32" value={value} onChange={(e) => e.target.value && onChange(e.target.value)}>
        {opciones.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
      </Select>
      <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label="Mes siguiente" title="Mes siguiente"
        onClick={() => onChange(sumarMeses(value, 1))}><ChevronRight /></Button>
    </div>
  )
}
