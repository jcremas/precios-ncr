import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { aInputMes, desdeInputMes, mesActual, nombreMes, pct, precio } from '@/lib/formato'
import { exportarExcel } from '@/lib/precios'
import { useUsuarios } from '@/lib/usuarios'
import { difPct, preciosCompetencia, resumir, type Competidor, type PrecioCompetencia, type ProductoCompetencia, type Resumen } from '@/lib/competencia'
import { nombreModalidad, type IndiceCliente, type Sku } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { revisarPrecios } from '@/lib/controles'
import { useCambiosSinGuardar } from '@/lib/cambios'
import { useConfirmar } from '@/components/Dialogo'
import { AvisosPrecios } from '@/components/AvisosPrecios'

/** En competencia el precio es de ellos: no hay mínimo, y avisamos si sube o baja más de esto contra su mes anterior. */
const UMBRAL_COMPETENCIA = 30
type Confirmar = ReturnType<typeof useConfirmar>['confirmar']

/** Aviso antes de guardar un precio de la competencia que cambió mucho contra su mes anterior (¿error de tipeo?). */
async function revisarCompetencia(confirmar: Confirmar, nombre: string, nuevo: number, previo: PrecioCompetencia | undefined) {
  const avisos = revisarPrecios([{ etiqueta: nombre, nuevo, anterior: previo?.precio, anteriorMes: previo?.mes }],
    { suba: UMBRAL_COMPETENCIA, baja: UMBRAL_COMPETENCIA, minimo: false })
  if (!avisos.length) return true
  return confirmar({
    titulo: 'Revisá antes de guardar',
    contenido: <AvisosPrecios avisos={avisos} umbralSuba={UMBRAL_COMPETENCIA} umbralBaja={UMBRAL_COMPETENCIA} />,
    aceptar: 'Guardar igual', cancelar: 'Volver a revisar', peligro: true,
  })
}

/** Último precio de cada producto antes del mes (filas ordenadas del mes más nuevo al más viejo). */
function previosPorProducto(anteriores: PrecioCompetencia[]) {
  const m = new Map<number, PrecioCompetencia>()
  for (const f of anteriores) if (!m.has(f.producto_id)) m.set(f.producto_id, f)
  return m
}

const PESTANAS = [
  { id: 'cargar', texto: 'Cargar precios' },
  { id: 'informe', texto: 'Informe' },
  { id: 'productos', texto: 'Competidores y productos' },
] as const
type Pestana = (typeof PESTANAS)[number]['id']

const MERCADO = 'mercado'

/** "1.234,50", "$ 300,15" o "300.15" -> número. */
const aNumero = (t: string) => {
  const limpio = t.trim().replace(/\$|\s/g, '')
  return limpio === '' ? NaN : Number(limpio.replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.'))
}
const txtNumero = (n: number) => String(n).replace('.', ',')
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10)

function traducir(e: unknown) {
  const m = mensajeError(e)
  if (m.includes('competidores_nombre_unico')) return 'Ya existe un competidor con ese nombre.'
  if (m.includes('productos_competencia_nombre_unico')) return 'Ese competidor ya tiene un producto con ese nombre.'
  if (m.includes('precios_competencia_unico')) return 'Ese producto ya tiene precio en este cliente y mes: corregilo en la tabla.'
  if (m.includes('precios_competencia_producto_id_fkey')) return 'No se puede borrar: tiene precios cargados. Desactivalo en su lugar.'
  if (m.includes('productos_competencia_competidor_id_fkey')) return 'No se puede borrar: tiene productos. Desactivalo en su lugar.'
  if (/v_competencia|competidores|productos_competencia/.test(m) && /does not exist|schema cache|no existe/i.test(m))
    return 'Falta correr la migración 0015_competencia.sql en Supabase (SQL Editor).'
  return m
}

