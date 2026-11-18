import { useEffect, useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { copiarTabla } from '@/lib/copiar'
import { nombreMes, precio } from '@/lib/formato'
import { leerPedidoPorReglas, normalizar, type FilaLeida } from '@/lib/leerPedido'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** Precio del cliente para cada SKU en el mes elegido (lo que muestra Cotizar). */
export interface PrecioCotizado { sku: number; descripcion: string; precio: number }

interface SkuCat { sku: number; descripcion: string; color: string | null; sinonimos?: string | null; unidades_pallet: number | null; estado: string }


interface Fila {
  texto: string
  sku: number | null
  pallets: string
  botellas: number | null
  confianza: 'alta' | 'media' | 'baja'
  nota: string | null
}

const fmtUnidades = new Intl.NumberFormat('es-AR')
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)
const fmtPallets = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** Traduce el error de la función a un mensaje claro, con el motivo real. */
async function explicarError(error: unknown): Promise<string> {
  const resp = (error as { context?: unknown }).context
  if (!(resp instanceof Response)) {
    // Sin respuesta: no se pudo llegar a la función (internet, nombre mal escrito o no creada).
    return `No se pudo llamar a la función "leer-pedido" (${mensajeError(error)}). Revisá la conexión y que la función exista en Supabase con ese nombre.`
  }
  const estado = resp.status
  let crudo = ''
  try { crudo = await resp.text() } catch { /* sin cuerpo */ }
  let cuerpo: Record<string, unknown> = {}
  try { cuerpo = JSON.parse(crudo) } catch { /* no es JSON */ }
  const codigo = String(cuerpo.code ?? '')
  // Mensajes de nuestra función (vienen en "error").
  if (typeof cuerpo.error === 'string') return `${cuerpo.error} (código ${estado})`
  // Mensajes de Supabase antes de llegar a nuestro código.
  if (estado === 404) return 'No se encontró la función "leer-pedido" en Supabase (código 404). Revisá que esté creada con ese nombre exacto.'
  if (estado === 401) return 'Supabase no aceptó tu sesión (código 401). Salí de la app y volvé a entrar.'
  if (codigo === 'BOOT_ERROR' || /boot/i.test(crudo)) return 'La función "leer-pedido" no arranca: el código quedó mal pegado. Volvé a pegarlo completo en Supabase y tocá Deploy (código ' + estado + ').'
  if (codigo === 'WORKER_LIMIT' || estado === 546 || estado === 504) return `La función tardó demasiado o se quedó sin recursos (código ${estado}). Probá de nuevo en unos minutos.`
  const detalle = String(cuerpo.message ?? cuerpo.msg ?? crudo).slice(0, 300)
  return `Error ${estado} al leer el pedido${detalle ? `: ${detalle}` : ''}. Mirá los Logs de "leer-pedido" en Supabase.`
}

/** '3' / '2,5' / '2.5' -> número; vacío o inválido -> null. */
function aPallets(t: string): number | null {
  const n = Number(t.trim().replace(',', '.'))
  return t.trim() && Number.isFinite(n) && n > 0 ? n : null
}

