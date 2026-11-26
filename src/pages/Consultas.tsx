import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownUp, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { grillasActivas, mensajeError, preciosDeClientes, traerTodo } from '@/lib/datos'
import { aInputMes, nombreMes, pct, precio } from '@/lib/formato'
import { exportarExcel, mediana } from '@/lib/precios'
import { useNiveles } from '@/lib/niveles'
import { nombreModalidad, type IndiceCliente, type PrecioCliente, type PrecioDetalle, type Sku } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const PESTANAS = [
  { id: 'sku', texto: 'Por SKU' },
  { id: 'ranking', texto: 'Ranking de clientes' },
  { id: 'brecha', texto: 'Brecha contra la lista' },
  { id: 'ficha', texto: 'Ficha del cliente' },
  { id: 'envios', texto: 'Ajustes del mes' },
  { id: 'desactualizados', texto: 'Desactualizados' },
  { id: 'cobertura', texto: 'Cobertura' },
] as const
type Pestana = (typeof PESTANAS)[number]['id']

const promedio = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const varPct = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a / b - 1) * 100 : null)
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10)
const mesesEntre = (desde: string, hasta: string) => {
  const [a1, m1] = desde.split('-').map(Number)
  const [a2, m2] = hasta.split('-').map(Number)
  return (a2 - a1) * 12 + (m2 - m1)
}

function Stat({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-background px-4 py-3">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="text-lg font-semibold tabular-nums">{valor}</div>
    </div>
  )
}