/** Diferencia nosotros vs. competencia: rojo si estamos más caros, verde si más baratos. */
function Dif({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">–</span>
  return <span className={cn('tabular-nums', v > 0.05 ? 'text-red-700' : v < -0.05 ? 'text-green-700' : '')}>{pct(r1(v))}</span>
}

function Stat({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border bg-background px-4 py-3">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="text-lg font-semibold tabular-nums">{valor}</div>
      {nota && <div className="text-xs text-muted-foreground">{nota}</div>}
    </div>
  )
}

const quien = (f: PrecioCompetencia) => `${f.competidor} en ${f.cliente ?? 'mercado'} (${nombreMes(f.mes)})`

export default function Competencia() {
  const { esAdmin } = useUsuarios()
  const [pestana, setPestana] = useState<Pestana>('cargar')
  const [competidores, setCompetidores] = useState<Competidor[]>([])
  const [productos, setProductos] = useState<ProductoCompetencia[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [indice, setIndice] = useState<IndiceCliente[]>([])
  const [filas, setFilas] = useState<PrecioCompetencia[]>([])
  const [error, setError] = useState<string | null>(null)

  const recargar = useCallback(async () => {
    try {
      const [c, p, s, i, f] = await Promise.all([
        supabase.from('competidores').select('*').order('nombre'),
        supabase.from('productos_competencia').select('*').order('nombre'),
        supabase.from('skus').select('*').order('descripcion'),
        supabase.from('v_indice_clientes').select('*').order('nombre'),
        preciosCompetencia(),
      ])
      for (const r of [c, p, s, i]) if (r.error) throw r.error
      setCompetidores((c.data ?? []) as Competidor[])
      setProductos((p.data ?? []) as ProductoCompetencia[])
      setSkus((s.data ?? []) as Sku[])
      setIndice((i.data ?? []) as IndiceCliente[])
      setFilas(f)
      setError(null)
    } catch (e) {
      setError(traducir(e))
    }
  }, [])
  useEffect(() => {
    recargar()
  }, [recargar])

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Competencia</h1>
        <p className="text-sm text-muted-foreground">
          Precios de la competencia en cada cliente. Cada producto de la competencia (con el nombre que le pone el competidor)
          está vinculado a nuestro SKU equivalente, así se compara con lo que le cobramos a ese cliente.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b">
        {PESTANAS.map((p) => (
          <button key={p.id} onClick={() => setPestana(p.id)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', pestana === p.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {p.texto}
          </button>
        ))}
      </nav>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-destructive">{error}</p>}

      {pestana === 'cargar' && (
        <Cargar competidores={competidores} productos={productos} skus={skus} indice={indice} filas={filas} esAdmin={esAdmin}
          recargar={recargar} irAProductos={() => setPestana('productos')} />
      )}
      {pestana === 'informe' && <Informe filas={filas} competidores={competidores} skus={skus} />}
      {pestana === 'productos' && (
        <Productos competidores={competidores} productos={productos} skus={skus} filas={filas} esAdmin={esAdmin} recargar={recargar} />
      )}
    </div>
  )
}

// ======================================================================
// Cargar precios de un cliente
// ======================================================================

function Cargar({ competidores, productos, skus, indice, filas, esAdmin, recargar, irAProductos }: {
  competidores: Competidor[]; productos: ProductoCompetencia[]; skus: Sku[]; indice: IndiceCliente[]
  filas: PrecioCompetencia[]; esAdmin: boolean; recargar: () => Promise<void>; irAProductos: () => void
}) {
  const { puedeEditar, nombreDe } = useUsuarios()
  const [clienteSel, setClienteSel] = useState('')
  const [mes, setMes] = useState(mesActual())
  const [nuevo, setNuevo] = useState({ producto: '', precio: '', obs: '' })
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { confirmar, dialogo } = useConfirmar()
  useCambiosSinGuardar(nuevo.precio.trim() !== '')

  const cliente = indice.find((c) => String(c.id) === clienteSel)
  const esMercado = clienteSel === MERCADO
  const puede = esMercado ? esAdmin : cliente ? puedeEditar(cliente.dueno) : false
  const clienteId = esMercado ? null : cliente?.id ?? null

  const nombreCompetidor = useMemo(() => new Map(competidores.map((c) => [c.id, c.nombre])), [competidores])
  const descSku = useMemo(() => new Map(skus.map((s) => [s.sku, s.descripcion])), [skus])
  const opcionesProducto = productos
    .filter((p) => p.activo && competidores.find((c) => c.id === p.competidor_id)?.activo !== false)
    .map((p) => ({ value: String(p.id), label: `${nombreCompetidor.get(p.competidor_id)} · ${p.nombre}`, detalle: `= ${p.sku} ${descSku.get(p.sku) ?? ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const delCliente = filas.filter((f) => (esMercado ? f.cliente_id == null : f.cliente_id === clienteId) && (esMercado || cliente))
  const delMes = delCliente.filter((f) => f.mes === mes).sort((a, b) => a.descripcion.localeCompare(b.descripcion) || a.competidor.localeCompare(b.competidor))
  const anteriores = delCliente.filter((f) => f.mes < mes).sort((a, b) => b.mes.localeCompare(a.mes) || a.descripcion.localeCompare(b.descripcion))
  const previos = previosPorProducto(anteriores)

  async function agregar(e: FormEvent) {
    e.preventDefault()
    setAviso(null)
    const p = aNumero(nuevo.precio)
    if (!nuevo.producto) return setError('Elegí el producto de la competencia.')
    if (!(p > 0)) return setError('Escribí el precio (mayor que cero).')
    const existente = delMes.find((f) => String(f.producto_id) === nuevo.producto)
    const etiqueta = opcionesProducto.find((o) => o.value === nuevo.producto)?.label ?? ''
    if (!(await revisarCompetencia(confirmar, etiqueta, p, previos.get(Number(nuevo.producto))))) return
    const datos = { precio: p, observaciones: nuevo.obs.trim() || null }
    const { error } = existente
      ? await supabase.from('precios_competencia').update(datos).eq('id', existente.id)
      : await supabase.from('precios_competencia').insert({ ...datos, cliente_id: clienteId, producto_id: Number(nuevo.producto), mes })
    if (error) return setError(traducir(error))
    setError(null)
    setNuevo({ producto: '', precio: '', obs: '' })
    setAviso(existente ? 'Ya estaba cargado: se actualizó el precio.' : 'Precio agregado.')
    await recargar()
  }

  /** Copia los precios del último mes con datos de este cliente al mes elegido (los que falten). */
  async function copiarAnterior() {
    const ultimo = anteriores[0]?.mes
    if (!ultimo) return
    const yaEstan = new Set(delMes.map((f) => f.producto_id))
    const nuevos = anteriores.filter((f) => f.mes === ultimo && !yaEstan.has(f.producto_id))
    if (!nuevos.length) return setAviso(`Los productos de ${nombreMes(ultimo)} ya están en ${nombreMes(mes)}.`)
    if (!window.confirm(`Se copian ${nuevos.length} precio(s) de ${nombreMes(ultimo)} a ${nombreMes(mes)}, tal cual. Después corregí los que cambiaron.`)) return
    const { error } = await supabase.from('precios_competencia').insert(nuevos.map((f) => ({
      cliente_id: clienteId, producto_id: f.producto_id, mes, precio: f.precio, observaciones: f.observaciones,
    })))
    if (error) return setError(traducir(error))
    setError(null)
    setAviso(`Copiados ${nuevos.length} precio(s) de ${nombreMes(ultimo)}.`)
    await recargar()
  }

  const opcionesCliente = [
    ...(esAdmin || filas.some((f) => f.cliente_id == null) ? [{ value: MERCADO, label: 'Mercado general (sin cliente)', detalle: 'dato de mercado' }] : []),
    ...indice.filter((c) => c.activo).map((c) => ({
      value: String(c.id), label: c.nombre,
      detalle: [c.nro_cliente, nombreModalidad(c.modalidad), puedeEditar(c.dueno) ? '' : nombreDe(c.dueno)].filter(Boolean).join(' · '),
    })),
  ]

  return (
    <div className="grid gap-5">
      {dialogo}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="comp-cliente" className="text-xs">Cliente</Label>
          <Combobox id="comp-cliente" className="w-96" value={clienteSel} onChange={setClienteSel} opciones={opcionesCliente} placeholder="Buscar cliente por nombre o código…" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="comp-mes" className="text-xs">Mes</Label>
          <Input id="comp-mes" type="month" className="w-44" value={aInputMes(mes)} onChange={(e) => e.target.value && setMes(desdeInputMes(e.target.value))} />
        </div>
        {(cliente || esMercado) && !puede && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Solo lectura: {esMercado ? 'los datos de mercado los carga el administrador' : `este cliente es de ${nombreDe(cliente?.dueno)}`}.
          </p>
        )}
      </div>

      {!cliente && !esMercado && <p className="text-muted-foreground">Elegí un cliente para ver y cargar los precios de la competencia.</p>}

      {(cliente || esMercado) && (
        <>
          {puede && (
            <form onSubmit={agregar} className="flex flex-wrap items-end gap-3 rounded-lg border bg-background p-4">
              <div className="grid gap-1">
                <Label htmlFor="comp-prod" className="text-xs">Producto de la competencia</Label>
                <Combobox id="comp-prod" className="w-[28rem]" value={nuevo.producto} onChange={(v) => setNuevo({ ...nuevo, producto: v })}
                  opciones={opcionesProducto} placeholder="Competidor, nombre del producto o nuestro SKU…" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="comp-precio" className="text-xs">Precio</Label>
                <Input id="comp-precio" className="w-32 text-right" inputMode="decimal" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="comp-obs" className="text-xs">Observaciones</Label>
                <Input id="comp-obs" className="w-64" placeholder="ej. con empaque, 60 días, me lo dijo…" value={nuevo.obs} onChange={(e) => setNuevo({ ...nuevo, obs: e.target.value })} />
              </div>
              <Button type="submit"><Plus /> Agregar</Button>
              <Button type="button" variant="link" className="px-0" onClick={irAProductos}>¿No está el producto? Agregalo</Button>
            </form>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {aviso && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto font-medium">{esMercado ? 'Mercado general' : cliente!.nombre} · {nombreMes(mes)}</h2>
              {puede && anteriores.length > 0 && (
                <Button variant="outline" size="sm" onClick={copiarAnterior}>Copiar los de {nombreMes(anteriores[0].mes)}</Button>
              )}
            </div>
            {delMes.length === 0
              ? <p className="text-sm text-muted-foreground">Sin precios de la competencia en este mes.</p>
              : <TablaPrecios filas={delMes} editable={puede} recargar={recargar} onError={setError} previos={previos} confirmar={confirmar} />}
          </div>

          {anteriores.length > 0 && (
            <div className="grid gap-2">
              <h2 className="font-medium">Meses anteriores</h2>
              <TablaPrecios filas={anteriores} editable={false} mostrarMes recargar={recargar} onError={setError} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TablaPrecios({ filas, editable, mostrarMes, recargar, onError, previos, confirmar }: {
  filas: PrecioCompetencia[]; editable: boolean; mostrarMes?: boolean; recargar: () => Promise<void>; onError: (m: string | null) => void
  previos?: Map<number, PrecioCompetencia>; confirmar?: Confirmar
}) {
  return (
    <Table>
      <TableHeader><TableRow>
        {mostrarMes && <TableHead>Mes</TableHead>}
        <TableHead>Competidor</TableHead><TableHead>Su producto</TableHead><TableHead>Nuestro SKU</TableHead>
        <TableHead className="text-right">Precio competencia</TableHead>
        <TableHead className="text-right">Nuestro precio</TableHead>
        <TableHead className="text-right" title="Positivo: estamos más caros que la competencia">Nosotros vs. ellos</TableHead>
        <TableHead>Observaciones</TableHead>
        {editable && <TableHead />}
      </TableRow></TableHeader>
      <TableBody>
        {filas.map((f) => editable
          ? <FilaEditable key={`${f.id}-${f.precio}-${f.observaciones}`} f={f} recargar={recargar} onError={onError} previo={previos?.get(f.producto_id)} confirmar={confirmar} />
          : (
            <TableRow key={f.id}>
              {mostrarMes && <TableCell className="whitespace-nowrap">{nombreMes(f.mes)}</TableCell>}
              <CeldasFijas f={f} />
              <TableCell className="text-right tabular-nums">{precio(f.precio)}</TableCell>
              <CeldasNuestras f={f} />
              <TableCell className="text-sm text-muted-foreground">{f.observaciones}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  )
}

function CeldasFijas({ f }: { f: PrecioCompetencia }) {
  return (
    <>
      <TableCell>{f.competidor}</TableCell>
      <TableCell>{f.producto}</TableCell>
      <TableCell><span className="font-mono text-xs">{f.sku}</span> <span className="text-sm text-muted-foreground">{f.descripcion}</span></TableCell>
    </>
  )
}

function CeldasNuestras({ f, precioCompetencia = f.precio }: { f: PrecioCompetencia; precioCompetencia?: number }) {
  const otroMes = f.nuestro_mes && f.nuestro_mes !== f.mes
  return (
    <>
      <TableCell className="text-right tabular-nums" title={otroMes ? `Nuestro último precio es de ${nombreMes(f.nuestro_mes!)}` : undefined}>
        {f.cliente_id == null
          ? <span className="text-muted-foreground" title="Dato de mercado: se compara con la lista general">{precio(f.lista)} (lista)</span>
          : <>{precio(f.nuestro_precio)}{otroMes && <span className="text-xs text-muted-foreground"> ({nombreMes(f.nuestro_mes!)})</span>}</>}
      </TableCell>
      <TableCell className="text-right"><Dif v={difPct(f.cliente_id == null ? f.lista : f.nuestro_precio, precioCompetencia)} /></TableCell>
    </>
  )
}

function FilaEditable({ f, recargar, onError, previo, confirmar }: {
  f: PrecioCompetencia; recargar: () => Promise<void>; onError: (m: string | null) => void
  previo?: PrecioCompetencia; confirmar?: Confirmar
}) {
  const [valor, setValor] = useState(txtNumero(f.precio))
  const [obs, setObs] = useState(f.observaciones ?? '')
  const cambio = valor !== txtNumero(f.precio) || obs !== (f.observaciones ?? '')
  const n = aNumero(valor)
  useCambiosSinGuardar(cambio)

  async function guardar() {
    if (!(n > 0)) return onError('El precio tiene que ser mayor que cero.')
    if (confirmar && n !== f.precio && !(await revisarCompetencia(confirmar, `${f.competidor} · ${f.producto}`, n, previo))) return
    const { error } = await supabase.from('precios_competencia').update({ precio: n, observaciones: obs.trim() || null }).eq('id', f.id)
    if (error) return onError(traducir(error))
    onError(null)
    await recargar()
  }
  async function borrar() {
    if (!window.confirm(`¿Borrar el precio de ${f.competidor} · ${f.producto} de ${nombreMes(f.mes)}?`)) return
    const { error } = await supabase.from('precios_competencia').delete().eq('id', f.id)
    if (error) return onError(traducir(error))
    onError(null)
    await recargar()
  }

  return (
    <TableRow>
      <CeldasFijas f={f} />
      <TableCell className="text-right">
        <Input className="ml-auto h-8 w-24 text-right" inputMode="decimal" aria-label={`Precio ${f.producto}`} value={valor} onChange={(e) => setValor(e.target.value)} />
      </TableCell>
      <CeldasNuestras f={f} precioCompetencia={n > 0 ? n : f.precio} />
      <TableCell><Input className="h-8 w-44" aria-label={`Observaciones ${f.producto}`} value={obs} onChange={(e) => setObs(e.target.value)} /></TableCell>
      <TableCell className="whitespace-nowrap">
        {cambio && <Button size="sm" onClick={guardar}>Guardar</Button>}
        <Button size="sm" variant="ghost" aria-label={`Borrar ${f.producto}`} onClick={borrar}><Trash2 /></Button>
      </TableCell>
    </TableRow>
  )
}

// ======================================================================
// Informe: mínimo, máximo, promedio y diferencia con nosotros
// ======================================================================

const VISTAS = [
  { id: 'sku', texto: 'Por SKU' },
  { id: 'competidor', texto: 'Por competidor' },
  { id: 'cliente', texto: 'Por cliente' },
  { id: 'detalle', texto: 'Detalle' },
] as const
type Vista = (typeof VISTAS)[number]['id']

function BotonExportar({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" size="sm" onClick={onClick}><Download /> Exportar a Excel</Button>
}

function Informe({ filas, competidores, skus }: { filas: PrecioCompetencia[]; competidores: Competidor[]; skus: Sku[] }) {
  const meses = useMemo(() => [...new Set(filas.map((f) => f.mes))].sort().reverse(), [filas])
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [competidor, setCompetidor] = useState('')
  const [grupo, setGrupo] = useState('')
  const [sku, setSku] = useState('')
  const [vista, setVista] = useState<Vista>('sku')
  const [abierto, setAbierto] = useState<string | null>(null)

  // Por defecto: el último mes con datos.
  const d = desde || meses[0] || ''
  const h = hasta || meses[0] || ''
  const filtradas = useMemo(() => filas.filter((f) =>
    f.mes >= d && f.mes <= h
    && (!competidor || String(f.competidor_id) === competidor)
    && (!sku || String(f.sku) === sku)
    && (!grupo || (grupo === MERCADO ? f.cliente_id == null : f.modalidad === grupo))), [filas, d, h, competidor, sku, grupo])

  const porSku = useMemo(() => resumir(filtradas, (f) => String(f.sku), (f) => f.descripcion).sort((a, b) => a.titulo.localeCompare(b.titulo)), [filtradas])
  const porCompetidor = useMemo(() => resumir(filtradas, (f) => String(f.competidor_id), (f) => f.competidor).sort((a, b) => b.datos - a.datos), [filtradas])
  const porCliente = useMemo(() => resumir(filtradas, (f) => String(f.cliente_id ?? MERCADO), (f) => f.cliente ?? 'Mercado general')
    .sort((a, b) => (b.difPromedio ?? -999) - (a.difPromedio ?? -999)), [filtradas])
  const total = useMemo(() => resumir(filtradas, () => 'total', () => 'Total')[0], [filtradas])

  const periodo = d === h ? nombreMes(d) : `${nombreMes(d)} a ${nombreMes(h)}`
  const archivo = (que: string) => `competencia_${que}_${aInputMes(d)}${d === h ? '' : `_${aInputMes(h)}`}`

  if (!filas.length) return <p className="text-muted-foreground">Todavía no hay precios de la competencia cargados.</p>

  const colsResumen = ['Datos', 'Clientes', 'Mínimo', 'Quién (mínimo)', 'Máximo', 'Quién (máximo)', 'Promedio', 'Mediana', 'Nuestro promedio', 'Nosotros vs. ellos %', 'Comparables', 'Competencia más barata']
  const valoresResumen = (r: Resumen) => [r.datos, r.clientes, r.minimo.precio, quien(r.minimo), r.maximo.precio, quien(r.maximo), r1(r.promedio), r1(r.mediana), r1(r.nuestroPromedio), r1(r.difPromedio), r.comparables, r.competenciaMasBarata]

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="inf-desde" className="text-xs">Desde</Label>
          <Select id="inf-desde" className="w-32" value={d} onChange={(e) => { setDesde(e.target.value); if (e.target.value > h) setHasta(e.target.value) }}>
            {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="inf-hasta" className="text-xs">Hasta</Label>
          <Select id="inf-hasta" className="w-32" value={h} onChange={(e) => { setHasta(e.target.value); if (e.target.value < d) setDesde(e.target.value) }}>
            {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="inf-comp" className="text-xs">Competidor</Label>
          <Select id="inf-comp" className="w-44" value={competidor} onChange={(e) => setCompetidor(e.target.value)}>
            <option value="">Todos</option>
            {competidores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="inf-grupo" className="text-xs">Clientes</Label>
          <Select id="inf-grupo" className="w-44" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
            <option value="">Todos</option>
            <option value="ESPECIAL">Especiales</option>
            <option value="GENERICO">Genéricos</option>
            <option value={MERCADO}>Solo mercado general</option>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="inf-sku" className="text-xs">SKU</Label>
          <Combobox id="inf-sku" className="w-72" value={sku} onChange={setSku} vacio="Todos los SKUs"
            opciones={skus.filter((s) => filas.some((f) => f.sku === s.sku)).map((s) => ({ value: String(s.sku), label: s.descripcion, detalle: String(s.sku) }))} />
        </div>
      </div>

      {!total
        ? <p className="text-muted-foreground">No hay datos con estos filtros.</p>
        : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat titulo="Precios cargados" valor={String(total.datos)} nota={periodo} />
              <Stat titulo="Clientes" valor={String(total.clientes)} />
              <Stat titulo="Competidores" valor={String(total.competidores)} />
              <Stat titulo="SKUs" valor={String(total.skus)} />
              <Stat titulo="Nosotros vs. ellos (promedio)" valor={total.difPromedio == null ? '–' : pct(r1(total.difPromedio))}
                nota={total.comparables ? `ellos más baratos en ${total.competenciaMasBarata} de ${total.comparables}` : 'sin precios nuestros para comparar'} />
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {VISTAS.map((v) => (
                <Button key={v.id} size="sm" variant={vista === v.id ? 'default' : 'outline'} onClick={() => setVista(v.id)}>{v.texto}</Button>
              ))}
              <span className="ml-2 text-xs text-muted-foreground">"Nosotros vs. ellos": positivo (rojo) = estamos más caros; se compara cada precio con el nuestro al mismo cliente y SKU.</span>
            </div>

            {vista === 'sku' && (
              <div className="grid gap-2">
                <div className="flex items-center gap-3">
                  <p className="mr-auto text-sm text-muted-foreground">Cada SKU nuestro con los precios de sus equivalentes de la competencia ({periodo}). Click en un SKU para verlo por competidor.</p>
                  <BotonExportar onClick={() => exportarExcel(archivo('por_sku'), ['SKU', 'Producto', ...colsResumen, 'Lista'],
                    porSku.map((r) => [Number(r.clave), r.titulo, ...valoresResumen(r), r.lista]))} />
                </div>
                <TablaResumen filas={porSku} primera="Producto" mostrarSku conLista abierto={abierto} setAbierto={setAbierto} />
              </div>
            )}
            {vista === 'competidor' && (
              <div className="grid gap-2">
                <div className="flex items-center gap-3">
                  <p className="mr-auto text-sm text-muted-foreground">Cada competidor, todos sus productos ({periodo}). Click para verlo por SKU.</p>
                  <BotonExportar onClick={() => exportarExcel(archivo('por_competidor'), ['Competidor', 'SKUs', ...colsResumen],
                    porCompetidor.map((r) => [r.titulo, r.skus, ...valoresResumen(r)]))} />
                </div>
                <TablaResumen filas={porCompetidor} primera="Competidor" mostrarSkus abierto={abierto} setAbierto={setAbierto} detallePorSku />
              </div>
            )}
            {vista === 'cliente' && (
              <div className="grid gap-2">
                <div className="flex items-center gap-3">
                  <p className="mr-auto text-sm text-muted-foreground">Clientes ordenados por diferencia: arriba, donde estamos más caros que la competencia ({periodo}).</p>
                  <BotonExportar onClick={() => exportarExcel(archivo('por_cliente'), ['Cliente', 'SKUs', 'Competidores', 'Datos', 'Nosotros vs. ellos %', 'Comparables', 'Competencia más barata'],
                    porCliente.map((r) => [r.titulo, r.skus, r.competidores, r.datos, r1(r.difPromedio), r.comparables, r.competenciaMasBarata]))} />
                </div>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Cliente</TableHead><TableHead className="text-right">SKUs</TableHead><TableHead className="text-right">Competidores</TableHead>
                    <TableHead className="text-right">Datos</TableHead><TableHead className="text-right">Nosotros vs. ellos</TableHead>
                    <TableHead className="text-right">Ellos más baratos</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {porCliente.map((r) => (
                      <TableRow key={r.clave}>
                        <TableCell>{r.titulo}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.skus}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.competidores}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.datos}</TableCell>
                        <TableCell className="text-right"><Dif v={r.difPromedio} /></TableCell>
                        <TableCell className="text-right tabular-nums">{r.comparables ? `${r.competenciaMasBarata} de ${r.comparables}` : '–'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {vista === 'detalle' && (
              <div className="grid gap-2">
                <div className="flex items-center gap-3">
                  <p className="mr-auto text-sm text-muted-foreground">Todos los precios cargados con estos filtros ({filtradas.length}).</p>
                  <BotonExportar onClick={() => exportarExcel(archivo('detalle'), ['Mes', 'Cliente', 'Código', 'Modalidad', 'Competidor', 'Su producto', 'SKU', 'Nuestro producto', 'Precio competencia', 'Nuestro precio', 'Mes de nuestro precio', 'Lista', 'Nosotros vs. ellos %', 'Observaciones'],
                    filtradas.map((f) => [nombreMes(f.mes), f.cliente ?? 'Mercado general', f.nro_cliente, f.modalidad ? nombreModalidad(f.modalidad) : '', f.competidor, f.producto, f.sku, f.descripcion,
                      f.precio, f.nuestro_precio, f.nuestro_mes ? nombreMes(f.nuestro_mes) : '', f.lista, r1(difPct(f.nuestro_precio, f.precio)), f.observaciones]))} />
                </div>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Mes</TableHead><TableHead>Cliente</TableHead><TableHead>Competidor</TableHead><TableHead>Su producto</TableHead><TableHead>Nuestro SKU</TableHead>
                    <TableHead className="text-right">Precio competencia</TableHead><TableHead className="text-right">Nuestro precio</TableHead><TableHead className="text-right">Nosotros vs. ellos</TableHead>
                    <TableHead>Observaciones</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {[...filtradas].sort((a, b) => b.mes.localeCompare(a.mes) || (a.cliente ?? '').localeCompare(b.cliente ?? '') || a.descripcion.localeCompare(b.descripcion)).map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="whitespace-nowrap">{nombreMes(f.mes)}</TableCell>
                        <TableCell>{f.cliente ?? <span className="text-muted-foreground">Mercado general</span>}</TableCell>
                        <CeldasFijas f={f} />
                        <TableCell className="text-right tabular-nums">{precio(f.precio)}</TableCell>
                        <CeldasNuestras f={f} />
                        <TableCell className="text-sm text-muted-foreground">{f.observaciones}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
    </div>
  )
}

function TablaResumen({ filas, primera, mostrarSku, mostrarSkus, conLista, abierto, setAbierto, detallePorSku }: {
  filas: Resumen[]; primera: string; mostrarSku?: boolean; mostrarSkus?: boolean; conLista?: boolean
  abierto: string | null; setAbierto: (k: string | null) => void; detallePorSku?: boolean
}) {
  return (
    <Table>
      <TableHeader><TableRow>
        {mostrarSku && <TableHead>SKU</TableHead>}
        <TableHead>{primera}</TableHead>
        {mostrarSkus && <TableHead className="text-right">SKUs</TableHead>}
        <TableHead className="text-right">Datos</TableHead><TableHead className="text-right">Clientes</TableHead>
        <TableHead className="text-right">Mínimo</TableHead><TableHead className="text-right">Máximo</TableHead>
        <TableHead className="text-right">Promedio</TableHead><TableHead className="text-right">Mediana</TableHead>
        <TableHead className="text-right">Nuestro promedio</TableHead>
        {conLista && <TableHead className="text-right">Lista</TableHead>}
        <TableHead className="text-right" title="Positivo: estamos más caros que la competencia">Nosotros vs. ellos</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {filas.map((r) => {
          const sub = abierto === r.clave
            ? (detallePorSku
              ? resumir(r.filas, (f) => String(f.sku), (f) => `${f.sku} · ${f.descripcion}`)
              : resumir(r.filas, (f) => String(f.competidor_id), (f) => f.competidor)).sort((a, b) => a.titulo.localeCompare(b.titulo))
            : []
          return (
            <Fragment key={r.clave}>
              <TableRow className="cursor-pointer" onClick={() => setAbierto(abierto === r.clave ? null : r.clave)}>
                {mostrarSku && <TableCell className="font-mono text-xs">{r.clave}</TableCell>}
                <TableCell className="text-primary">{abierto === r.clave ? '▾ ' : '▸ '}{r.titulo}</TableCell>
                {mostrarSkus && <TableCell className="text-right tabular-nums">{r.skus}</TableCell>}
                <CeldasResumen r={r} conLista={conLista} />
              </TableRow>
              {sub.map((s) => (
                <TableRow key={`${r.clave}-${s.clave}`} className="bg-muted/40 text-sm">
                  {mostrarSku && <TableCell />}
                  <TableCell className="pl-8">
                    {s.titulo}
                    {!detallePorSku && <div className="text-xs text-muted-foreground">{[...new Set(s.filas.map((f) => f.producto))].join(' · ')}</div>}
                  </TableCell>
                  {mostrarSkus && <TableCell />}
                  <CeldasResumen r={s} conLista={conLista} />
                </TableRow>
              ))}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}

function CeldasResumen({ r, conLista }: { r: Resumen; conLista?: boolean }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{r.datos}</TableCell>
      <TableCell className="text-right tabular-nums">{r.clientes}</TableCell>
      <TableCell className="text-right tabular-nums" title={quien(r.minimo)}>{precio(r.minimo.precio)}</TableCell>
      <TableCell className="text-right tabular-nums" title={quien(r.maximo)}>{precio(r.maximo.precio)}</TableCell>
      <TableCell className="text-right tabular-nums">{precio(r1(r.promedio))}</TableCell>
      <TableCell className="text-right tabular-nums">{precio(r1(r.mediana))}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{precio(r1(r.nuestroPromedio))}</TableCell>
      {conLista && <TableCell className="text-right tabular-nums text-muted-foreground">{precio(r.lista)}</TableCell>}
      <TableCell className="text-right"><Dif v={r.difPromedio} /></TableCell>
    </>
  )
}

// ======================================================================
// Competidores y sus productos (vinculados a nuestro SKU)
// ======================================================================

const NUEVO = '__nuevo'

function Productos({ competidores, productos, skus, filas, esAdmin, recargar }: {
  competidores: Competidor[]; productos: ProductoCompetencia[]; skus: Sku[]; filas: PrecioCompetencia[]; esAdmin: boolean; recargar: () => Promise<void>
}) {
  const [form, setForm] = useState({ competidor: '', nuevoCompetidor: '', nombre: '', sku: '', obs: '' })
  const [filtro, setFiltro] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const usos = useMemo(() => {
    const m = new Map<number, number>()
    for (const f of filas) m.set(f.producto_id, (m.get(f.producto_id) ?? 0) + 1)
    return m
  }, [filas])
  const opcionesSku = useMemo(() => skus.filter((s) => s.estado !== 'DESCONTINUADO').map((s) => ({ value: String(s.sku), label: s.descripcion, detalle: String(s.sku) })), [skus])
  const descSku = useMemo(() => new Map(skus.map((s) => [s.sku, s.descripcion])), [skus])

  async function agregar(e: FormEvent) {
    e.preventDefault()
    setAviso(null)
    let competidorId = Number(form.competidor)
    if (form.competidor === NUEVO) {
      const nombre = form.nuevoCompetidor.trim()
      if (!nombre) return setError('Escribí el nombre del competidor nuevo.')
      const existente = competidores.find((c) => c.nombre.trim().toLowerCase() === nombre.toLowerCase())
      if (existente) competidorId = existente.id
      else {
        const { data, error } = await supabase.from('competidores').insert({ nombre }).select('id').single()
        if (error) return setError(traducir(error))
        competidorId = data.id
      }
    }
    if (!competidorId) return setError('Elegí el competidor.')
    if (!form.nombre.trim()) return setError('Escribí el nombre del producto como lo llama el competidor.')
    if (!form.sku) return setError('Elegí nuestro SKU equivalente.')
    const { error } = await supabase.from('productos_competencia').insert({
      competidor_id: competidorId, nombre: form.nombre.trim(), sku: Number(form.sku), observaciones: form.obs.trim() || null,
    })
    if (error) return setError(traducir(error))
    setError(null)
    setAviso(`${form.nombre.trim()} agregado.`)
    setForm({ competidor: String(competidorId), nuevoCompetidor: '', nombre: '', sku: '', obs: '' })
    await recargar()
  }

  const nombreCompetidor = new Map(competidores.map((c) => [c.id, c.nombre]))
  const f = filtro.trim().toLowerCase()
  const lista = productos
    .filter((p) => !f || `${nombreCompetidor.get(p.competidor_id)} ${p.nombre} ${p.sku} ${descSku.get(p.sku) ?? ''}`.toLowerCase().includes(f))
    .sort((a, b) => (nombreCompetidor.get(a.competidor_id) ?? '').localeCompare(nombreCompetidor.get(b.competidor_id) ?? '') || a.nombre.localeCompare(b.nombre))

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        Cada producto de la competencia se carga una vez, con el nombre que usa el competidor, y se vincula a nuestro SKU equivalente.
        Varios productos (de distintos competidores o con distintos nombres) pueden apuntar al mismo SKU nuestro.
        Cualquiera puede agregar; corregir o borrar, solo el administrador.
      </p>

      <form onSubmit={agregar} className="flex flex-wrap items-end gap-3 rounded-lg border bg-background p-4">
        <div className="grid gap-1">
          <Label htmlFor="prod-comp" className="text-xs">Competidor</Label>
          <Select id="prod-comp" className="w-48" value={form.competidor} onChange={(e) => setForm({ ...form, competidor: e.target.value })}>
            <option value="">Elegir…</option>
            {competidores.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            <option value={NUEVO}>+ Competidor nuevo…</option>
          </Select>
        </div>
        {form.competidor === NUEVO && (
          <div className="grid gap-1">
            <Label htmlFor="prod-comp-nuevo" className="text-xs">Nombre del competidor</Label>
            <Input id="prod-comp-nuevo" className="w-48" value={form.nuevoCompetidor} onChange={(e) => setForm({ ...form, nuevoCompetidor: e.target.value })} />
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor="prod-nombre" className="text-xs">Su producto (como lo llama él)</Label>
          <Input id="prod-nombre" className="w-64" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="prod-sku" className="text-xs">Nuestro SKU equivalente</Label>
          <Combobox id="prod-sku" className="w-80" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} opciones={opcionesSku} placeholder="Número o descripción…" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="prod-obs" className="text-xs">Observaciones</Label>
          <Input id="prod-obs" className="w-48" value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} />
        </div>
        <Button type="submit"><Plus /> Agregar producto</Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {aviso && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto font-medium">Productos de la competencia ({productos.length})</h2>
          <Input className="w-72" placeholder="Buscar competidor, producto o SKU…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Competidor</TableHead><TableHead>Su producto</TableHead><TableHead>Nuestro SKU equivalente</TableHead>
            <TableHead>Observaciones</TableHead><TableHead className="text-right">Precios</TableHead><TableHead>Activo</TableHead>
            {esAdmin && <TableHead />}
          </TableRow></TableHeader>
          <TableBody>
            {lista.map((p) => (
              <FilaProducto key={`${p.id}-${p.nombre}-${p.sku}-${p.activo}-${p.observaciones}`} p={p} competidor={nombreCompetidor.get(p.competidor_id) ?? ''}
                usos={usos.get(p.id) ?? 0} opcionesSku={opcionesSku} descSku={descSku} esAdmin={esAdmin} recargar={recargar} onError={setError} />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2">
        <h2 className="font-medium">Competidores ({competidores.length})</h2>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead className="text-right">Productos</TableHead><TableHead>Activo</TableHead>{esAdmin && <TableHead />}
          </TableRow></TableHeader>
          <TableBody>
            {competidores.map((c) => (
              <FilaCompetidor key={`${c.id}-${c.nombre}-${c.activo}`} c={c} productos={productos.filter((p) => p.competidor_id === c.id).length}
                esAdmin={esAdmin} recargar={recargar} onError={setError} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function FilaProducto({ p, competidor, usos, opcionesSku, descSku, esAdmin, recargar, onError }: {
  p: ProductoCompetencia; competidor: string; usos: number; opcionesSku: { value: string; label: string; detalle?: string }[]
  descSku: Map<number, string>; esAdmin: boolean; recargar: () => Promise<void>; onError: (m: string | null) => void
}) {
  const [nombre, setNombre] = useState(p.nombre)
  const [sku, setSku] = useState(String(p.sku))
  const [obs, setObs] = useState(p.observaciones ?? '')
  const [activo, setActivo] = useState(p.activo)
  const cambio = nombre !== p.nombre || sku !== String(p.sku) || obs !== (p.observaciones ?? '') || activo !== p.activo

  async function guardar() {
    if (!nombre.trim() || !sku) return onError('Falta el nombre o el SKU.')
    if (sku !== String(p.sku) && usos > 0 && !window.confirm(
      `Vas a cambiar el SKU equivalente de ${p.nombre}. Sus ${usos} precio(s) ya cargados pasan a compararse con el SKU ${sku}.`)) return
    const { error } = await supabase.from('productos_competencia')
      .update({ nombre: nombre.trim(), sku: Number(sku), observaciones: obs.trim() || null, activo }).eq('id', p.id)
    if (error) return onError(traducir(error))
    onError(null)
    await recargar()
  }
  async function borrar() {
    if (!window.confirm(`¿Borrar ${competidor} · ${p.nombre}?`)) return
    const { error } = await supabase.from('productos_competencia').delete().eq('id', p.id)
    if (error) return onError(traducir(error))
    onError(null)
    await recargar()
  }

  if (!esAdmin) {
    return (
      <TableRow className={cn(!p.activo && 'text-muted-foreground')}>
        <TableCell>{competidor}</TableCell><TableCell>{p.nombre}</TableCell>
        <TableCell><span className="font-mono text-xs">{p.sku}</span> <span className="text-sm text-muted-foreground">{descSku.get(p.sku)}</span></TableCell>
        <TableCell className="text-sm text-muted-foreground">{p.observaciones}</TableCell>
        <TableCell className="text-right tabular-nums">{usos}</TableCell>
        <TableCell>{p.activo ? 'Sí' : 'No'}</TableCell>
      </TableRow>
    )
  }
  return (
    <TableRow className={cn(!activo && 'text-muted-foreground')}>
      <TableCell>{competidor}</TableCell>
      <TableCell><Input className="h-8 w-56" aria-label={`Nombre ${p.nombre}`} value={nombre} onChange={(e) => setNombre(e.target.value)} /></TableCell>
      <TableCell><Combobox className="w-72" value={sku} onChange={setSku} opciones={opcionesSku} /></TableCell>
      <TableCell><Input className="h-8 w-44" aria-label={`Observaciones ${p.nombre}`} value={obs} onChange={(e) => setObs(e.target.value)} /></TableCell>
      <TableCell className="text-right tabular-nums">{usos}</TableCell>
      <TableCell><input type="checkbox" aria-label={`Activo ${p.nombre}`} checked={activo} onChange={(e) => setActivo(e.target.checked)} /></TableCell>
      <TableCell className="whitespace-nowrap">
        {cambio && <Button size="sm" onClick={guardar}>Guardar</Button>}
        <Button size="sm" variant="ghost" disabled={usos > 0} title={usos > 0 ? 'Tiene precios cargados: desactivalo en su lugar' : 'Borrar'} aria-label={`Borrar ${p.nombre}`} onClick={borrar}><Trash2 /></Button>
      </TableCell>
    </TableRow>
  )
}

function FilaCompetidor({ c, productos, esAdmin, recargar, onError }: {
  c: Competidor; productos: number; esAdmin: boolean; recargar: () => Promise<void>; onError: (m: string | null) => void
}) {
  const [nombre, setNombre] = useState(c.nombre)
  const [activo, setActivo] = useState(c.activo)
  const cambio = nombre !== c.nombre || activo !== c.activo

  async function guardar() {
    if (!nombre.trim()) return onError('Falta el nombre.')
    const { error } = await supabase.from('competidores').update({ nombre: nombre.trim(), activo }).eq('id', c.id)
    if (error) return onError(traducir(error))
    onError(null)
    await recargar()
  }
  async function borrar() {
    if (!window.confirm(`¿Borrar el competidor ${c.nombre}?`)) return
    const { error } = await supabase.from('competidores').delete().eq('id', c.id)
    if (error) return onError(traducir(error))
    onError(null)
    await recargar()
  }

  if (!esAdmin) {
    return (
      <TableRow className={cn(!c.activo && 'text-muted-foreground')}>
        <TableCell>{c.nombre}</TableCell><TableCell className="text-right tabular-nums">{productos}</TableCell><TableCell>{c.activo ? 'Sí' : 'No'}</TableCell>
      </TableRow>
    )
  }
  return (
    <TableRow className={cn(!activo && 'text-muted-foreground')}>
      <TableCell><Input className="h-8 w-56" aria-label={`Nombre ${c.nombre}`} value={nombre} onChange={(e) => setNombre(e.target.value)} /></TableCell>
      <TableCell className="text-right tabular-nums">{productos}</TableCell>
      <TableCell><input type="checkbox" aria-label={`Activo ${c.nombre}`} checked={activo} onChange={(e) => setActivo(e.target.checked)} /></TableCell>
      <TableCell className="whitespace-nowrap">
        {cambio && <Button size="sm" onClick={guardar}>Guardar</Button>}
        <Button size="sm" variant="ghost" disabled={productos > 0} title={productos > 0 ? 'Tiene productos: desactivalo en su lugar' : 'Borrar'} aria-label={`Borrar ${c.nombre}`} onClick={borrar}><Trash2 /></Button>
      </TableCell>
    </TableRow>
  )
}
