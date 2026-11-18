import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { grillasActivas, listasGenerales, mensajeError, preciosDeClientes } from '@/lib/datos'
import { aInputMes, desdeInputMes, mesActual, mesSiguiente, nombreMes, pct, precio, redondear, UMBRAL_AUMENTO_ATIPICO } from '@/lib/formato'
import { listaVigente } from '@/lib/precios'
import type { Cliente, ListaGeneral, Origen, PrecioCliente, Sku } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const TODOS = 'TODOS'
/** 297.26 -> '297,26' (como se escribe en Argentina) */
const aTexto = (n: number) => String(n).replace('.', ',')

interface Fila {
  clave: string
  cliente: Pick<Cliente, 'id' | 'nombre'>
  sku: number
  descripcion: string
  base: number | null // último precio antes del mes nuevo
  baseMes: string | null
  yaCargado: number | null // precio ya guardado en el mes nuevo
  lista: number | null // lista general vigente en el mes nuevo
  minimo: number | null // precio piso de la lista general
}

export default function EnvioMensual() {
  const [clientes, setClientes] = useState<Pick<Cliente, 'id' | 'nombre' | 'nro_cliente'>[]>([])
  const [skus, setSkus] = useState<Map<number, Sku>>(new Map())
  const [grillas, setGrillas] = useState<{ cliente_id: number; sku: number }[]>([])
  const [precios, setPrecios] = useState<PrecioCliente[]>([])
  const [seleccion, setSeleccion] = useState<string>('')
  const [mesNuevo, setMesNuevo] = useState<string>(mesActual())
  const [aumento, setAumento] = useState<string>('')
  const [nuevos, setNuevos] = useState<Record<string, string>>({})
  const [origenes, setOrigenes] = useState<Record<string, Origen>>({})
  const [listas, setListas] = useState<ListaGeneral[]>([])
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setCargando(true)
    try {
      // Solo clientes ESPECIALES que cotizan: los genéricos se actualizan con la lista general.
      const cli = await supabase.from('clientes').select('id, nombre, nro_cliente').eq('modalidad', 'ESPECIAL').eq('cotiza', true).eq('activo', true).order('nombre')
      if (cli.error) throw cli.error
      const ids = (cli.data ?? []).map((c) => c.id)
      const [sk, gr, pr, li] = await Promise.all([
        supabase.from('skus').select('*'),
        grillasActivas(ids),
        preciosDeClientes(ids),
        listasGenerales(),
      ])
      if (sk.error) throw sk.error
      setListas(li)
      setClientes(cli.data ?? [])
      setSkus(new Map((sk.data as Sku[]).map((s) => [s.sku, s])))
      setGrillas(gr)
      setPrecios(pr)
      // Mes sugerido: el siguiente al último cargado.
      const ultimo = pr.reduce<string | null>((m, p) => (m && m > p.mes ? m : p.mes), null)
      if (ultimo) setMesNuevo(mesSiguiente(ultimo))
    } catch (e) {
      setEstado({ tipo: 'error', texto: mensajeError(e) })
    }
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  const filas = useMemo<Fila[]>(() => {
    if (!seleccion) return []
    const ids = seleccion === TODOS ? clientes.map((c) => c.id) : [Number(seleccion)]
    const porCliente = new Map(clientes.map((c) => [c.id, c]))
    const historial = new Map<string, PrecioCliente[]>() // ya vienen ordenados por mes
    for (const p of precios) {
      const k = `${p.cliente_id}-${p.sku}`
      historial.set(k, [...(historial.get(k) ?? []), p])
    }
    const vigente = listaVigente(listas, mesNuevo)
    const salida: Fila[] = []
    for (const id of ids) {
      const cliente = porCliente.get(id)
      if (!cliente) continue
      const suyos = grillas.filter((g) => g.cliente_id === id).map((g) => g.sku)
      for (const sku of suyos) {
        const hist = historial.get(`${id}-${sku}`) ?? []
        const anteriores = hist.filter((p) => p.mes < mesNuevo)
        const ult = anteriores[anteriores.length - 1] ?? null
        const ya = hist.find((p) => p.mes === mesNuevo) ?? null
        salida.push({
          clave: `${id}-${sku}`,
          cliente,
          sku,
          descripcion: skus.get(sku)?.descripcion ?? '',
          base: ult ? Number(ult.precio) : null,
          baseMes: ult?.mes ?? null,
          yaCargado: ya ? Number(ya.precio) : null,
          lista: vigente.has(sku) ? Number(vigente.get(sku)!.precio) : null,
          minimo: vigente.get(sku)?.precio_minimo != null ? Number(vigente.get(sku)!.precio_minimo) : null,
        })
      }
    }
    return salida.sort((a, b) => a.cliente.nombre.localeCompare(b.cliente.nombre) || a.descripcion.localeCompare(b.descripcion))
  }, [seleccion, clientes, grillas, precios, skus, mesNuevo, listas])

  // Al cambiar cliente o mes, se muestra lo que ya esté cargado en ese mes.
  useEffect(() => {
    const ini: Record<string, string> = {}
    for (const f of filas) if (f.yaCargado != null) ini[f.clave] = aTexto(f.yaCargado)
    setNuevos(ini)
    setOrigenes({})
  }, [filas])

  function aplicarAumento() {
    const p = Number(aumento.replace(',', '.'))
    if (!Number.isFinite(p)) return
    const sig: Record<string, string> = { ...nuevos }
    const ori: Record<string, Origen> = { ...origenes }
    for (const f of filas) if (f.base != null) {
      sig[f.clave] = aTexto(redondear(f.base * (1 + p / 100), 1))
      ori[f.clave] = 'AUMENTO'
    }
    setNuevos(sig)
    setOrigenes(ori)
    setEstado(null)
  }

  function copiarBase() {
    const sig: Record<string, string> = { ...nuevos }
    const ori: Record<string, Origen> = { ...origenes }
    for (const f of filas) if (f.base != null) {
      sig[f.clave] = aTexto(f.base)
      ori[f.clave] = 'MANUAL'
    }
    setNuevos(sig)
    setOrigenes(ori)
  }

  const aGuardar = filas
    .map((f) => ({ f, v: Number((nuevos[f.clave] ?? '').replace(',', '.')) }))
    .filter(({ f, v }) => (nuevos[f.clave] ?? '').trim() !== '' && Number.isFinite(v) && v > 0 && v !== f.yaCargado)
  const invalidos = filas.filter((f) => {
    const t = (nuevos[f.clave] ?? '').trim()
    return t !== '' && !(Number(t.replace(',', '.')) > 0)
  })
  const bajoMin = filas.filter((f) => {
    const t = (nuevos[f.clave] ?? '').trim()
    const v = Number(t.replace(',', '.'))
    return f.minimo != null && t !== '' && v > 0 && v < f.minimo
  })
  const correcciones = aGuardar.filter(({ f }) => f.yaCargado != null).length

  async function guardar() {
    if (!aGuardar.length) return
    const msg =
      `Vas a guardar ${aGuardar.length} precio(s) para ${nombreMes(mesNuevo)}.` +
      (correcciones ? `\n\n${correcciones} ya tenían precio en ese mes: se corrigen y el valor anterior queda registrado.` : '') +
      '\n\n¿Continuar?'
    if (!window.confirm(msg)) return
    setGuardando(true)
    const { error } = await supabase.from('precios_cliente').upsert(
      aGuardar.map(({ f, v }) => ({ cliente_id: f.cliente.id, sku: f.sku, mes: mesNuevo, precio: v, origen: origenes[f.clave] ?? 'MANUAL' })),
      { onConflict: 'cliente_id,sku,mes' },
    )
    setGuardando(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeError(error) })
    setEstado({ tipo: 'ok', texto: `Se guardaron ${aGuardar.length} precio(s) de ${nombreMes(mesNuevo)}.` })
    // Solo los especiales de esta pantalla (no hace falta bajar los genéricos).
    setPrecios(await preciosDeClientes(clientes.map((c) => c.id)))
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Ajuste mensual</CardTitle>
          <CardDescription>
            Para clientes especiales (los genéricos se actualizan al publicar la lista general). Elegí un cliente o TODOS, el mes y, si querés, un % de aumento sobre el último precio. A la derecha tenés la lista general y el precio mínimo: si un precio queda por debajo del mínimo se marca en rojo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="cliente">Cliente</Label>
            <Combobox id="cliente" value={seleccion} onChange={setSeleccion} disabled={cargando}
              placeholder={cargando ? 'Cargando…' : 'Escribí parte del nombre o del código…'}
              opciones={[
                { value: TODOS, label: `TODOS los clientes especiales (${clientes.length})` },
                ...clientes.map((c) => ({ value: String(c.id), label: c.nombre, detalle: c.nro_cliente ?? undefined })),
              ]} />
            
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mes">Mes a cargar</Label>
            <Input id="mes" type="month" value={aInputMes(mesNuevo)} onChange={(e) => e.target.value && setMesNuevo(desdeInputMes(e.target.value))} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="aumento">% de aumento</Label>
            <Input id="aumento" inputMode="decimal" placeholder="ej. 4,5" value={aumento} onChange={(e) => setAumento(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={aplicarAumento} disabled={!filas.length || !aumento}>Aplicar %</Button>
            <Button variant="outline" onClick={copiarBase} disabled={!filas.length}>Copiar último</Button>
          </div>
        </CardContent>
      </Card>

      {estado && (
        <p className={estado.tipo === 'ok' ? 'rounded-md bg-green-50 p-3 text-sm text-green-800' : 'rounded-md bg-red-50 p-3 text-sm text-red-800'}>
          {estado.texto}
        </p>
      )}

      {seleccion && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {filas.length} SKU(s) · {aGuardar.length} para guardar en {nombreMes(mesNuevo)}
              {correcciones > 0 && ` · ${correcciones} corrección(es)`}
              {invalidos.length > 0 && ` · ${invalidos.length} valor(es) inválido(s)`}
              {bajoMin.length > 0 && <span className="font-medium text-red-700">{` · ${bajoMin.length} por debajo del mínimo`}</span>}
            </p>
            <Button className="ml-auto" onClick={guardar} disabled={guardando || !aGuardar.length || invalidos.length > 0}>
              {guardando ? 'Guardando…' : `Guardar ${nombreMes(mesNuevo)}`}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {seleccion === TODOS && <TableHead>Cliente</TableHead>}
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Último precio</TableHead>
                <TableHead className="w-36 text-right">{nombreMes(mesNuevo)}</TableHead>
                <TableHead className="text-right">Variación</TableHead>
                <TableHead className="text-right">Lista</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f, i) => {
                const t = nuevos[f.clave] ?? ''
                const v = Number(t.replace(',', '.'))
                const varPct = f.base && t && v > 0 ? (v / f.base - 1) * 100 : null
                const bajoMinimo = f.minimo != null && t !== '' && v > 0 && v < f.minimo
                const primera = i === 0 || filas[i - 1].cliente.id !== f.cliente.id
                return (
                  <TableRow key={f.clave} className={primera && seleccion === TODOS ? 'border-t-2 border-t-foreground/20' : ''}>
                    {seleccion === TODOS && <TableCell className="font-medium">{primera ? f.cliente.nombre : ''}</TableCell>}
                    <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                    <TableCell>{f.descripcion}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {precio(f.base)}
                      {f.baseMes && <span className="ml-1 text-xs text-muted-foreground">{nombreMes(f.baseMes)}</span>}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        aria-label={`Precio ${f.sku}`}
                        aria-invalid={t !== '' && !(v > 0)}
                        className={bajoMinimo ? 'h-8 border-red-500 bg-red-50 text-right tabular-nums' : 'h-8 text-right tabular-nums'}
                        title={bajoMinimo ? 'Está por debajo del precio mínimo' : undefined}
                        value={t}
                        onChange={(e) => {
                          setNuevos({ ...nuevos, [f.clave]: e.target.value })
                          setOrigenes({ ...origenes, [f.clave]: 'MANUAL' })
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {varPct != null && (
                        <Badge variant={varPct > UMBRAL_AUMENTO_ATIPICO ? 'alerta' : varPct < 0 ? 'baja' : 'outline'}>{pct(varPct)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.lista)}</TableCell>
                    <TableCell className={bajoMinimo ? 'text-right font-medium text-red-700 tabular-nums' : 'text-right tabular-nums text-muted-foreground'}>{precio(f.minimo)}</TableCell>
                  </TableRow>
                )
              })}
              {!filas.length && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    Este cliente no tiene SKUs asignados. Agregalos desde Clientes.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
