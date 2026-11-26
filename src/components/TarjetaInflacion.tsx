import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError, preciosDeClientes, traerTodo } from '@/lib/datos'
import { nombreMes, pct } from '@/lib/formato'
import { useUsuarios } from '@/lib/usuarios'
import type { Modalidad, PrecioCliente } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { COLOR, GraficoAcumulado, Leyenda, type SerieAcumulada } from '@/components/graficos'

const restarMeses = (iso: string, n: number) => {
  const [a, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 - n, 1)).toISOString().slice(0, 10)
}
const aTexto = (n: number) => String(n).replace('.', ',')
/** IPC Nivel General Nacional (INDEC), variación % mensual, API pública de series de tiempo. */
const SERIE_IPC_URL = 'https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&representation_mode=percent_change&format=json&limit=1000'

/** Aumento real: cuánto subió por encima (o por debajo) de la inflación. */
const real = (aumento: number, inflacion: number) => ((1 + aumento / 100) / (1 + inflacion / 100) - 1) * 100

type FilaSku = { mes: string; cliente_id: number; precio: number; lista: number | null; modalidad: Modalidad }

interface Props {
  /** Último mes del gráfico (el mes del tablero). */
  mes: string
  /** SKUs para elegir (los que tienen precios en el mes). */
  skus: { sku: number; descripcion: string }[]
  skuInicial: string
  /** Clientes del alcance (Mis clientes / Todos). */
  clientes: { id: number; nombre: string }[]
  /** Especiales / Genéricos / '' = todos, como el filtro de precios por SKU. */
  grupo: string
}

/** Aumento acumulado de un SKU (lista y lo que pagan los clientes) y, si se
 *  elige, de un cliente, contra la inflación (IPC) cargada a mano (0016). */