export default function PegarPedido({ clienteNombre, mes, precios }: { clienteNombre: string; mes: string; precios: PrecioCotizado[] }) {
  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState<Fila[]>([])
  const [catalogo, setCatalogo] = useState<SkuCat[]>([])
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [resumen, setResumen] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('skus').select('sku, descripcion, color, sinonimos, unidades_pallet, estado').order('descripcion')
      .then(async ({ data, error }) => {
        // Si la base todavía no tiene "Otros nombres" (0009), se lee sin ellos.
        if (!error) return setCatalogo((data ?? []) as SkuCat[])
        const sin = await supabase.from('skus').select('sku, descripcion, color, unidades_pallet, estado').order('descripcion')
        setCatalogo((sin.data ?? []) as SkuCat[])
      })
  }, [])

  const porSku = new Map(catalogo.map((s) => [s.sku, s]))
  const precioDe = new Map(precios.map((p) => [p.sku, Number(p.precio)]))

  const aFilas = (lista: FilaLeida[]): Fila[] =>
    lista.map((f) => ({ ...f, pallets: f.pallets != null ? String(f.pallets).replace('.', ',') : '' }))

  /** 1) Lee todo por reglas, al instante. 2) Solo las líneas sin reconocer van a la IA. */
  async function leer() {
    setError(null)
    setCopiado(false)
    setResumen(null)
    const t0 = performance.now()
    const reglas = leerPedidoPorReglas(texto, catalogo)
    const msReglas = performance.now() - t0
    setFilas(aFilas(reglas))
    const dudosas = reglas.filter((f) => f.sku == null)
    if (!reglas.length) return setError('No se encontraron productos en el texto.')
    if (!dudosas.length) return setResumen(`Leído al instante (${fmtMs(msReglas)}), sin usar IA.`)

    setLeyendo(true)
    const t1 = performance.now()
    const { data, error } = await supabase.functions.invoke('leer-pedido', { body: { texto: dudosas.map((f) => f.texto).join('\n') } })
    const msIa = performance.now() - t1
    setLeyendo(false)
    if (error) {
      setResumen(`${reglas.length - dudosas.length} línea(s) leídas al instante. ${dudosas.length} sin reconocer: elegí el SKU a mano.`)
      return setError(`No se pudo consultar a la IA: ${await explicarError(error)}`)
    }
    const deIa = (data?.filas ?? []) as FilaLeida[]
    const clave = (t: string) => normalizar(t)
    const usadas = new Set<number>()
    const final = reglas.map((f) => {
      if (f.sku != null) return f
      const k = clave(f.texto)
      const j = deIa.findIndex((x, n) => !usadas.has(n) && (clave(x.texto) === k || k.includes(clave(x.texto)) || clave(x.texto).includes(k)))
      if (j < 0 || deIa[j].sku == null) return f
      usadas.add(j)
      const x = deIa[j]
      return { ...f, sku: x.sku, pallets: f.pallets ?? x.pallets, botellas: f.botellas ?? x.botellas,
        confianza: x.confianza, nota: `Lo reconoció la IA${x.nota ? `: ${x.nota}` : ''}. Revisalo.` } as FilaLeida
    })
    setFilas(aFilas(final))
    const resueltas = final.filter((f, n) => reglas[n].sku == null && f.sku != null).length
    setResumen(`${reglas.length - dudosas.length} línea(s) leídas al instante. ${dudosas.length} consultadas a la IA (${fmtMs(msIa)}${data?.modelo ? `, ${data.modelo}` : ''}): reconoció ${resueltas}.`)
  }

  const cambiar = (i: number, cambio: Partial<Fila>) => {
    setCopiado(false)
    setFilas(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)))
  }

  /** Datos calculados y dudas de cada fila. */
  const detalle = filas.map((f) => {
    const s = f.sku != null ? porSku.get(f.sku) : undefined
    const p = f.sku != null ? precioDe.get(f.sku) : undefined
    const pallets = aPallets(f.pallets)
    const unidades = pallets != null && s?.unidades_pallet ? Math.round(pallets * s.unidades_pallet) : null
    const dudas: string[] = []
    if (f.sku == null) dudas.push('Elegí el SKU')
    else if (p == null) dudas.push(`Sin precio para este cliente en ${nombreMes(mes)}`)
    if (pallets == null) dudas.push('Falta la cantidad de pallets')
    if (f.botellas != null && unidades != null && f.botellas !== unidades)
      dudas.push(`El pedido dice ${fmtUnidades.format(f.botellas)} botellas y ${f.pallets} pallet(s) son ${fmtUnidades.format(unidades)}`)
    if (f.sku != null && f.confianza !== 'alta') dudas.push(`No es seguro (${f.confianza}): revisalo`)
    if (f.nota) dudas.push(f.nota)
    return { s, p, pallets, unidades, dudas }
  })
  const listas = detalle.filter((d, i) => filas[i].sku != null && d.p != null && d.pallets != null)

  async function copiar() {
    await copiarTabla(
      `Cotización - ${clienteNombre}`,
      [{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Precio', derecha: true }, { titulo: 'Pallets', derecha: true }, { titulo: 'Unidades', derecha: true }],
      detalle.flatMap((d, i) => (filas[i].sku != null && d.p != null && d.pallets != null
        ? [[String(filas[i].sku), d.s?.descripcion ?? '', precio(d.p), fmtPallets.format(d.pallets), d.unidades != null ? fmtUnidades.format(d.unidades) : '']]
        : [])),
      ([sku, desc, p, pal, u]) => [sku, desc, p, `${pal} pallet(s)`, u ? `${u} u.` : null].filter(Boolean).join(' · '),
    )
    setCopiado(true)
  }

  const activos = catalogo.filter((s) => s.estado === 'ACTIVO')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="size-4" /> Pegar pedido</CardTitle>
        <CardDescription>
          Pegá el pedido como te llegó (correo, WhatsApp). La app lo lee al instante comparando con la descripción y los "Otros nombres" de cada SKU (pantalla SKUs); el precio sale de la lista de este cliente en {nombreMes(mes)}.
          Solo las líneas que no reconoce se le consultan a Google Gemini (plan gratis, uno o dos segundos); a la IA le llega solo ese texto y la lista de SKUs, sin precios. Cuantos más "Otros nombres" cargues, menos se usa la IA. Revisá las filas en amarillo.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="pedido">Texto del pedido</Label>
          <textarea id="pedido" className="min-h-32 rounded-md border p-2 text-sm" value={texto} maxLength={8000}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={'3 pallets botella Burdeos Cónica Baja 750 – Verde – Boca corcho /// 3.402 botellas\n4 pallets botella Burdeos Giuliana 750 – Verde – Boca Corcho /// 4.872 botellas'} />
          <div className="flex items-center gap-2">
            <Button onClick={leer} disabled={!texto.trim() || leyendo || !catalogo.length}>Leer pedido</Button>
            {leyendo && <span className="text-sm text-muted-foreground">Consultando a la IA las líneas que no se reconocieron…</span>}
            {!leyendo && resumen && <span className="text-sm text-muted-foreground">{resumen}</span>}
            {filas.length > 0 && <Button variant="ghost" onClick={() => { setFilas([]); setResumen(null); setCopiado(false) }}>Limpiar resultado</Button>}
          </div>
        </div>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        {filas.length > 0 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {filas.length} fila(s) · {detalle.filter((d) => d.dudas.length).length} para revisar
              </span>
              <Button className="ml-auto" variant="outline" onClick={copiar} disabled={!listas.length}>
                {copiado ? 'Copiado ✓ Pegalo en el correo' : `Copiar cotización (${listas.length})`}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>SKU · Producto</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Pallets</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f, i) => {
                  const d = detalle[i]
                  return (
                    <TableRow key={i} className={d.dudas.length ? 'bg-amber-50 hover:bg-amber-100' : ''}>
                      <TableCell className="w-72 max-w-xs whitespace-normal align-top text-xs">
                        {f.texto}
                        {d.dudas.length > 0 && <ul className="mt-1 list-disc pl-4 text-amber-900">{d.dudas.map((x) => <li key={x}>{x}</li>)}</ul>}
                      </TableCell>
                      <TableCell className="align-top">
                        <Select className="h-8 min-w-64" aria-label={`SKU de la fila ${i + 1}`} value={f.sku ?? ''}
                          onChange={(e) => cambiar(i, { sku: e.target.value ? Number(e.target.value) : null, confianza: 'alta', nota: null })}>
                          <option value="">— Elegir SKU —</option>
                          {f.sku != null && !activos.some((s) => s.sku === f.sku) && <option value={f.sku}>{f.sku} · {d.s?.descripcion ?? '?'}</option>}
                          {activos.map((s) => (
                            <option key={s.sku} value={s.sku}>{s.sku} · {s.descripcion}{precioDe.has(s.sku) ? '' : ' (sin precio)'}</option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">{d.p != null ? precio(d.p) : '—'}</TableCell>
                      <TableCell className="align-top">
                        <Input className="ml-auto h-8 w-20 text-right" inputMode="decimal" aria-label={`Pallets de la fila ${i + 1}`}
                          value={f.pallets} onChange={(e) => cambiar(i, { pallets: e.target.value })} />
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">{d.unidades != null ? fmtUnidades.format(d.unidades) : '—'}</TableCell>
                      <TableCell className="align-top">
                        <Button size="sm" variant="ghost" aria-label={`Quitar fila ${i + 1}`} onClick={() => setFilas(filas.filter((_, j) => j !== i))}><Trash2 /></Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

