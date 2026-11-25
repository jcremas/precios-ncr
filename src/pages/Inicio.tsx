import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleDashed, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError, traerTodo } from '@/lib/datos'
import { aInputMes, desdeInputMes, mesActual, nombreMes, pct, precio, UMBRAL_AUMENTO_ATIPICO } from '@/lib/formato'
import { exportarExcel, mediana } from '@/lib/precios'
import { useNiveles } from '@/lib/niveles'
import { useUsuarios } from '@/lib/usuarios'
import { nombreModalidad, type IndiceCliente, type PrecioCliente, type PrecioDetalle } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** Fila de v_estado_listas (0006). */
interface EstadoLista { mes: string; skus: number; publicada_en: string | null; ultimo_cambio: string | null }

/** Cuántos meses hacia atrás se busca el precio anterior de un especial. */
const MESES_ATRAS = 12

const mesesEntre = (desde: string, hasta: string) => {
  const [a1, m1] = desde.split('-').map(Number)
  const [a2, m2] = hasta.split('-').map(Number)
  return (a2 - a1) * 12 + (m2 - m1)
}
const restarMeses = (iso: string, n: number) => {
  const [a, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 - n, 1)).toISOString().slice(0, 10)
}
const promedio = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10)
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

type Tono = 'ok' | 'pendiente' | 'alerta' | 'neutro'
const COLOR_TONO: Record<Tono, string> = {
  ok: 'border-l-green-600',
  pendiente: 'border-l-amber-500',
  alerta: 'border-l-red-600',
  neutro: 'border-l-muted-foreground/40',
}

/** Recuadro de indicador con un número grande y una línea de detalle. */
function Indicador({ titulo, valor, detalle, tono, a }: { titulo: string; valor: ReactNode; detalle?: ReactNode; tono: Tono; a?: string }) {
  const cuerpo = (
    <div className={cn('h-full rounded-lg border border-l-4 bg-background px-4 py-3', COLOR_TONO[tono], a && 'transition-colors hover:bg-accent/50')}>
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="text-xl font-semibold tabular-nums">{valor}</div>
      {detalle && <div className="mt-0.5 text-xs text-muted-foreground">{detalle}</div>}
    </div>
  )
  return a ? <a href={a} className="block">{cuerpo}</a> : cuerpo
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-green-600" />{children}</p>
}

/** Nombre del cliente con link a su ficha. */
function LinkCliente({ id, nombre }: { id: number; nombre: string }) {
  return <Link to={`/clientes/${id}`} className="hover:underline">{nombre}</Link>
}

