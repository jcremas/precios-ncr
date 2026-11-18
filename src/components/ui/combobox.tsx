import * as React from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface OpcionCombo {
  value: string
  label: string
  /** Texto extra que también se busca (código, modalidad...). Se muestra en gris. */
  detalle?: string
}

/** Sin tildes y en minúsculas, para buscar "garcia" y encontrar "García". */
const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Lista desplegable con buscador: se escribe parte del nombre (o del código)
 * y se van filtrando las opciones. Flechas para moverse, Enter para elegir,
 * Esc para cerrar.
 */
function Combobox({ id, value, onChange, opciones, placeholder = 'Escribí para buscar…', className, disabled, vacio }: {
  id?: string
  value: string
  onChange: (value: string) => void
  opciones: OpcionCombo[]
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Si se indica, aparece una opción para dejarlo vacío con este texto. */
  vacio?: string
}) {
  const [abierto, setAbierto] = React.useState(false)
  const [texto, setTexto] = React.useState('')
  const [activo, setActivo] = React.useState(0)
  const caja = React.useRef<HTMLDivElement>(null)
  const lista = React.useRef<HTMLUListElement>(null)
  const listaId = React.useId()

  const elegida = opciones.find((o) => o.value === value)
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean)
  const filtradas = opciones.filter((o) => {
    const donde = normalizar(`${o.label} ${o.detalle ?? ''}`)
    return palabras.every((p) => donde.includes(p))
  })
  const items: OpcionCombo[] = vacio && !palabras.length ? [{ value: '', label: vacio }, ...filtradas] : filtradas

  React.useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  React.useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-i="${activo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activo])

  function abrir() {
    if (disabled) return
    setTexto('')
    setActivo(Math.max(0, items.findIndex((o) => o.value === value)))
    setAbierto(true)
  }

  function elegir(o: OpcionCombo) {
    onChange(o.value)
    setAbierto(false)
    setTexto('')
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!abierto) abrir(); else setActivo((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { if (abierto && items[activo]) { e.preventDefault(); elegir(items[activo]) } }
    else if (e.key === 'Escape') { setAbierto(false); setTexto('') }
    else if (e.key === 'Tab') setAbierto(false)
  }

  return (
    <div ref={caja} className={cn('relative w-full', className)}>
      <input
        id={id}
        role="combobox"
        aria-expanded={abierto}
        aria-controls={listaId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        className="flex h-9 w-full rounded-md border border-input bg-transparent py-1 pr-14 pl-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={abierto ? placeholder : (elegida?.label ?? vacio ?? placeholder)}
        value={abierto ? texto : (elegida?.label ?? '')}
        onFocus={abrir}
        onClick={() => { if (!abierto) abrir() }}
        onChange={(e) => { setTexto(e.target.value); setActivo(0); setAbierto(true) }}
        onKeyDown={teclas}
      />
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-muted-foreground">
        {value && vacio != null && !disabled && (
          <button type="button" aria-label="Borrar selección" className="pointer-events-auto rounded p-0.5 hover:bg-accent"
            onMouseDown={(e) => { e.preventDefault(); onChange(''); setAbierto(false) }}>
            <X className="size-3.5" />
          </button>
        )}
        <ChevronDown className="size-4" />
      </div>
      {abierto && (
        <ul ref={lista} id={listaId} role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-md border bg-background p-1 text-sm shadow-md">
          {items.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">Sin resultados para "{texto}"</li>}
          {items.map((o, i) => (
            <li key={o.value || '__vacio'} data-i={i} role="option" aria-selected={o.value === value}
              className={cn('flex cursor-pointer items-baseline gap-2 rounded px-2 py-1.5',
                i === activo && 'bg-accent', o.value === value && 'font-medium', !o.value && 'text-muted-foreground')}
              onMouseEnter={() => setActivo(i)}
              onMouseDown={(e) => { e.preventDefault(); elegir(o) }}>
              <span className="truncate">{o.label}</span>
              {o.detalle && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.detalle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { Combobox }
