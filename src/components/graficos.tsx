import { useEffect, useRef, useState, type ReactNode } from 'react'
import { nombreMes, pct, precio } from '@/lib/formato'

/* Gráficos simples en SVG (sin librerías).
 * Colores (paleta validada): azul = lista / nosotros, naranja = clientes,
 * gris = referencias (piso, sin cambio). El texto va siempre en los colores
 * de texto de la app, nunca en el color de la serie. */
// eslint-disable-next-line react-refresh/only-export-components
export const COLOR = {
  azul: '#257de0',
  naranja: '#f47230',
  gris: '#8a8a8a',
  grilla: '#ececec',
  eje: '#d4d4d4',
  texto: '#666666',
}

/** Ancho real del contenedor, para dibujar el SVG a medida. */
function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.floor(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return { ref, ancho }
}

/** Escala lineal. */
const escala = (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
  d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)

/** Marcas "lindas" para un eje. */
function marcas(min: number, max: number, n = 4) {
  if (max === min) return [min]
  const paso0 = (max - min) / n
  const pot = 10 ** Math.floor(Math.log10(paso0))
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= paso0) ?? paso0
  const salida: number[] = []
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) salida.push(Math.round(v * 1e6) / 1e6)
  return salida
}

function Tooltip({ x, y, ancho, children }: { x: number; y: number; ancho: number; children: ReactNode }) {
  const izquierda = x > ancho - 190
  return (
    <div className="pointer-events-none absolute z-10 min-w-36 rounded-md border bg-background px-3 py-2 text-xs shadow-md"
      style={{ top: y, left: izquierda ? undefined : x + 12, right: izquierda ? ancho - x + 12 : undefined }}>
      {children}
    </div>
  )
}

function FilaTip({ color, nombre, valor, linea = true }: { color: string; nombre: string; valor: string; linea?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-3" style={{ borderTop: `2px ${linea ? 'solid' : 'dashed'} ${color}` }} />
      <span className="font-semibold tabular-nums text-foreground">{valor}</span>
      <span className="text-muted-foreground">{nombre}</span>
    </div>
  )
}

