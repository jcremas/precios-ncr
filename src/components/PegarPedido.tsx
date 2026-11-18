import { useEffect, useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { copiarTabla } from '@/lib/copiar'
import { nombreMes, precio } from '@/lib/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** Precio del cliente para cada SKU en el mes elegido (lo que muestra Cotizar). */
export interface PrecioCotizado { sku: number; descripcion: string; precio: number }

interface SkuCat { sku: number; descripcion: string; unidades_pallet: number | null; estado: string }

interface Fila {
  texto: string
  sku: number | null
  pallets: string
  botellas: number | null
  confianza: 'alta' | 'media' | 'baja'
  nota: string | null
}

const fmtUnidades = new Intl.NumberFormat('es-AR')
const fmtPallets = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

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

  useEffect(() => {
    supabase.from('skus').select('sku, descripcion, unidades_pallet, estado').order('descripcion')
      .then(({ data }) => setCatalogo((data ?? []) as SkuCat[]))
  }, [])

  const porSku = new Map(catalogo.map((s) => [s.sku, s]))
  const precioDe = new Map(precios.map((p) => [p.sku, Number(p.precio)]))

  async function leer() {
    setLeyendo(true)
    setError(null)
    setCopiado(false)
    const { data, error } = await supabase.functions.invoke('leer-pedido', { body: { texto } })
    setLeyendo(false)
    if (error) {
      // La función devuelve el motivo en { error }; si no se puede leer, se muestra el genérico.
      let motivo = mensajeError(error)
      try {
        const cuerpo = await (error as { context?: Response }).context?.json()
        if (cuerpo?.error) motivo = cuerpo.error
      } catch { /* sin detalle */ }
      if (/Failed to send|not found|404/i.test(motivo)) motivo = 'No se encontró la función "leer-pedido" en Supabase. Hay que crearla (ver instrucciones del PR).'
      return setError(motivo)
    }
    const recibidas = ((data?.filas ?? []) as (Omit<Fila, 'pallets'> & { pallets: number | null })[])
    if (!recibidas.length) return setError('La IA no encontró productos en el texto.')
    setFilas(recibidas.map((f) => ({ ...f, pallets: f.pallets != null ? String(f.pallets).replace('.', ',') : '' })))
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
    if (f.sku != null && f.confianza !== 'alta') dudas.push(`La IA no está segura (${f.confianza})`)
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
          Pegá el pedido como te llegó (correo, WhatsApp). La IA (Google Gemini, plan gratis) reconoce cada producto y la cantidad de pallets; el precio sale de la lista de este cliente en {nombreMes(mes)}.
          A la IA solo le llega el texto que pegues y la lista de SKUs, sin precios: borrá del texto datos que no quieras mandar. Revisá las filas marcadas en amarillo.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="pedido">Texto del pedido</Label>
          <textarea id="pedido" className="min-h-32 rounded-md border p-2 text-sm" value={texto} maxLength={8000}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={'3 pallets botella Burdeos Cónica Baja 750 – Verde – Boca corcho /// 3.402 botellas\n4 pallets botella Burdeos Giuliana 750 – Verde – Boca Corcho /// 4.872 botellas'} />
          <div className="flex items-center gap-2">
            <Button onClick={leer} disabled={!texto.trim() || leyendo}>{leyendo ? 'Leyendo…' : 'Leer pedido con IA'}</Button>
            {filas.length > 0 && <Button variant="ghost" onClick={() => { setFilas([]); setCopiado(false) }}>Limpiar resultado</Button>}
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
