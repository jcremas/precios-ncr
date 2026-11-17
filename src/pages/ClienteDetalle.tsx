import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError, preciosDeClientes } from '@/lib/datos'
import { nombreMes, pct, precio, UMBRAL_AUMENTO_ATIPICO } from '@/lib/formato'
import type { Cliente, PrecioCliente, Sku } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormCliente } from '@/components/FormCliente'
import { traducirError, type DatosCliente } from '@/lib/clientes'

export default function ClienteDetalle() {
  const id = Number(useParams().id)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [skus, setSkus] = useState<Sku[]>([])
  const [grilla, setGrilla] = useState<{ sku: number; activo: boolean }[]>([])
  const [precios, setPrecios] = useState<PrecioCliente[]>([])
  const [editando, setEditando] = useState(false)
  const [skuNuevo, setSkuNuevo] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    const [c, s, g, p] = await Promise.all([
      supabase.from('clientes').select('*').eq('id', id).single(),
      supabase.from('skus').select('*').order('descripcion'),
      supabase.from('cliente_skus').select('sku, activo').eq('cliente_id', id),
      preciosDeClientes([id]),
    ])
    if (c.error) return setError(mensajeError(c.error))
    setCliente(c.data as Cliente)
    setSkus((s.data ?? []) as Sku[])
    setGrilla(g.data ?? [])
    setPrecios(p)
  }
  useEffect(() => {
    cargar()
  }, [id])

  const meses = useMemo(() => [...new Set(precios.map((p) => p.mes))].sort(), [precios])
  const porSku = useMemo(() => new Map(skus.map((s) => [s.sku, s])), [skus])

  // Filas: SKUs de la grilla + cualquier SKU con historial aunque ya no esté en la grilla.
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

  return (
    <div className="grid gap-6">
      <Link to="/clientes" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="size-4" /> Clientes</Link>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <CardTitle className="text-xl">{cliente.nombre}</CardTitle>
          <Badge>{cliente.nivel}</Badge>
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
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-lg font-semibold">Historial de precios</h2>
          <Select className="w-72" value={skuNuevo} onChange={(e) => setSkuNuevo(e.target.value)}>
            <option value="">Agregar un SKU a este cliente…</option>
            {disponibles.map((s) => <option key={s.sku} value={s.sku}>{s.sku} · {s.descripcion}</option>)}
          </Select>
          <Button variant="secondary" onClick={agregarSku} disabled={!skuNuevo}>Agregar</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Debajo de cada precio va la variación contra el mes anterior. <Badge variant="alerta">+30%</Badge> aumento atípico (más de {UMBRAL_AUMENTO_ATIPICO}%), <Badge variant="baja">-%</Badge> baja.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Producto</TableHead>
              {meses.map((m) => <TableHead key={m} className="text-right">{nombreMes(m)}</TableHead>)}
              <TableHead className="text-right">Acumulada</TableHead>
              <TableHead>En grilla</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => (
              <TableRow key={f.sku} className={f.activo ? '' : 'text-muted-foreground'}>
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
                <TableCell>
                  <input type="checkbox" aria-label={`SKU ${f.sku} en grilla`} checked={f.activo} onChange={(e) => cambiarActivo(f.sku, e.target.checked)} />
                </TableCell>
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