export function Leyenda({ items }: { items: { color: string; nombre: string; forma: 'linea' | 'guiones' | 'banda' | 'barra' | 'punto' }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.nombre} className="flex items-center gap-1.5">
          {i.forma === 'linea' && <span className="inline-block w-4" style={{ borderTop: `2px solid ${i.color}` }} />}
          {i.forma === 'guiones' && <span className="inline-block w-4" style={{ borderTop: `2px dashed ${i.color}` }} />}
          {i.forma === 'banda' && <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: i.color, opacity: 0.18 }} />}
          {i.forma === 'barra' && <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: i.color }} />}
          {i.forma === 'punto' && <span className="inline-block size-2.5 rounded-full" style={{ background: i.color }} />}
          {i.nombre}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Evolución de un SKU: lista general, promedio de los clientes (con la banda
//    mínimo–máximo) y piso, mes a mes.
// ---------------------------------------------------------------------------
export interface PuntoEvolucion { mes: string; lista: number | null; piso: number | null; promedio: number | null; min: number | null; max: number | null; clientes: number }

export function GraficoEvolucion({ puntos }: { puntos: PuntoEvolucion[] }) {
  const { ref, ancho } = useAncho<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const alto = 240
  const m = { izq: 64, der: 16, arr: 12, aba: 28 }
  const valores = puntos.flatMap((p) => [p.lista, p.piso, p.min, p.max]).filter((v): v is number => v != null)
  if (!puntos.length || !valores.length) return <p className="py-8 text-center text-sm text-muted-foreground">Sin precios para graficar.</p>
  const lo = Math.min(...valores), hi = Math.max(...valores)
  const pad = (hi - lo) * 0.1 || hi * 0.05
  const ticks = marcas(lo - pad, hi + pad)
  const y = escala(lo - pad, hi + pad, alto - m.aba, m.arr)
  const x = escala(0, Math.max(1, puntos.length - 1), m.izq, ancho - m.der)
  const camino = (f: (p: PuntoEvolucion) => number | null) => {
    let d = ''
    let corte = true
    puntos.forEach((p, i) => {
      const v = f(p)
      if (v == null) { corte = true; return }
      d += `${corte ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      corte = false
    })
    return d
  }
  const conBanda = puntos.map((p, i) => ({ p, i })).filter(({ p }) => p.min != null && p.max != null)
  const banda = conBanda.length
    ? 'M' + conBanda.map(({ p, i }) => `${x(i).toFixed(1)},${y(p.max!).toFixed(1)}`).join('L') +
      'L' + [...conBanda].reverse().map(({ p, i }) => `${x(i).toFixed(1)},${y(p.min!).toFixed(1)}`).join('L') + 'Z'
    : ''
  const cadaCuanto = Math.ceil(puntos.length / Math.max(1, Math.floor((ancho - m.izq) / 70)))
  const h = hover != null ? puntos[hover] : null

  return (
    <div ref={ref} className="relative">
      <svg width={ancho} height={alto} role="img" aria-label="Evolución del precio del SKU"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left - m.izq) / (ancho - m.izq - m.der)) * (puntos.length - 1))
          setHover(Math.min(puntos.length - 1, Math.max(0, i)))
        }}
        onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.izq} x2={ancho - m.der} y1={y(t)} y2={y(t)} stroke={COLOR.grilla} />
            <text x={m.izq - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={COLOR.texto}>{precio(t).replace(',00', '')}</text>
          </g>
        ))}
        {puntos.map((p, i) => i % cadaCuanto === 0 && (
          <text key={p.mes} x={x(i)} y={alto - 8} textAnchor="middle" fontSize={11} fill={COLOR.texto}>{nombreMes(p.mes).replace(' 20', ' ')}</text>
        ))}
        {banda && <path d={banda} fill={COLOR.naranja} opacity={0.15} />}
        <path d={camino((p) => p.piso)} fill="none" stroke={COLOR.gris} strokeWidth={2} strokeDasharray="5 4" />
        <path d={camino((p) => p.lista)} fill="none" stroke={COLOR.azul} strokeWidth={2} strokeLinejoin="round" />
        <path d={camino((p) => p.promedio)} fill="none" stroke={COLOR.naranja} strokeWidth={2} strokeLinejoin="round" />
        {puntos.length === 1 && puntos[0].promedio != null && <circle cx={x(0)} cy={y(puntos[0].promedio)} r={4} fill={COLOR.naranja} />}
        {puntos.length === 1 && puntos[0].lista != null && <circle cx={x(0)} cy={y(puntos[0].lista)} r={4} fill={COLOR.azul} />}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.arr} y2={alto - m.aba} stroke={COLOR.eje} />
            {h!.lista != null && <circle cx={x(hover)} cy={y(h!.lista)} r={4} fill={COLOR.azul} stroke="#fff" strokeWidth={2} />}
            {h!.promedio != null && <circle cx={x(hover)} cy={y(h!.promedio)} r={4} fill={COLOR.naranja} stroke="#fff" strokeWidth={2} />}
          </g>
        )}
      </svg>
      {h && (
        <Tooltip x={x(hover!)} y={8} ancho={ancho}>
          <div className="mb-1 font-medium">{nombreMes(h.mes)}</div>
          {h.lista != null && <FilaTip color={COLOR.azul} nombre="Lista" valor={precio(h.lista)} />}
          {h.promedio != null && <FilaTip color={COLOR.naranja} nombre={`Promedio de ${h.clientes} cliente(s)`} valor={precio(h.promedio)} />}
          {h.min != null && h.max != null && h.clientes > 1 && <div className="ml-5 text-muted-foreground">de {precio(h.min)} a {precio(h.max)}</div>}
          {h.piso != null && <FilaTip color={COLOR.gris} nombre="Piso" valor={precio(h.piso)} linea={false} />}
        </Tooltip>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Distribución de los ajustes del mes (histograma): cuántos precios
//    bajaron, quedaron igual o subieron, y cuánto.
// ---------------------------------------------------------------------------
const TRAMOS: { nombre: string; desde: number; hasta: number }[] = [
  { nombre: '< −5%', desde: -Infinity, hasta: -5 },
  { nombre: '−5 a 0', desde: -5, hasta: -0.05 },
  { nombre: 'Igual', desde: -0.05, hasta: 0.05 },
  { nombre: '0 a 2', desde: 0.05, hasta: 2 },
  { nombre: '2 a 4', desde: 2, hasta: 4 },
  { nombre: '4 a 6', desde: 4, hasta: 6 },
  { nombre: '6 a 8', desde: 6, hasta: 8 },
  { nombre: '8 a 10', desde: 8, hasta: 10 },
  { nombre: '10 a 15', desde: 10, hasta: 15 },
  { nombre: '15 a 30', desde: 15, hasta: 30 },
  { nombre: '> 30%', desde: 30, hasta: Infinity },
]

export function GraficoAjustes({ variaciones }: { variaciones: number[] }) {
  const { ref, ancho } = useAncho<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  if (!variaciones.length) return <p className="py-8 text-center text-sm text-muted-foreground">Sin ajustes de especiales este mes para comparar.</p>
  const alto = 240
  const m = { izq: 36, der: 8, arr: 18, aba: 28 }
  const cuentas = TRAMOS.map((t) => variaciones.filter((v) => v >= t.desde && v < t.hasta).length)
  const tope = Math.max(...cuentas)
  const ticks = marcas(0, tope, 4).filter((t) => Number.isInteger(t))
  const y = escala(0, Math.max(tope, ticks[ticks.length - 1] ?? 1), alto - m.aba, m.arr)
  const banda = (ancho - m.izq - m.der) / TRAMOS.length
  const anchoBarra = Math.max(4, banda - 2)
  const color = (t: (typeof TRAMOS)[number]) => (t.hasta <= -0.05 ? COLOR.naranja : t.desde >= 0.05 ? COLOR.azul : COLOR.gris)

  return (
    <div ref={ref} className="relative">
      <svg width={ancho} height={alto} role="img" aria-label="Distribución de los ajustes del mes">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.izq} x2={ancho - m.der} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLOR.eje : COLOR.grilla} />
            <text x={m.izq - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={COLOR.texto}>{t}</text>
          </g>
        ))}
        {TRAMOS.map((t, i) => {
          const x0 = m.izq + i * banda + 1
          const h = y(0) - y(cuentas[i])
          return (
            <g key={t.nombre} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={x0 - 1} y={m.arr} width={banda} height={alto - m.arr - m.aba} fill="transparent" />
              {cuentas[i] > 0 && (
                <path d={barraRedondeada(x0, y(0), anchoBarra, h, 4)} fill={color(t)} opacity={hover == null || hover === i ? 1 : 0.55} />
              )}
              {cuentas[i] > 0 && banda > 22 && (
                <text x={x0 + anchoBarra / 2} y={y(cuentas[i]) - 4} textAnchor="middle" fontSize={10} fill={COLOR.texto}>{cuentas[i]}</text>
              )}
              {(banda > 40 || i % 2 === 0) && (
                <text x={x0 + anchoBarra / 2} y={alto - 8} textAnchor="middle" fontSize={10} fill={COLOR.texto}>{t.nombre}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <Tooltip x={m.izq + hover * banda + banda / 2} y={8} ancho={ancho}>
          <div className="font-semibold tabular-nums">{cuentas[hover]} precio(s)</div>
          <div className="text-muted-foreground">{TRAMOS[hover].nombre === 'Igual' ? 'sin cambio' : `variación ${TRAMOS[hover].nombre}${TRAMOS[hover].nombre.includes('%') ? '' : '%'}`}</div>
        </Tooltip>
      )}
    </div>
  )
}

/** Barra con las puntas de arriba redondeadas, apoyada en la base. */
function barraRedondeada(x: number, base: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${base}V${base - h + rr}Q${x},${base - h} ${x + rr},${base - h}H${x + w - rr}Q${x + w},${base - h} ${x + w},${base - h + rr}V${base}Z`
}

// ---------------------------------------------------------------------------
// 3. Dónde están los precios de cada SKU respecto de la lista (0 = lista):
//    raya del más barato al más caro, punto = promedio, marca = piso.
// ---------------------------------------------------------------------------
export interface RangoSku { sku: number; descripcion: string; clientes: number; min: number; max: number; promedio: number; lista: number; piso: number | null; clienteMin: string; clienteMax: string }

export function GraficoRangos({ filas }: { filas: RangoSku[] }) {
  const { ref, ancho } = useAncho<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  if (!filas.length) return null
  const fila = 26
  const etiqueta = Math.min(220, Math.max(120, ancho * 0.28))
  const m = { izq: etiqueta, der: 16, arr: 8, aba: 26 }
  const alto = m.arr + filas.length * fila + m.aba
  const rel = (v: number, l: number) => (v / l - 1) * 100
  const todos = filas.flatMap((f) => [rel(f.min, f.lista), rel(f.max, f.lista), f.piso != null ? rel(f.piso, f.lista) : 0, 0])
  const lo = Math.min(...todos) - 2, hi = Math.max(...todos) + 2
  const ticks = marcas(lo, hi, 6)
  if (!ticks.includes(0)) ticks.push(0)
  const x = escala(lo, hi, m.izq, ancho - m.der)
  const h = hover != null ? filas[hover] : null

  return (
    <div ref={ref} className="relative">
      <svg width={ancho} height={alto} role="img" aria-label="Precios de cada SKU respecto de la lista">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={m.arr} y2={alto - m.aba} stroke={t === 0 ? COLOR.azul : COLOR.grilla} strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={x(t)} y={alto - 8} textAnchor="middle" fontSize={11} fill={COLOR.texto}>{t === 0 ? 'Lista' : pct(t).replace(',0', '')}</text>
          </g>
        ))}
        {filas.map((f, i) => {
          const cy = m.arr + i * fila + fila / 2
          return (
            <g key={f.sku} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={0} y={cy - fila / 2} width={ancho} height={fila} fill={hover === i ? '#f5f5f5' : 'transparent'} />
              <text x={m.izq - 10} y={cy} dy="0.32em" textAnchor="end" fontSize={12} fill="#191919">
                {f.descripcion.length > 28 ? f.descripcion.slice(0, 27) + '…' : f.descripcion}
              </text>
              <line x1={x(rel(f.min, f.lista))} x2={x(rel(f.max, f.lista))} y1={cy} y2={cy} stroke={COLOR.naranja} strokeWidth={2} strokeLinecap="round" opacity={0.55} />
              {f.piso != null && <line x1={x(rel(f.piso, f.lista))} x2={x(rel(f.piso, f.lista))} y1={cy - 7} y2={cy + 7} stroke={COLOR.gris} strokeWidth={2} strokeDasharray="3 2" />}
              <circle cx={x(rel(f.promedio, f.lista))} cy={cy} r={4.5} fill={COLOR.naranja} stroke="#fff" strokeWidth={2} />
            </g>
          )
        })}
      </svg>
      {h && (
        <Tooltip x={x(rel(h.max, h.lista))} y={m.arr + hover! * fila + fila} ancho={ancho}>
          <div className="mb-1 font-medium">{h.descripcion}</div>
          <FilaTip color={COLOR.naranja} nombre={`promedio (${h.clientes} clientes)`} valor={`${precio(h.promedio)} · ${pct(rel(h.promedio, h.lista))}`} />
          <div className="ml-5 text-muted-foreground">más barato {precio(h.min)} ({h.clienteMin})</div>
          <div className="ml-5 text-muted-foreground">más caro {precio(h.max)} ({h.clienteMax})</div>
          <FilaTip color={COLOR.azul} nombre="lista" valor={precio(h.lista)} />
          {h.piso != null && <FilaTip color={COLOR.gris} nombre="piso" valor={`${precio(h.piso)} · ${pct(rel(h.piso, h.lista))}`} linea={false} />}
        </Tooltip>
      )}
    </div>
  )
}
