import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError, preciosDeClientes } from '@/lib/datos'
import { aInputMes, desdeInputMes, mesActual, nombreMes, pct, precio, UMBRAL_AUMENTO_ATIPICO } from '@/lib/formato'
import { listaVigente, precioConDescuento } from '@/lib/precios'
import { DESCUENTOS, NIVELES, nombreModalidad, type Cliente, type ListaGeneral, type Nivel, type PrecioCliente, type Sku } from '@/lib/tipos'
import { traducirError, type DatosCliente } from '@/lib/clientes'
import { FormCliente } from '@/components/FormCliente'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const aTexto = (n: number) => String(n).replace('.', ',')
const aNumero = (t: string) => Number(t.replace(',', '.'))

/** Primera lista de un cliente especial: lista general menos un descuento, editable. */
function ListaInicial({ cliente, skus, grilla, listas, onGuardado }: {
  cliente: Cliente
  skus: Map<number, Sku>
  grilla: number[]
  listas: ListaGeneral[]
  onGuardado: () => void
}) {
  const ultimaLista = listas.reduce((m, l) => (l.mes > m ? l.mes : m), '')
  const [nivel, setNivel] = useState<Nivel>(cliente.nivel ?? 'LISTA')
  // Por defecto, el mes de la última lista general (el período vigente).
  const [mes, setMes] = useState(ultimaLista || mesActual())
  const [editados, setEditados] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const vigente = useMemo(() => listaVigente(listas, mes), [listas, mes])
  const filas = grilla
    .map((sku) => {
      const l = vigente.get(sku)
      const s = skus.get(sku)
      const calculado = l && s ? precioConDescuento(Number(l.precio), nivel, s.admite_descuento) : null
      return { sku, descripcion: s?.descripcion ?? '', lista: l ? Number(l.precio) : null, minimo: l?.precio_minimo ?? null, calculado, sinDescuento: s ? !s.admite_descuento : false }
    })
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion))

  const valor = (f: (typeof filas)[number]) => (editados[f.sku] ?? (f.calculado != null ? aTexto(f.calculado) : ''))

  async function guardar() {
    const datos = filas
      .map((f) => ({ f, v: aNumero(valor(f)) }))
      .filter(({ v }) => v > 0)
      .map(({ f, v }) => ({ cliente_id: cliente.id, sku: f.sku, mes, precio: v, origen: v === f.calculado ? 'LISTA' : 'MANUAL' }))
    if (!datos.length) return setError('No hay precios para guardar.')
    setGuardando(true)
    const { error } = await supabase.from('precios_cliente').upsert(datos, { onConflict: 'cliente_id,sku,mes' })
    setGuardando(false)
    if (error) return setError(mensajeError(error))
    // Si el cliente no tenía nivel de referencia, queda el descuento con que arrancó.
    if (!cliente.nivel) await supabase.from('clientes').update({ nivel }).eq('id', cliente.id)
    onGuardado()
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>Armar la primera lista</CardTitle>
        <CardDescription>
          Este cliente especial todavía no tiene precios. Elegí el descuento de partida: se calcula sobre la lista general en los SKUs tildados. Podés corregir cada precio antes de guardar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="nivel-ini">Descuento de partida</Label>
            <Select id="nivel-ini" className="w-48" value={nivel} onChange={(e) => { setNivel(e.target.value as Nivel); setEditados({}) }}>
              {NIVELES.map((n) => <option key={n} value={n}>{n} ({DESCUENTOS[n]}%)</option>)}
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mes-ini">Mes</Label>
            <Input id="mes-ini" type="month" className="w-44" value={aInputMes(mes)} onChange={(e) => e.target.value && setMes(desdeInputMes(e.target.value))} />
          </div>
          <Button className="ml-auto" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : `Guardar lista de ${nombreMes(mes)}`}</Button>
        </div>
        {!vigente.size && <p className="text-sm text-amber-800">No hay lista general cargada hasta {nombreMes(mes)}. Cargala en Lista general o escribí los precios a mano.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Lista</TableHead>
              <TableHead className="w-36 text-right">Precio inicial</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => (
              <TableRow key={f.sku}>
                <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                <TableCell>{f.descripcion}{f.sinDescuento && <Badge variant="outline" className="ml-2">sin descuento</Badge>}</TableCell>
                <TableCell className="text-right tabular-nums">{precio(f.lista)}</TableCell>
                <TableCell>
                  <Input className="h-8 text-right tabular-nums" inputMode="decimal" aria-label={`Precio inicial ${f.sku}`} value={valor(f)} onChange={(e) => setEditados({ ...editados, [f.sku]: e.target.value })} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.minimo)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default function ClienteDetalle() {
  const id = Number(useParams().id)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [skus, setSkus] = useState<Sku[]>([])
  const [grilla, setGrilla] = useState<{ sku: number; activo: boolean }[]>([])
  const [precios, setPrecios] = useState<PrecioCliente[]>([])
  const [listas, setListas] = useState<ListaGeneral[]>([])
  const [editando, setEditando] = useState(false)
  const [skuNuevo, setSkuNuevo] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    const [c, s, g, p, l] = await Promise.all([
      supabase.from('clientes').select('*').eq('id', id).single(),
      supabase.from('skus').select('*').order('descripcion'),
      supabase.from('cliente_skus').select('sku, activo').eq('cliente_id', id),
      preciosDeClientes([id]),
      supabase.from('lista_general').select('mes, sku, precio, precio_minimo'),
    ])
    if (c.error) return setError(mensajeError(c.error))
    setCliente(c.data as Cliente)
    setSkus((s.data ?? []) as Sku[])
    setGrilla(g.data ?? [])
    setPrecios(p)
    setListas((l.data ?? []) as ListaGeneral[])
  }
  useEffect(() => {
    cargar()
  }, [id])

  const meses = useMemo(() => [...new Set(precios.map((p) => p.mes))].sort(), [precios])
  const porSku = useMemo(() => new Map(skus.map((s) => [s.sku, s])), [skus])

  // Filas: SKUs tildados + cualquier SKU con historial aunque ya no esté tildado.
  const filas = useMemo(() => {
    const ids = new Set([...grilla.map((g) => g.sku), ...precios.map((p) => p.sku)])
    return [...ids]
      .map((sku) => {
        const valores = new Map(precios.filter((p) => p.sku === sku).map((p) => [p.mes, Number(p.precio)]))
        const conPrecio = meses.filter((m) => valores.has(m))
        const primero = conPrecio.length ? valores.get(conPrecio[0])! : null
        const ultimo = conPrecio.length ? valores.get(conPrecio[conPrecio.length - 1])! : null
        return {
          sku,
          descripcion: porSku.get(sku)?.descripcion ?? '',
          activo: grilla.find((g) => g.sku === sku)?.activo ?? false,
          valores,
          acumulada: primero && ultimo && conPrecio.length > 1 ? (ultimo / primero - 1) * 100 : null,
        }
      })
      .sort((a, b) => Number(b.activo) - Number(a.activo) || a.descripcion.localeCompare(b.descripcion))
  }, [grilla, precios, meses, porSku])

  async function guardarCliente(d: DatosCliente) {
    const { error } = await supabase.from('clientes').update(d).eq('id', id)
    if (error) return traducirError(error)
    setEditando(false)
    await cargar()
    return null
  }

  async function cambiarActivo(sku: number, activo: boolean) {
    const { error } = await supabase.from('cliente_skus').upsert({ cliente_id: id, sku, activo })
    if (error) setError(mensajeError(error))
    await cargar()
  }

  async function agregarSku() {
    if (!skuNuevo) return
    await cambiarActivo(Number(skuNuevo), true)
    setSkuNuevo('')
  }

  if (error) return <p className="text-destructive">{error}</p>
  if (!cliente) return <p className="text-muted-foreground">Cargando…</p>

  const disponibles = skus.filter((s) => s.estado === 'ACTIVO' && !grilla.some((g) => g.sku === s.sku && g.activo))
  const tildados = grilla.filter((g) => g.activo).map((g) => g.sku)

  return (
    <div className="grid gap-6">
      <Link to="/clientes" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="size-4" /> Clientes</Link>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <CardTitle className="text-xl">{cliente.nombre}</CardTitle>
          <Badge variant={cliente.modalidad === 'ESPECIAL' ? 'default' : 'secondary'}>{nombreModalidad(cliente.modalidad)}</Badge>
          {cliente.nivel && <Badge variant="outline">{cliente.nivel} ({DESCUENTOS[cliente.nivel]}%)</Badge>}
          {!cliente.cotiza && <Badge variant="baja">No cotiza</Badge>}
          {!cliente.nro_cliente && <Badge variant="alerta">Falta código de cliente</Badge>}
          {!editando && <Button className="ml-auto" variant="outline" size="sm" onClick={() => setEditando(true)}><Pencil /> Editar</Button>}
        </CardHeader>
        <CardContent>
          {editando ? (
            <FormCliente inicial={cliente} onGuardar={guardarCliente} onCancelar={() => setEditando(false)} />
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {([
                ['Código', cliente.nro_cliente], ['Segmento', cliente.segmento], ['Condición de pago', cliente.condicion_pago],
                ['Contacto', cliente.contacto], ['Email', cliente.email], ['Observaciones', cliente.observaciones],
              ] as const).map(([k, v]) => (
                <div key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v || '—'}</dd></div>
              ))}
            </dl>
          )}
          {cliente.modalidad === 'GENERICO' && (
            <p className="mt-4 text-sm text-muted-foreground">
              Cliente genérico: sus precios son la lista general menos su descuento. Se guardan solos al crearlo, al cambiarle el nivel, al tildarle un SKU y cada vez que publicás una lista en <Link className="text-primary hover:underline" to="/lista">Lista general</Link>.
            </p>
          )}
        </CardContent>
      </Card>

      {cliente.modalidad === 'ESPECIAL' && cliente.cotiza && !precios.length && (
        <ListaInicial cliente={cliente} skus={porSku} grilla={tildados} listas={listas} onGuardado={cargar} />
      )}

      <div className="grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-lg font-semibold">Historial de precios</h2>
          <Select className="w-72" value={skuNuevo} onChange={(e) => setSkuNuevo(e.target.value)}>
            <option value="">Tildar otro SKU para este cliente…</option>
            {disponibles.map((s) => <option key={s.sku} value={s.sku}>{s.sku} · {s.descripcion}</option>)}
          </Select>
          <Button variant="secondary" onClick={agregarSku} disabled={!skuNuevo}>Agregar</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          La columna "Se cotiza" es el mapa de SKUs: destildá los que no se le cotizan. Debajo de cada precio va la variación contra el mes anterior: <Badge variant="alerta">+30%</Badge> aumento atípico (más de {UMBRAL_AUMENTO_ATIPICO}%), <Badge variant="baja">-%</Badge> baja.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Se cotiza</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Producto</TableHead>
              {meses.map((m) => <TableHead key={m} className="text-right">{nombreMes(m)}</TableHead>)}
              <TableHead className="text-right">Acumulada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => (
              <TableRow key={f.sku} className={f.activo ? '' : 'text-muted-foreground'}>
                <TableCell>
                  <input type="checkbox" aria-label={`Cotizar SKU ${f.sku}`} checked={f.activo} onChange={(e) => cambiarActivo(f.sku, e.target.checked)} />
                </TableCell>
                <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                <TableCell>{f.descripcion}</TableCell>
                {meses.map((m, i) => {
                  const v = f.valores.get(m)
                  const ant = i > 0 ? f.valores.get(meses[i - 1]) : undefined
                  const varPct = v != null && ant ? (v / ant - 1) * 100 : null
                  return (
                    <TableCell key={m} className="text-right tabular-nums">
                      <div>{precio(v)}</div>
                      {varPct != null && Math.abs(varPct) >= 0.05 && (
                        <Badge variant={varPct > UMBRAL_AUMENTO_ATIPICO ? 'alerta' : varPct < 0 ? 'baja' : 'outline'}>{pct(varPct)}</Badge>
                      )}
                    </TableCell>
                  )
                })}
                <TableCell className="text-right tabular-nums">{pct(f.acumulada)}</TableCell>
              </TableRow>
            ))}
            {!filas.length && (
              <TableRow><TableCell colSpan={meses.length + 4} className="py-6 text-center text-muted-foreground">Sin SKUs ni precios cargados todavía.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