function BotonExportar({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" size="sm" onClick={onClick}><Download /> Exportar a Excel</Button>
}

export default function Consultas() {
  const { niveles, mayor } = useNiveles()
  const nombreMayor = mayor?.nombre ?? 'mayor descuento'
  const [pestana, setPestana] = useState<Pestana>('sku')
  const [meses, setMeses] = useState<string[]>([])
  const [mes, setMes] = useState('')
  const [modalidad, setModalidad] = useState('')
  const [nivel, setNivel] = useState('')
  const [detalle, setDetalle] = useState<PrecioDetalle[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [skuSel, setSkuSel] = useState('')
  const [orden, setOrden] = useState<'asc' | 'desc'>('desc')
  const [clienteSel, setClienteSel] = useState('')
  const [historial, setHistorial] = useState<PrecioCliente[]>([])
  const [indice, setIndice] = useState<IndiceCliente[]>([])
  const [grillas, setGrillas] = useState<{ cliente_id: number; sku: number }[]>([])
  const [error, setError] = useState<string | null>(null)

  // Meses con precios, SKUs, índice de clientes y mapa SKU × cliente.
  useEffect(() => {
    ;(async () => {
      try {
        const [m, s, i, g] = await Promise.all([
          supabase.from('precios_cliente').select('mes').order('mes', { ascending: false }).limit(1),
          supabase.from('skus').select('*').order('descripcion'),
          supabase.from('v_indice_clientes').select('*').order('nombre'),
          grillasActivas(),
        ])
        setSkus((s.data ?? []) as Sku[])
        setIndice((i.data ?? []) as IndiceCliente[])
        setGrillas(g)
        const ultimo = m.data?.[0]?.mes as string | undefined
        if (ultimo) {
          setMes(ultimo)
          // Lista de meses desde el primero cargado hasta el último.
          const pr = await supabase.from('precios_cliente').select('mes').order('mes').limit(1)
          const primero = (pr.data?.[0]?.mes as string) ?? ultimo
          const lista: string[] = []
          for (let x = primero; x <= ultimo; ) {
            lista.push(x)
            const [a, mm] = x.split('-').map(Number)
            x = new Date(Date.UTC(a, mm, 1)).toISOString().slice(0, 10)
          }
          setMeses(lista.reverse())
        }
      } catch (e) {
        setError(mensajeError(e))
      }
    })()
  }, [])

  // Detalle del mes elegido (todos los clientes, solo SKUs tildados).
  useEffect(() => {
    if (!mes) return
    traerTodo<PrecioDetalle>((d, h) => supabase.from('v_precios_detalle').select('*').eq('mes', mes).order('cliente_id').order('sku').range(d, h))
      .then((rows) => setDetalle(rows.map((r) => ({ ...r, precio: Number(r.precio), lista: r.lista == null ? null : Number(r.lista), matar: r.matar == null ? null : Number(r.matar), precio_minimo: r.precio_minimo == null ? null : Number(r.precio_minimo) }))))
      .catch((e) => setError(mensajeError(e)))
  }, [mes])

  // Historial de meses anteriores, solo cuando hace falta: en la ficha, del
  // cliente elegido; en desactualizados, de los clientes del filtro
  // (especiales, genéricos o todos).
  const idsHistorial = useMemo(() => {
    if (pestana === 'ficha') return clienteSel ? [Number(clienteSel)] : []
    if (pestana === 'desactualizados')
      return indice.filter((c) => c.activo && c.cotiza && (!modalidad || c.modalidad === modalidad) && (!nivel || c.nivel === nivel)).map((c) => c.id)
    return []
  }, [pestana, clienteSel, indice, modalidad, nivel])
  const claveHistorial = idsHistorial.join(',')
  const [historialDe, setHistorialDe] = useState<string | null>(null)
  useEffect(() => {
    if (!claveHistorial) return
    let vigente = true
    preciosDeClientes(claveHistorial.split(',').map(Number))
      .then((rows) => {
        if (!vigente) return
        setHistorial(rows.map((r) => ({ ...r, precio: Number(r.precio) })))
        setHistorialDe(claveHistorial)
      })
      .catch((e) => vigente && setError(mensajeError(e)))
    return () => { vigente = false }
  }, [claveHistorial])
  const historialListo = !claveHistorial || historialDe === claveHistorial

  // Al cambiar el grupo de clientes, ir al último mes con precios de ese grupo
  // (ej. los genéricos pueden tener un mes más nuevo que los especiales).
  const cambiarModalidad = (m: string) => {
    setModalidad(m)
    const ultimo = indice.filter((c) => c.activo && (!m || c.modalidad === m) && c.ultimo_mes)
      .reduce<string | null>((max, c) => (max == null || c.ultimo_mes! > max ? c.ultimo_mes : max), null)
    if (ultimo && meses.includes(ultimo)) setMes(ultimo)
  }
  const cuantos = (m: string) => indice.filter((c) => c.activo && c.modalidad === m).length

  const filtrado = useMemo(
    () => detalle.filter((d) => (!modalidad || d.modalidad === modalidad) && (!nivel || d.nivel === nivel)),
    [detalle, modalidad, nivel],
  )

  // Estadísticas por SKU (sobre el filtro elegido).
  const porSku = useMemo(() => {
    const m = new Map<number, PrecioDetalle[]>()
    for (const d of filtrado) m.set(d.sku, [...(m.get(d.sku) ?? []), d])
    return [...m.entries()]
      .map(([sku, filas]) => {
        const v = filas.map((f) => f.precio)
        return {
          sku, descripcion: filas[0].descripcion, filas, clientes: v.length,
          minimo: Math.min(...v), maximo: Math.max(...v), promedio: promedio(v)!, mediana: mediana(v)!,
          lista: filas[0].lista, piso: filas[0].precio_minimo,
        }
      })
      .sort((a, b) => a.descripcion.localeCompare(b.descripcion))
  }, [filtrado])
  const promedioSku = useMemo(() => new Map(porSku.map((s) => [s.sku, s.promedio])), [porSku])

  const titulo = `${modalidad === 'ESPECIAL' ? 'especiales' : modalidad === 'GENERICO' ? 'genéricos' : 'todos'}${nivel ? ` ${nivel}` : ''} · ${mes ? nombreMes(mes) : ''}`

  if (error) return <p className="text-destructive">{error}</p>

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold">Consultas</h1>
        <div className="grid gap-1">
          <Label htmlFor="mes" className="text-xs">Mes</Label>
          <Select id="mes" className="w-36" value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="mod" className="text-xs">Clientes</Label>
          <Select id="mod" className="w-44" value={modalidad} onChange={(e) => cambiarModalidad(e.target.value)}>
            <option value="">Todos</option>
            <option value="ESPECIAL">Especiales ({cuantos('ESPECIAL')})</option>
            <option value="GENERICO">Genéricos ({cuantos('GENERICO')})</option>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="niv" className="text-xs">Nivel</Label>
          <Select id="niv" className="w-36" value={nivel} onChange={(e) => setNivel(e.target.value)}>
            <option value="">Todos</option>
            {niveles.map((n) => <option key={n.nombre}>{n.nombre}</option>)}
          </Select>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-b">
        {PESTANAS.map((p) => (
          <button key={p.id} onClick={() => setPestana(p.id)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', pestana === p.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {p.texto}
          </button>
        ))}
      </nav>

      {!mes && <p className="text-muted-foreground">Todavía no hay precios cargados.</p>}

      {mes && pestana === 'sku' && (() => {
        const sel = porSku.find((s) => String(s.sku) === skuSel)
        if (!sel) {
          return (
            <div className="grid gap-3">
              <div className="flex items-center gap-3">
                <p className="mr-auto text-sm text-muted-foreground">Resumen de cada SKU ({titulo}). Hacé click en un SKU para ver el precio de cada cliente.</p>
                <BotonExportar onClick={() => exportarExcel(`resumen_skus_${aInputMes(mes)}`, ['SKU', 'Producto', 'Clientes', 'Mínimo', 'Máximo', 'Promedio', 'Mediana', 'Lista', 'Precio mínimo (piso)'],
                  porSku.map((s) => [s.sku, s.descripcion, s.clientes, s.minimo, s.maximo, r1(s.promedio), r1(s.mediana), s.lista, s.piso]))} />
              </div>
              <Table fija>
                <TableHeader><TableRow>
                  <TableHead>SKU</TableHead><TableHead>Producto</TableHead><TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead><TableHead className="text-right">Máximo</TableHead>
                  <TableHead className="text-right">Promedio</TableHead><TableHead className="text-right">Mediana</TableHead>
                  <TableHead className="text-right">Lista</TableHead><TableHead className="text-right">Piso</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {porSku.map((s) => (
                    <TableRow key={s.sku} className="cursor-pointer" onClick={() => setSkuSel(String(s.sku))}>
                      <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                      <TableCell className="text-primary">{s.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.clientes}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', s.piso != null && s.minimo < s.piso && 'font-medium text-red-700')}>{precio(s.minimo)}</TableCell>
                      <TableCell className="text-right tabular-nums">{precio(s.maximo)}</TableCell>
                      <TableCell className="text-right tabular-nums">{precio(r1(s.promedio))}</TableCell>
                      <TableCell className="text-right tabular-nums">{precio(r1(s.mediana))}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{precio(s.lista)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{precio(s.piso)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
        const filas = [...sel.filas].sort((a, b) => (orden === 'desc' ? b.precio - a.precio : a.precio - b.precio))
        return (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setSkuSel('')}>← Todos los SKUs</Button>
              <Combobox className="w-96" value={String(skuSel)} onChange={(v) => setSkuSel(v)} placeholder="Buscar SKU por número o producto…"
                opciones={porSku.map((s) => ({ value: String(s.sku), label: s.descripcion, detalle: String(s.sku) }))} />
              <Button variant="outline" size="sm" onClick={() => setOrden(orden === 'desc' ? 'asc' : 'desc')}>
                <ArrowDownUp /> {orden === 'desc' ? 'Mayor a menor' : 'Menor a mayor'}
              </Button>
              <div className="ml-auto"><BotonExportar onClick={() => exportarExcel(`sku_${sel.sku}_${aInputMes(mes)}`, ['Cliente', 'Código', 'Modalidad', 'Nivel', 'Precio', 'vs promedio %', 'vs lista %', 'Bajo el piso'],
                filas.map((f) => [f.cliente, f.nro_cliente, nombreModalidad(f.modalidad), f.nivel, f.precio, r1(varPct(f.precio, sel.promedio)), r1(varPct(f.precio, f.lista)), f.precio_minimo != null && f.precio < f.precio_minimo ? 'SÍ' : '']))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Stat titulo="Clientes" valor={String(sel.clientes)} />
              <Stat titulo="Mínimo" valor={precio(sel.minimo)} />
              <Stat titulo="Máximo" valor={precio(sel.maximo)} />
              <Stat titulo="Promedio" valor={precio(r1(sel.promedio))} />
              <Stat titulo="Mediana" valor={precio(r1(sel.mediana))} />
              <Stat titulo="Lista" valor={precio(sel.lista) || '—'} />
              <Stat titulo="Piso" valor={precio(sel.piso) || '—'} />
            </div>
            <Table fija>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>Cliente</TableHead><TableHead>Modalidad</TableHead><TableHead>Nivel</TableHead>
                <TableHead className="text-right">Precio</TableHead><TableHead className="text-right">vs promedio</TableHead><TableHead className="text-right">vs lista</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filas.map((f, i) => {
                  const bajo = f.precio_minimo != null && f.precio < f.precio_minimo
                  return (
                    <TableRow key={f.cliente_id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell><Link className="text-primary hover:underline" to={`/clientes/${f.cliente_id}`}>{f.cliente}</Link></TableCell>
                      <TableCell>{nombreModalidad(f.modalidad)}</TableCell>
                      <TableCell>{f.nivel ?? ''}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', bajo && 'font-medium text-red-700')}>{precio(f.precio)}{bajo && <Badge variant="baja" className="ml-2">bajo el piso</Badge>}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(varPct(f.precio, sel.promedio))}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(varPct(f.precio, f.lista))}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )
      })()}

      {mes && pestana === 'ranking' && (() => {
        const m = new Map<number, { cliente: string; modalidad: PrecioDetalle['modalidad']; nivel: string | null; difs: number[] }>()
        for (const d of filtrado) {
          const prom = promedioSku.get(d.sku)
          if (!prom) continue
          const x = m.get(d.cliente_id) ?? { cliente: d.cliente, modalidad: d.modalidad, nivel: d.nivel, difs: [] }
          x.difs.push((d.precio / prom - 1) * 100)
          m.set(d.cliente_id, x)
        }
        const filas = [...m.entries()].map(([id, x]) => ({ id, ...x, skus: x.difs.length, dif: promedio(x.difs)! })).sort((a, b) => a.dif - b.dif)
        return (
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <p className="mr-auto text-sm text-muted-foreground">Cuánto paga cada cliente, en promedio, frente al promedio de cada SKU ({titulo}). Arriba los más baratos.</p>
              <BotonExportar onClick={() => exportarExcel(`ranking_${aInputMes(mes)}`, ['Posición', 'Cliente', 'Modalidad', 'Nivel', 'SKUs', 'vs promedio %'], filas.map((f, i) => [i + 1, f.cliente, nombreModalidad(f.modalidad), f.nivel, f.skus, r1(f.dif)]))} />
            </div>
            <Table fija>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Cliente</TableHead><TableHead>Modalidad</TableHead><TableHead>Nivel</TableHead><TableHead className="text-right">SKUs</TableHead><TableHead className="text-right">vs promedio</TableHead></TableRow></TableHeader>
              <TableBody>
                {filas.map((f, i) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell><Link className="text-primary hover:underline" to={`/clientes/${f.id}`}>{f.cliente}</Link></TableCell>
                    <TableCell>{nombreModalidad(f.modalidad)}</TableCell>
                    <TableCell>{f.nivel ?? ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.skus}</TableCell>
                    <TableCell className="text-right"><Badge variant={f.dif < 0 ? 'baja' : 'outline'}>{pct(f.dif)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      })()}

      {mes && pestana === 'brecha' && (() => {
        const filas = filtrado.filter((d) => d.lista != null)
          .map((d) => ({ ...d, vsLista: varPct(d.precio, d.lista)!, vsMatar: varPct(d.precio, d.matar), bajo: d.precio_minimo != null && d.precio < d.precio_minimo }))
          .sort((a, b) => (orden === 'desc' ? a.vsLista - b.vsLista : b.vsLista - a.vsLista))
        return (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="mr-auto text-sm text-muted-foreground">Precio de cada cliente frente a la lista general y a {nombreMayor} del mes ({titulo}).</p>
              <Button variant="outline" size="sm" onClick={() => setOrden(orden === 'desc' ? 'asc' : 'desc')}><ArrowDownUp /> {orden === 'desc' ? 'Mayor descuento primero' : 'Menor descuento primero'}</Button>
              <BotonExportar onClick={() => exportarExcel(`brecha_lista_${aInputMes(mes)}`, ['Cliente', 'SKU', 'Producto', 'Precio', 'Lista', 'vs lista %', nombreMayor, `vs ${nombreMayor} %`, 'Piso', 'Bajo el piso'],
                filas.map((f) => [f.cliente, f.sku, f.descripcion, f.precio, f.lista, r1(f.vsLista), f.matar, r1(f.vsMatar), f.precio_minimo, f.bajo ? 'SÍ' : '']))} />
            </div>
            <Table fija>
              <TableHeader><TableRow>
                <TableHead>Cliente</TableHead><TableHead>SKU</TableHead><TableHead>Producto</TableHead>
                <TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Lista</TableHead><TableHead className="text-right">vs lista</TableHead>
                <TableHead className="text-right">{mayor?.nombre ?? 'Mayor descuento'}</TableHead><TableHead className="text-right">vs {mayor?.nombre ?? 'mayor descuento'}</TableHead><TableHead className="text-right">Piso</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={`${f.cliente_id}-${f.sku}`}>
                    <TableCell>{f.cliente}</TableCell>
                    <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                    <TableCell>{f.descripcion}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', f.bajo && 'font-medium text-red-700')}>{precio(f.precio)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.lista)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(f.vsLista)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.matar)}</TableCell>
                    <TableCell className="text-right"><Badge variant={f.vsMatar != null && f.vsMatar < 0 ? 'baja' : 'outline'}>{pct(f.vsMatar)}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.precio_minimo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      })()}

      {mes && pestana === 'ficha' && (() => {
        const opciones = indice.filter((c) => !modalidad || c.modalidad === modalidad)
        const id = Number(clienteSel)
        const suyas = detalle.filter((d) => d.cliente_id === id)
        const hist = historial.filter((h) => h.cliente_id === id && h.mes < mes)
        const filas = suyas.map((d) => {
          const ant = hist.filter((h) => h.sku === d.sku).at(-1)
          const todos = detalle.filter((x) => x.sku === d.sku && (!modalidad || x.modalidad === modalidad)).map((x) => x.precio).sort((a, b) => a - b)
          return { ...d, anterior: ant?.precio ?? null, anteriorMes: ant?.mes ?? null, prom: promedio(todos), puesto: todos.indexOf(d.precio) + 1, de: todos.length }
        }).sort((a, b) => a.descripcion.localeCompare(b.descripcion))
        return (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Combobox className="w-96" value={String(clienteSel)} onChange={(v) => setClienteSel(v)} placeholder="Escribí parte del nombre o del código…"
                opciones={opciones.map((c) => ({ value: String(c.id), label: c.nombre, detalle: c.nro_cliente ?? undefined }))} />
              {clienteSel && <Link className="text-sm text-primary hover:underline" to={`/clientes/${clienteSel}`}>Ver historial completo</Link>}
              {filas.length > 0 && <div className="ml-auto"><BotonExportar onClick={() => exportarExcel(`ficha_${clienteSel}_${aInputMes(mes)}`, ['SKU', 'Producto', 'Precio', 'Anterior', 'Variación %', 'Promedio', 'vs promedio %', 'Puesto (1 = más barato)', 'De'],
                filas.map((f) => [f.sku, f.descripcion, f.precio, f.anterior, r1(varPct(f.precio, f.anterior)), r1(f.prom), r1(varPct(f.precio, f.prom)), f.puesto, f.de]))} /></div>}
            </div>
            {clienteSel && !historialListo && <p className="text-sm text-muted-foreground">Cargando meses anteriores…</p>}
            {clienteSel && !filas.length && <p className="text-sm text-muted-foreground">Este cliente no tiene precios en {nombreMes(mes)}.</p>}
            {filas.length > 0 && (
              <Table fija>
                <TableHeader><TableRow>
                  <TableHead>SKU</TableHead><TableHead>Producto</TableHead><TableHead className="text-right">{nombreMes(mes)}</TableHead>
                  <TableHead className="text-right">Anterior</TableHead><TableHead className="text-right">Variación</TableHead>
                  <TableHead className="text-right">Promedio</TableHead><TableHead className="text-right">vs promedio</TableHead><TableHead className="text-right">Puesto</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filas.map((f) => (
                    <TableRow key={f.sku}>
                      <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                      <TableCell>{f.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums">{precio(f.precio)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.anterior)}{f.anteriorMes && <span className="ml-1 text-xs">{nombreMes(f.anteriorMes)}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(varPct(f.precio, f.anterior))}</TableCell>
                      <TableCell className="text-right tabular-nums">{precio(r1(f.prom))}</TableCell>
                      <TableCell className="text-right"><Badge variant={(varPct(f.precio, f.prom) ?? 0) < 0 ? 'baja' : 'outline'}>{pct(varPct(f.precio, f.prom))}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{f.puesto} de {f.de}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )
      })()}

      {mes && pestana === 'envios' && (() => {
        const conPrecio = new Map<number, number>()
        for (const d of detalle) conPrecio.set(d.cliente_id, (conPrecio.get(d.cliente_id) ?? 0) + 1)
        const filas = indice.filter((c) => c.activo && c.cotiza && (!modalidad || c.modalidad === modalidad) && (!nivel || c.nivel === nivel))
          .map((c) => ({ ...c, conPrecio: conPrecio.get(c.id) ?? 0 }))
          .sort((a, b) => Number(a.conPrecio > 0) - Number(b.conPrecio > 0) || a.nombre.localeCompare(b.nombre))
        const faltan = filas.filter((f) => f.conPrecio === 0).length
        return (
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <p className="mr-auto text-sm text-muted-foreground">{filas.length - faltan} cliente(s) con precios de {nombreMes(mes)} y <span className="font-medium text-red-700">{faltan} sin precios</span> ({titulo}).</p>
              <BotonExportar onClick={() => exportarExcel(`ajustes_${aInputMes(mes)}`, ['Cliente', 'Código', 'Modalidad', 'SKUs tildados', `SKUs con precio ${nombreMes(mes)}`, 'Estado'],
                filas.map((f) => [f.nombre, f.nro_cliente, nombreModalidad(f.modalidad), f.skus_activos, f.conPrecio, f.conPrecio ? (f.conPrecio < f.skus_activos ? 'Incompleto' : 'Enviado') : 'Falta']))} />
            </div>
            <Table fija>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Modalidad</TableHead><TableHead className="text-right">SKUs tildados</TableHead><TableHead className="text-right">Con precio</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell><Link className="text-primary hover:underline" to={`/clientes/${f.id}`}>{f.nombre}</Link></TableCell>
                    <TableCell>{nombreModalidad(f.modalidad)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.skus_activos}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.conPrecio}</TableCell>
                    <TableCell>{f.conPrecio === 0 ? <Badge variant="baja">Falta</Badge> : f.conPrecio < f.skus_activos ? <Badge variant="alerta">Incompleto</Badge> : <Badge variant="outline">Enviado</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      })()}

      {mes && pestana === 'desactualizados' && (() => {
        const UMBRAL = 2
        if (!historialListo) return <p className="text-sm text-muted-foreground">Cargando historial…</p>
        const filas = indice.filter((c) => c.activo && c.cotiza && (!modalidad || c.modalidad === modalidad) && (!nivel || c.nivel === nivel)).map((c) => {
          const h = historial.filter((x) => x.cliente_id === c.id && x.mes <= mes)
          let ultimoCambio = null as string | null
          const previo = new Map<number, number>()
          for (const x of h) {
            const ant = previo.get(x.sku)
            if ((ant == null || ant !== x.precio) && (ultimoCambio == null || x.mes > ultimoCambio)) ultimoCambio = x.mes
            previo.set(x.sku, x.precio)
          }
          return { ...c, ultimoCambio, meses: ultimoCambio ? mesesEntre(ultimoCambio, mes) : null }
        }).filter((f) => f.meses == null || f.meses >= UMBRAL).sort((a, b) => (b.meses ?? 99) - (a.meses ?? 99))
        return (
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <p className="mr-auto text-sm text-muted-foreground">Clientes sin cambios de precio hace {UMBRAL} meses o más ({titulo}).{modalidad !== 'ESPECIAL' && ' En los genéricos el precio cambia cuando se publica una lista general nueva.'}</p>
              <BotonExportar onClick={() => exportarExcel(`desactualizados_${aInputMes(mes)}`, ['Cliente', 'Código', 'Modalidad', 'Nivel', 'Último cambio', 'Meses sin cambios'], filas.map((f) => [f.nombre, f.nro_cliente, nombreModalidad(f.modalidad), f.nivel, f.ultimoCambio ? nombreMes(f.ultimoCambio) : 'Sin precios', f.meses]))} />
            </div>
            {!filas.length && <p className="text-sm text-muted-foreground">Ninguno: todos los clientes del filtro tuvieron cambios en los últimos {UMBRAL} meses.</p>}
            {filas.length > 0 && (
              <Table fija>
                <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Modalidad</TableHead><TableHead>Nivel</TableHead><TableHead>Último cambio</TableHead><TableHead className="text-right">Meses sin cambios</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filas.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell><Link className="text-primary hover:underline" to={`/clientes/${f.id}`}>{f.nombre}</Link></TableCell>
                      <TableCell>{nombreModalidad(f.modalidad)}</TableCell>
                      <TableCell>{f.nivel ?? ''}</TableCell>
                      <TableCell>{f.ultimoCambio ? nombreMes(f.ultimoCambio) : 'Sin precios'}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.meses ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )
      })()}

      {pestana === 'cobertura' && (() => {
        const porCliente = new Map(indice.map((c) => [c.id, c]))
        const filas = skus.filter((s) => s.estado === 'ACTIVO').map((s) => {
          const g = grillas.filter((x) => x.sku === s.sku).map((x) => porCliente.get(x.cliente_id)).filter((c) => c && c.activo && c.cotiza)
          return { ...s, genericos: g.filter((c) => c!.modalidad === 'GENERICO').length, especiales: g.filter((c) => c!.modalidad === 'ESPECIAL').length }
        }).sort((a, b) => a.genericos + a.especiales - (b.genericos + b.especiales))
        const nadie = filas.filter((f) => f.genericos + f.especiales === 0).length
        return (
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <p className="mr-auto text-sm text-muted-foreground">Cuántos clientes tienen tildado cada SKU activo. {nadie > 0 ? <span className="font-medium text-red-700">{nadie} SKU(s) no los cotiza nadie.</span> : 'Todos los SKUs se cotizan a alguien.'}</p>
              <BotonExportar onClick={() => exportarExcel('cobertura_skus', ['SKU', 'Producto', 'Genéricos', 'Especiales', 'Total'], filas.map((f) => [f.sku, f.descripcion, f.genericos, f.especiales, f.genericos + f.especiales]))} />
            </div>
            <Table fija>
              <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Producto</TableHead><TableHead className="text-right">Genéricos</TableHead><TableHead className="text-right">Especiales</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.sku} className={f.genericos + f.especiales === 0 ? 'bg-red-50' : ''}>
                    <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                    <TableCell>{f.descripcion}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.genericos}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.especiales}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{f.genericos + f.especiales}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      })()}
    </div>
  )
}