export default function TarjetaInflacion({ mes, skus, skuInicial, clientes, grupo }: Props) {
  const { esAdmin } = useUsuarios()
  const [meses, setMeses] = useState(12)
  const [sku, setSku] = useState('')
  const skuSel = sku || skuInicial
  const [clienteSel, setClienteSel] = useState('')
  const [ipc, setIpc] = useState<Map<string, number>>(new Map())
  const [sinTabla, setSinTabla] = useState(false)
  const [filasSku, setFilasSku] = useState<FilaSku[]>([])
  const [filasCliente, setFilasCliente] = useState<PrecioCliente[]>([])
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)

  const ventana = useMemo(() => Array.from({ length: meses }, (_, i) => restarMeses(mes, meses - 1 - i)), [mes, meses])
  const desde = ventana[0]

  async function cargarIpc() {
    const { data, error } = await supabase.from('inflacion').select('mes, ipc_pct').order('mes')
    if (error) { setSinTabla(true); return }
    setSinTabla(false)
    setIpc(new Map((data ?? []).map((r) => [r.mes as string, Number(r.ipc_pct)])))
  }
  useEffect(() => { cargarIpc() }, [])

  useEffect(() => {
    if (!skuSel) return
    let vigente = true
    // Desde un año antes de la ventana, para saber el último precio de cada cliente al empezar.
    traerTodo<FilaSku>((d, h) => supabase.from('v_precios_detalle').select('mes, cliente_id, precio, lista, modalidad')
      .eq('sku', Number(skuSel)).lte('mes', mes).gte('mes', restarMeses(desde, 12)).order('mes').order('cliente_id').range(d, h))
      .then((r) => vigente && setFilasSku(r.map((x) => ({ ...x, precio: Number(x.precio), lista: x.lista == null ? null : Number(x.lista) }))))
      .catch((e) => vigente && setAviso({ ok: false, texto: mensajeError(e) }))
    return () => { vigente = false }
  }, [skuSel, mes, desde])

  useEffect(() => {
    if (!clienteSel) { setFilasCliente([]); return }
    let vigente = true
    preciosDeClientes([Number(clienteSel)])
      .then((r) => vigente && setFilasCliente(r.filter((p) => p.mes <= mes).map((p) => ({ ...p, precio: Number(p.precio) }))))
      .catch((e) => vigente && setAviso({ ok: false, texto: mensajeError(e) }))
    return () => { vigente = false }
  }, [clienteSel, mes])

  const idsAlcance = useMemo(() => new Set(clientes.map((c) => c.id)), [clientes])

  /** Para cada mes de la ventana, el último precio de cada clave (cliente o SKU) hasta ese mes. */
  function precioVigente<T extends { mes: string; precio: number }>(filas: T[], clave: (f: T) => string) {
    return ventana.map((m) => {
      const ult = new Map<string, number>()
      for (const f of filas) if (f.mes <= m) ult.set(clave(f), f.precio) // vienen ordenadas por mes
      return ult
    })
  }
  /** Promedio de (precio del mes / precio del mes base) − 1, solo de lo que tiene precio en ambos. */
  function acumulado(vigentes: Map<string, number>[], base: number) {
    return vigentes.map((v, i) => {
      if (i < base) return null
      const r: number[] = []
      for (const [k, p] of vigentes[base]) if (v.has(k) && p > 0) r.push(v.get(k)! / p)
      return r.length ? (r.reduce((a, b) => a + b, 0) / r.length - 1) * 100 : null
    })
  }

  const { series, base, resumen } = useMemo(() => {
    const delSku = filasSku.filter((f) => idsAlcance.has(f.cliente_id) && (!grupo || f.modalidad === grupo))
    const vigSku = precioVigente(delSku, (f) => String(f.cliente_id))
    const listaPorMes = ventana.map((m) => {
      const ult = filasSku.filter((f) => f.mes <= m && f.lista != null)
      return ult.length ? ult[ult.length - 1].lista : null
    })
    const vigCliente = precioVigente(filasCliente, (f) => String(f.sku))
    // Mes base: el primero de la ventana en que todas las series elegidas tienen precio.
    const primero = (ok: (i: number) => boolean) => ventana.findIndex((_, i) => ok(i))
    const bases = [primero((i) => vigSku[i].size > 0), primero((i) => listaPorMes[i] != null)]
    if (clienteSel) bases.push(primero((i) => vigCliente[i].size > 0))
    const base = bases.some((b) => b < 0) ? -1 : Math.max(...bases)
    if (base < 0) return { series: [], base, resumen: null }

    const inflacion = ventana.map((_, i) => {
      if (i < base) return null
      let f = 1
      for (let k = base + 1; k <= i; k++) {
        const v = ipc.get(ventana[k])
        if (v == null) return null
        f *= 1 + v / 100
      }
      return (f - 1) * 100
    })
    const lista = listaPorMes.map((l, i) => (i < base || l == null || !listaPorMes[base] ? null : (l / listaPorMes[base]! - 1) * 100))
    const nombreSku = skus.find((s) => String(s.sku) === skuSel)?.descripcion ?? 'SKU'
    const series: SerieAcumulada[] = [
      { nombre: 'Inflación (IPC)', color: '#191919', guiones: true, valores: inflacion },
      { nombre: `Lista · ${nombreSku}`, color: COLOR.azul, valores: lista },
      { nombre: `Clientes · ${nombreSku}`, color: COLOR.naranja, valores: acumulado(vigSku, base) },
    ]
    if (clienteSel) {
      const nombre = clientes.find((c) => String(c.id) === clienteSel)?.nombre ?? 'Cliente'
      series.push({ nombre: `${nombre} (todos sus SKUs)`, color: COLOR.aqua, valores: acumulado(vigCliente, base) })
    }
    // Se compara hasta el último mes con inflación cargada (el IPC sale a
    // mediados del mes siguiente); si no hay ninguno, hasta el final.
    let hasta = ventana.length - 1
    while (hasta > base && inflacion[hasta] == null) hasta--
    if (hasta === base) hasta = ventana.length - 1
    const inf = inflacion[hasta]
    const resumen = series.slice(1).map((s) => ({ nombre: s.nombre, valor: s.valores[hasta], real: s.valores[hasta] != null && inf != null ? real(s.valores[hasta]!, inf) : null }))
    return { series, base, resumen: { hasta: ventana[hasta], inflacion: inf, filas: resumen } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filasSku, filasCliente, ventana, ipc, idsAlcance, grupo, clienteSel, skuSel, skus, clientes])

  const ultimoIpc = [...ipc.keys()].reduce<string | null>((a, b) => (a == null || b > a ? b : a), null)
  const sinIpc = base >= 0 ? ventana.slice(base + 1).filter((m) => !ipc.has(m)) : []
  // Huecos (meses viejos sin cargar) y meses que todavía no se cargaron (los más nuevos).
  const faltanIpc = sinIpc.filter((m) => ultimoIpc != null && m < ultimoIpc)
  const pendientesIpc = sinIpc.filter((m) => ultimoIpc == null || m > ultimoIpc)

  /** Trae el IPC Nivel General Nacional del INDEC desde la API pública de
   *  series de tiempo (datos.gob.ar). Solo se envía el id de la serie. */
  async function traerIndec() {
    setGuardando(true)
    setAviso(null)
    try {
      const url = `${SERIE_IPC_URL}&start_date=${restarMeses(mes, 36)}`
      const r = await fetch(url)
      if (!r.ok) throw new Error(`respuesta ${r.status}`)
      const j = (await r.json()) as { data?: [string, number | null][] }
      const filas = (j.data ?? [])
        .filter(([, v]) => v != null && Number.isFinite(v))
        .map(([m, v]) => ({ mes: m.slice(0, 7) + '-01', ipc_pct: Math.round(v! * 1000) / 10 }))
      if (!filas.length) throw new Error('la serie vino vacía')
      const { error } = await supabase.from('inflacion').upsert(filas, { onConflict: 'mes' })
      if (error) throw error
      const ultimo = filas[filas.length - 1]
      setAviso({ ok: true, texto: `Se trajeron ${filas.length} meses del INDEC (el último: ${nombreMes(ultimo.mes)}, ${aTexto(ultimo.ipc_pct)}%).` })
      cargarIpc()
    } catch (e) {
      setAviso({ ok: false, texto: `No se pudo traer el IPC del INDEC (${mensajeError(e)}). Podés cargarlo a mano.` })
    }
    setGuardando(false)
  }

  function abrirCarga() {
    setBorrador(Object.fromEntries(ventana.map((m) => [m, ipc.has(m) ? aTexto(ipc.get(m)!) : ''])))
    setEditando(true)
    setAviso(null)
  }
  async function guardarIpc() {
    const filas = Object.entries(borrador)
      .filter(([, t]) => t.trim() !== '')
      .map(([m, t]) => ({ mes: m, ipc_pct: Number(t.replace(',', '.')) }))
    if (filas.some((f) => !Number.isFinite(f.ipc_pct))) return setAviso({ ok: false, texto: 'Hay un valor que no es un número.' })
    const borrar = Object.entries(borrador).filter(([m, t]) => t.trim() === '' && ipc.has(m)).map(([m]) => m)
    setGuardando(true)
    const r1 = filas.length ? await supabase.from('inflacion').upsert(filas, { onConflict: 'mes' }) : { error: null }
    const r2 = borrar.length ? await supabase.from('inflacion').delete().in('mes', borrar) : { error: null }
    setGuardando(false)
    const error = r1.error ?? r2.error
    if (error) return setAviso({ ok: false, texto: mensajeError(error) })
    setAviso({ ok: true, texto: 'Inflación guardada.' })
    setEditando(false)
    cargarIpc()
  }

  return (
    <Card id="inflacion">
      <CardHeader className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle>Aumento acumulado vs. inflación</CardTitle>
          <CardDescription>
            Cuánto subieron los precios desde el mes inicial, comparado con la inflación del mismo período. Si la línea de precios queda por debajo de la de inflación, el precio perdió contra la inflación.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="inf-sku" className="text-xs">SKU</Label>
            <Select id="inf-sku" className="w-52" value={skuSel} onChange={(e) => setSku(e.target.value)}>
              {skus.map((s) => <option key={s.sku} value={s.sku}>{s.descripcion}</option>)}
            </Select>
          </div>
          <div className="grid w-60 gap-1">
            <Label htmlFor="inf-cli" className="text-xs">Cliente (opcional)</Label>
            <Combobox id="inf-cli" value={clienteSel} onChange={setClienteSel} placeholder="Escribí el nombre…"
              opciones={[{ value: '', label: '— Ninguno —' }, ...clientes.map((c) => ({ value: String(c.id), label: c.nombre }))]} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="inf-meses" className="text-xs">Período</Label>
            <Select id="inf-meses" className="w-32" value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
              <option value={24}>24 meses</option>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {sinTabla && (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Para comparar con la inflación hay que correr la migración <strong>0016_inflacion.sql</strong> en Supabase (SQL Editor). Mientras tanto se ven solo los aumentos.
          </p>
        )}
        {series.length > 0 && (
          <Leyenda items={series.map((s) => ({ color: s.color, nombre: s.nombre, forma: s.guiones ? 'guiones' : 'linea' }))} />
        )}
        <GraficoAcumulado meses={base >= 0 ? ventana.slice(base) : []} series={series.map((s) => ({ ...s, valores: s.valores.slice(Math.max(0, base)) }))} />
        {resumen && (
          <div className="grid gap-1 text-sm">
            <p>
              Desde <strong>{nombreMes(ventana[base])}</strong> hasta <strong>{nombreMes(resumen.hasta)}</strong>:{' '}
              inflación <strong>{resumen.inflacion == null ? 'sin datos' : pct(resumen.inflacion)}</strong>
              {resumen.filas.map((f) => (
                <span key={f.nombre}>
                  {' · '}{f.nombre.split(' · ')[0].replace(' (todos sus SKUs)', '')} <strong>{f.valor == null ? '–' : pct(f.valor)}</strong>
                  {f.real != null && (
                    <span className={f.real < -0.05 ? 'text-red-700' : 'text-green-700'}> ({f.real < -0.05 ? 'pierde' : 'gana'} {pct(Math.abs(f.real)).replace('+', '')} contra la inflación)</span>
                  )}
                </span>
              ))}
            </p>
            {!sinTabla && faltanIpc.length > 0 && (
              <p className="text-amber-800">
                Falta la inflación de {faltanIpc.map(nombreMes).join(', ')}.{' '}
                {esAdmin ? 'Tocá "Traer del INDEC" o cargala a mano.' : 'La carga el administrador.'}
              </p>
            )}
            {!sinTabla && pendientesIpc.length > 0 && (
              <p className="text-muted-foreground">
                Sin inflación cargada para {pendientesIpc.map(nombreMes).join(', ')}: el INDEC la publica a mediados del mes siguiente
                {esAdmin ? '; cuando salga, tocá "Traer del INDEC".' : '.'}
              </p>
            )}
          </div>
        )}
        {aviso && <p className={aviso.ok ? 'text-sm text-green-800' : 'text-sm text-red-800'}>{aviso.texto}</p>}
        {esAdmin && !sinTabla && !editando && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={traerIndec} disabled={guardando}>{guardando ? 'Trayendo…' : 'Traer del INDEC'}</Button>
            <Button variant="ghost" size="sm" onClick={abrirCarga}>Cargar a mano</Button>
          </div>
        )}
        {editando && (
          <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">
              IPC mensual en %, tal como lo publica el INDEC (variación contra el mes anterior), por ejemplo 2,7. Dejá vacío para borrar un mes.
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {ventana.map((m) => (
                <div key={m} className="grid gap-1">
                  <Label htmlFor={`ipc-${m}`} className="text-xs">{nombreMes(m)}</Label>
                  <Input id={`ipc-${m}`} inputMode="decimal" className="h-8 text-right tabular-nums" placeholder="%"
                    value={borrador[m] ?? ''} onChange={(e) => setBorrador({ ...borrador, [m]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={guardarIpc} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar inflación'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