export default function Inicio() {
  const { yo, nombreDe } = useUsuarios()
  const { mayor } = useNiveles()
  const nombreMayor = mayor?.nombre ?? 'mayor descuento'
  const [mes, setMes] = useState(mesActual())
  const [alcance, setAlcance] = useState<'mios' | 'todos'>('mios')
  const [grupoSku, setGrupoSku] = useState('')
  const [indice, setIndice] = useState<IndiceCliente[]>([])
  const [listas, setListas] = useState<EstadoLista[]>([])
  const [detalle, setDetalle] = useState<PrecioDetalle[]>([])
  const [anteriores, setAnteriores] = useState<PrecioCliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Clientes y estado de las listas generales (pocas filas).
  useEffect(() => {
    ;(async () => {
      try {
        const [i, l] = await Promise.all([
          traerTodo<IndiceCliente>((d, h) => supabase.from('v_indice_clientes').select('*').order('id').range(d, h)),
          supabase.from('v_estado_listas').select('*').order('mes'),
        ])
        if (l.error) throw l.error
        setIndice(i)
        setListas((l.data ?? []) as EstadoLista[])
      } catch (e) {
        setError(mensajeError(e))
      }
    })()
  }, [])

  // Precios del mes (todos los clientes, solo SKUs tildados) y, para los
  // especiales, sus precios de los meses anteriores para medir el ajuste.
  const especialesIds = useMemo(() => indice.filter((c) => c.modalidad === 'ESPECIAL').map((c) => c.id), [indice])
  const claveEsp = especialesIds.join(',')
  useEffect(() => {
    if (!indice.length) return
    let vigente = true
    setCargando(true)
    const ids = claveEsp ? claveEsp.split(',').map(Number) : []
    Promise.all([
      traerTodo<PrecioDetalle>((d, h) => supabase.from('v_precios_detalle').select('*').eq('mes', mes).order('cliente_id').order('sku').range(d, h)),
      ids.length
        ? traerTodo<PrecioCliente>((d, h) => supabase.from('precios_cliente').select('cliente_id, sku, mes, precio')
          .in('cliente_id', ids).lt('mes', mes).gte('mes', restarMeses(mes, MESES_ATRAS))
          .order('mes').order('cliente_id').order('sku').range(d, h))
        : Promise.resolve([] as PrecioCliente[]),
    ])
      .then(([det, ant]) => {
        if (!vigente) return
        const n = (x: number | null) => (x == null ? null : Number(x))
        setDetalle(det.map((r) => ({ ...r, precio: Number(r.precio), lista: n(r.lista), matar: n(r.matar), precio_minimo: n(r.precio_minimo) })))
        setAnteriores(ant.map((r) => ({ ...r, precio: Number(r.precio) })))
        setCargando(false)
      })
      .catch((e) => vigente && setError(mensajeError(e)))
    return () => { vigente = false }
  }, [mes, claveEsp, indice.length])

  // Hasta correr 0013 no hay dueños: se ve todo.
  const hayDuenos = indice.some((c) => c.dueno !== undefined)
  const verTodos = alcance === 'todos' || !hayDuenos
  const clientes = useMemo(
    () => indice.filter((c) => c.activo && c.cotiza && (verTodos || c.dueno === yo)),
    [indice, verTodos, yo],
  )
  const porId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes])
  const filas = useMemo(() => detalle.filter((d) => porId.has(d.cliente_id)), [detalle, porId])

  // ---------- Lista general del mes ----------
  const lista = listas.find((l) => l.mes === mes) ?? null
  const listaAnterior = [...listas].reverse().find((l) => l.mes < mes && l.publicada_en) ?? null
  const estadoLista: { tono: Tono; valor: string; detalle: string } = !lista
    ? { tono: 'pendiente', valor: 'Sin cargar', detalle: listaAnterior ? `Sigue vigente la de ${nombreMes(listaAnterior.mes)}` : 'Todavía no hay listas' }
    : !lista.publicada_en
      ? { tono: 'pendiente', valor: 'Borrador', detalle: 'Cargada, pero los genéricos todavía no la tienen' }
      : lista.ultimo_cambio && lista.ultimo_cambio > lista.publicada_en
        ? { tono: 'alerta', valor: 'Con cambios', detalle: `Publicada el ${fecha(lista.publicada_en)}, se modificó después: volver a publicar` }
        : { tono: 'ok', valor: 'Publicada', detalle: `El ${fecha(lista.publicada_en)} · ${lista.skus} SKUs` }
  const genericos = clientes.filter((c) => c.modalidad === 'GENERICO')
  const genericosConPrecio = new Set(filas.filter((f) => f.modalidad === 'GENERICO').map((f) => f.cliente_id))

  // ---------- Especiales: ajustados y pendientes ----------
  const especiales = clientes.filter((c) => c.modalidad === 'ESPECIAL')
  const ajustados = new Set(filas.filter((f) => f.modalidad === 'ESPECIAL').map((f) => f.cliente_id))
  const pendientes = especiales
    .filter((c) => !ajustados.has(c.id))
    .map((c) => ({ ...c, atraso: c.ultimo_mes && c.ultimo_mes < mes ? mesesEntre(c.ultimo_mes, mes) : null }))
    .sort((a, b) => (b.atraso ?? 999) - (a.atraso ?? 999) || a.nombre.localeCompare(b.nombre))

  // ---------- Ajuste de los especiales contra su precio anterior ----------
  const movimientos = useMemo(() => {
    const ultimo = new Map<string, PrecioCliente>() // ya vienen ordenados por mes
    for (const p of anteriores) ultimo.set(`${p.cliente_id}-${p.sku}`, p)
    return filas
      .filter((f) => f.modalidad === 'ESPECIAL')
      .map((f) => {
        const ant = ultimo.get(`${f.cliente_id}-${f.sku}`)
        return { f, ant: ant ?? null, var: ant ? (f.precio / ant.precio - 1) * 100 : null }
      })
  }, [filas, anteriores])
  const conVar = movimientos.filter((m) => m.var != null)
  const varMediana = mediana(conVar.map((m) => m.var!))
  const subieron = conVar.filter((m) => m.var! > 0.05).length
  const bajaron = conVar.filter((m) => m.var! < -0.05)
  const atipicos = conVar.filter((m) => m.var! > UMBRAL_AUMENTO_ATIPICO)
  const paraRevisar = [...bajaron, ...atipicos].sort((a, b) => a.var! - b.var!)

  // ---------- Alertas de precio ----------
  const bajoMinimo = filas
    .filter((f) => f.precio_minimo != null && f.precio < f.precio_minimo)
    .map((f) => ({ f, dif: (f.precio / f.precio_minimo! - 1) * 100 }))
    .sort((a, b) => a.dif - b.dif)
  const sinMinimo = new Set(filas.filter((f) => f.precio_minimo == null).map((f) => f.sku))
  const debajoMayor = filas
    .filter((f) => f.modalidad === 'ESPECIAL' && f.matar != null && f.precio < f.matar)
    .map((f) => ({ f, dif: (f.precio / f.matar! - 1) * 100 }))
    .sort((a, b) => a.dif - b.dif)

  // ---------- Precios por SKU entre clientes ----------
  const porSku = useMemo(() => {
    const m = new Map<number, PrecioDetalle[]>()
    for (const d of filas) if (!grupoSku || d.modalidad === grupoSku) m.set(d.sku, [...(m.get(d.sku) ?? []), d])
    return [...m.entries()]
      .map(([sku, fs]) => {
        const orden = [...fs].sort((a, b) => a.precio - b.precio)
        const min = orden[0]
        const max = orden[orden.length - 1]
        return {
          sku, descripcion: fs[0].descripcion, clientes: fs.length,
          min, max, promedio: promedio(fs.map((f) => f.precio))!,
          lista: fs[0].lista, piso: fs[0].precio_minimo,
          dispersion: min.precio > 0 ? (max.precio / min.precio - 1) * 100 : null,
        }
      })
      .sort((a, b) => a.descripcion.localeCompare(b.descripcion))
  }, [filas, grupoSku])

  function exportarSkus() {
    exportarExcel(`precios-por-sku-${aInputMes(mes)}`,
      ['SKU', 'Producto', 'Clientes', 'Mínimo', 'Cliente mínimo', 'Promedio', 'Máximo', 'Cliente máximo', 'Lista', 'Piso', 'Dispersión %'],
      porSku.map((s) => [s.sku, s.descripcion, s.clientes, s.min.precio, s.min.cliente, r1(s.promedio), s.max.precio, s.max.cliente, s.lista, s.piso, r1(s.dispersion)]))
  }
  function exportarBajoMinimo() {
    exportarExcel(`bajo-minimo-${aInputMes(mes)}`,
      ['Cliente', 'Tipo', 'Nivel', 'SKU', 'Producto', 'Precio', 'Mínimo', 'Diferencia %'],
      bajoMinimo.map(({ f, dif }) => [f.cliente, nombreModalidad(f.modalidad), f.nivel, f.sku, f.descripcion, f.precio, f.precio_minimo, r1(dif)]))
  }

  if (error) return <p className="text-destructive">{error}</p>

  const quien = verTodos ? 'todos los clientes' : 'tus clientes'
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Inicio · {nombreMes(mes)}</h1>
          <p className="text-sm text-muted-foreground">Resumen del mes para {quien}: qué falta hacer y qué precios conviene revisar.</p>
        </div>
        {hayDuenos && (
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Clientes">
            {(['mios', 'todos'] as const).map((a) => (
              <button key={a} onClick={() => setAlcance(a)}
                className={cn('rounded px-3 py-1 text-sm', alcance === a ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}>
                {a === 'mios' ? 'Mis clientes' : 'Todos'}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor="mes" className="text-xs">Mes</Label>
          <Input id="mes" type="month" className="w-40" value={aInputMes(mes)} onChange={(e) => e.target.value && setMes(desdeInputMes(e.target.value))} />
        </div>
      </div>

      {!cargando && !verTodos && !clientes.length && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          No tenés clientes a tu nombre. Tocá <strong>Todos</strong> para ver el resumen de toda la empresa.
        </p>
      )}

      {/* ---------- Indicadores ---------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Indicador titulo={`Lista general ${nombreMes(mes)}`} tono={estadoLista.tono} valor={estadoLista.valor} detalle={estadoLista.detalle} a="#lista" />
        <Indicador titulo="Especiales ajustados" tono={cargando ? 'neutro' : pendientes.length ? 'pendiente' : 'ok'}
          valor={cargando ? '…' : `${ajustados.size} de ${especiales.length}`}
          detalle={pendientes.length ? `Faltan ${pendientes.length}` : 'Todos al día'} a="#pendientes" />
        <Indicador titulo="Aumento de los especiales" tono="neutro"
          valor={varMediana == null ? '–' : pct(varMediana)}
          detalle={conVar.length ? `Mediana de ${conVar.length} precios · ${subieron} suben, ${bajaron.length} bajan` : 'Sin precios del mes para comparar'} a="#ajuste" />
        <Indicador titulo="Precios bajo el mínimo" tono={cargando ? 'neutro' : bajoMinimo.length ? 'alerta' : 'ok'}
          valor={cargando ? '…' : bajoMinimo.length}
          detalle={bajoMinimo.length ? `En ${new Set(bajoMinimo.map((b) => b.f.cliente_id)).size} cliente(s)` : 'Ninguno'} a="#minimo" />
        <Indicador titulo={`Especiales debajo de ${nombreMayor}`} tono={cargando ? 'neutro' : debajoMayor.length ? 'pendiente' : 'ok'}
          valor={cargando ? '…' : debajoMayor.length}
          detalle={`Más baratos que el genérico más agresivo`} a="#agresivo" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Lista general ---------- */}
        <Card id="lista">
          <CardHeader>
            <CardTitle>Lista general</CardTitle>
            <CardDescription>Los genéricos toman la lista solo cuando se publica.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="flex items-center gap-2">
              {estadoLista.tono === 'ok' ? <CheckCircle2 className="size-4 text-green-600" /> : estadoLista.tono === 'alerta' ? <AlertTriangle className="size-4 text-red-600" /> : <CircleDashed className="size-4 text-amber-600" />}
              <span><strong>{nombreMes(mes)}: {estadoLista.valor.toLowerCase()}.</strong> {estadoLista.detalle}.</span>
            </p>
            {genericos.length > 0 && (
              <p className="text-muted-foreground">
                Genéricos con precios de {nombreMes(mes)}: {genericosConPrecio.size} de {genericos.length}
                {genericosConPrecio.size < genericos.length && lista?.publicada_en ? ' (los que faltan no tienen SKUs tildados con lista)' : ''}.
              </p>
            )}
            {sinMinimo.size > 0 && (
              <p className="text-amber-800">
                {sinMinimo.size} SKU(s) con precios este mes no tienen precio mínimo cargado, así que no se pueden controlar.
              </p>
            )}
            <div><Button asChild variant="outline" size="sm"><Link to="/lista">Ir a Lista general</Link></Button></div>
          </CardContent>
        </Card>

        {/* ---------- Especiales pendientes ---------- */}
        <Card id="pendientes">
          <CardHeader>
            <CardTitle>Especiales sin precios de {nombreMes(mes)}</CardTitle>
            <CardDescription>Ordenados por los más atrasados. Tocá uno para ajustarlo.</CardDescription>
          </CardHeader>
          <CardContent>
            {!cargando && !pendientes.length && <Vacio>Todos los especiales tienen precios de {nombreMes(mes)}.</Vacio>}
            {pendientes.length > 0 && (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableBody>
                    {pendientes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="py-1.5">
                          {c.dueno === undefined || c.dueno === yo
                            ? <Link to={`/ajuste?cliente=${c.id}`} className="hover:underline">{c.nombre}</Link>
                            : <LinkCliente id={c.id} nombre={c.nombre} />}
                          {verTodos && c.dueno && c.dueno !== yo && <span className="ml-2 text-xs text-muted-foreground">{nombreDe(c.dueno)}</span>}
                        </TableCell>
                        <TableCell className="py-1.5 text-right text-xs text-muted-foreground">
                          {c.ultimo_mes ? `último ${nombreMes(c.ultimo_mes)}` : 'sin precios'}
                        </TableCell>
                        <TableCell className="w-24 py-1.5 text-right">
                          {c.atraso != null && <Badge variant={c.atraso >= 3 ? 'baja' : c.atraso >= 2 ? 'alerta' : 'outline'}>{c.atraso} {c.atraso === 1 ? 'mes' : 'meses'}</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Bajo el mínimo ---------- */}
      <Card id="minimo">
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1.5">
            <CardTitle>Precios bajo el mínimo · {nombreMes(mes)}</CardTitle>
            <CardDescription>Precios guardados por debajo del piso de la lista general. En un genérico suele querer decir que el descuento de su nivel perfora el piso.</CardDescription>
          </div>
          {bajoMinimo.length > 0 && <Button variant="outline" size="sm" onClick={exportarBajoMinimo}><Download /> Exportar a Excel</Button>}
        </CardHeader>
        <CardContent>
          {!cargando && !bajoMinimo.length && <Vacio>Ningún precio de {nombreMes(mes)} está por debajo del mínimo.</Vacio>}
          {bajoMinimo.length > 0 && (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Mínimo</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bajoMinimo.map(({ f, dif }) => (
                    <TableRow key={`${f.cliente_id}-${f.sku}`}>
                      <TableCell><LinkCliente id={f.cliente_id} nombre={f.cliente} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{nombreModalidad(f.modalidad)}{f.nivel ? ` · ${f.nivel}` : ''}</TableCell>
                      <TableCell><span className="mr-2 font-mono text-xs text-muted-foreground">{f.sku}</span>{f.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums">{precio(f.precio)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.precio_minimo)}</TableCell>
                      <TableCell className="text-right"><Badge variant="baja">{pct(dif)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Ajuste de especiales para revisar ---------- */}
        <Card id="ajuste">
          <CardHeader>
            <CardTitle>Ajustes para revisar</CardTitle>
            <CardDescription>
              Especiales de {nombreMes(mes)} que bajaron o subieron más de {UMBRAL_AUMENTO_ATIPICO}% contra su precio anterior (hasta {MESES_ATRAS} meses atrás). Puede ser un error de carga.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!cargando && !paraRevisar.length && <Vacio>Ninguna baja ni aumento fuera de lo normal.</Vacio>}
            {paraRevisar.length > 0 && (
              <div className="max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Antes</TableHead>
                      <TableHead className="text-right">Ahora</TableHead>
                      <TableHead className="text-right">Var.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paraRevisar.map(({ f, ant, var: v }) => (
                      <TableRow key={`${f.cliente_id}-${f.sku}`}>
                        <TableCell><LinkCliente id={f.cliente_id} nombre={f.cliente} /></TableCell>
                        <TableCell>{f.descripcion}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {precio(ant!.precio)}<span className="block text-xs">{nombreMes(ant!.mes)}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{precio(f.precio)}</TableCell>
                        <TableCell className="text-right"><Badge variant={v! < 0 ? 'baja' : 'alerta'}>{pct(v)}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- Especiales debajo del nivel más agresivo ---------- */}
        <Card id="agresivo">
          <CardHeader>
            <CardTitle>Especiales más baratos que {nombreMayor}</CardTitle>
            <CardDescription>
              Pagan menos que el genérico con más descuento ({nombreMayor}). Pueden estar bien negociados, pero conviene saber cuáles son.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!cargando && !debajoMayor.length && <Vacio>Ningún especial está por debajo de {nombreMayor}.</Vacio>}
            {debajoMayor.length > 0 && (
              <div className="max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">{nombreMayor}</TableHead>
                      <TableHead className="text-right">Dif.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debajoMayor.map(({ f, dif }) => (
                      <TableRow key={`${f.cliente_id}-${f.sku}`}>
                        <TableCell><LinkCliente id={f.cliente_id} nombre={f.cliente} /></TableCell>
                        <TableCell>{f.descripcion}</TableCell>
                        <TableCell className="text-right tabular-nums">{precio(f.precio)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.matar)}</TableCell>
                        <TableCell className="text-right"><Badge variant="alerta">{pct(dif)}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Precios por SKU entre clientes ---------- */}
      <Card id="skus">
        <CardHeader className="flex flex-wrap items-end justify-between gap-2">
          <div className="grid gap-1.5">
            <CardTitle>Precios por SKU entre clientes · {nombreMes(mes)}</CardTitle>
            <CardDescription>Mínimo, promedio y máximo que pagan {quien}. Dispersión = cuánto más paga el que más paga que el que menos paga.</CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="grupo" className="text-xs">Clientes</Label>
              <Select id="grupo" className="w-36" value={grupoSku} onChange={(e) => setGrupoSku(e.target.value)}>
                <option value="">Todos</option>
                <option value="ESPECIAL">Especiales</option>
                <option value="GENERICO">Genéricos</option>
              </Select>
            </div>
            {porSku.length > 0 && <Button variant="outline" size="sm" onClick={exportarSkus}><Download /> Exportar a Excel</Button>}
          </div>
        </CardHeader>
        <CardContent>
          {!cargando && !porSku.length && <p className="py-2 text-sm text-muted-foreground">No hay precios de {nombreMes(mes)} para este grupo.</p>}
          {porSku.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Promedio</TableHead>
                  <TableHead className="text-right">Máximo</TableHead>
                  <TableHead className="text-right">Lista</TableHead>
                  <TableHead className="text-right">Piso</TableHead>
                  <TableHead className="text-right">Dispersión</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porSku.map((s) => (
                  <TableRow key={s.sku}>
                    <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                    <TableCell>{s.descripcion}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.clientes}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', s.piso != null && s.min.precio < s.piso && 'font-medium text-red-700')} title={s.min.cliente}>
                      {precio(s.min.precio)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{precio(s.promedio)}</TableCell>
                    <TableCell className="text-right tabular-nums" title={s.max.cliente}>{precio(s.max.precio)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{precio(s.lista)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{precio(s.piso)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.dispersion != null && s.clientes > 1 && <Badge variant={s.dispersion > 25 ? 'alerta' : 'outline'}>{pct(s.dispersion)}</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Pasá el mouse sobre el mínimo o el máximo para ver qué cliente es. En rojo: el mínimo está por debajo del piso.</p>
        </CardContent>
      </Card>

      <TarjetaCompetencia mes={mes} filas={filas} />
    </div>
  )
}

/** Lugar reservado para la competencia: lee la tabla precios_competencia
 *  (existe desde 0001) y compara con nuestros precios del mes. Cuando esté la
 *  pantalla de competencia, se puede reemplazar por un resumen más completo. */
function TarjetaCompetencia({ mes, filas }: { mes: string; filas: PrecioDetalle[] }) {
  const [datos, setDatos] = useState<{ cliente_id: number | null; sku: number; precio: number; competidor: string }[] | null>(null)
  const [noDisponible, setNoDisponible] = useState(false)
  useEffect(() => {
    let vigente = true
    supabase.from('precios_competencia').select('cliente_id, sku, precio, competidor').eq('mes', mes).order('id').limit(1000)
      .then(({ data, error }) => {
        if (!vigente) return
        setNoDisponible(!!error)
        setDatos(((data ?? []) as { cliente_id: number | null; sku: number; precio: number; competidor: string }[]).map((d) => ({ ...d, precio: Number(d.precio) })))
      })
    return () => { vigente = false }
  }, [mes])

  const nuestro = new Map(filas.map((f) => [`${f.cliente_id}-${f.sku}`, f.precio]))
  const comparables = (datos ?? []).filter((d) => d.cliente_id != null && nuestro.has(`${d.cliente_id}-${d.sku}`))
  const masCaros = comparables.filter((d) => nuestro.get(`${d.cliente_id}-${d.sku}`)! > d.precio)

  return (
    <Card id="competencia" className="border-dashed">
      <CardHeader>
        <CardTitle>Competencia · {nombreMes(mes)}</CardTitle>
        <CardDescription>Precios de la competencia que cargues por cliente, comparados con los nuestros.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {noDisponible || datos == null ? (
          <p className="text-muted-foreground">Todavía no está disponible.</p>
        ) : !datos.length ? (
          <p className="text-muted-foreground">No hay precios de competencia cargados para {nombreMes(mes)}.</p>
        ) : (
          <p>
            {datos.length} precio(s) de competencia cargados · {new Set(datos.map((d) => d.competidor)).size} competidor(es).
            {comparables.length > 0 && <> De {comparables.length} comparables con un cliente, <strong className={masCaros.length ? 'text-red-700' : ''}>en {masCaros.length} estamos más caros</strong>.</>}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
