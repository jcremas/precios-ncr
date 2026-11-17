import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError, preciosDeClientes, traerTodo } from '@/lib/datos'
import { aInputMes, desdeInputMes, mesActual, mesSiguiente, nombreMes, pct, precio, redondear, UMBRAL_AUMENTO_ATIPICO } from '@/lib/formato'
import type { Cliente, PrecioCliente, Sku } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setCargando(true)
    try {
      const [cli, sk, gr, pr] = await Promise.all([
        supabase.from('clientes').select('id, nombre, nro_cliente').eq('nivel', 'ESPECIAL').eq('activo', true).order('nombre'),
        supabase.from('skus').select('*'),
        traerTodo<{ cliente_id: number; sku: number }>((d, h) =>
          supabase.from('cliente_skus').select('cliente_id, sku').eq('activo', true).range(d, h),
        ),
        preciosDeClientes(),
      ])
      if (cli.error) throw cli.error
      if (sk.error) throw sk.error
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
        })
      }
    }
    return salida.sort((a, b) => a.cliente.nombre.localeCompare(b.cliente.nombre) || a.descripcion.localeCompare(b.descripcion))
  }, [seleccion, clientes, grillas, precios, skus, mesNuevo])

  // Al cambiar cliente o mes, se muestra lo que ya esté cargado en ese mes.
  useEffect(() => {
    const ini: Record<string, string> = {}
    for (const f of filas) if (f.yaCargado != null) ini[f.clave] = aTexto(f.yaCargado)
    setNuevos(ini)
  }, [filas])

  function aplicarAumento() {
    const p = Number(aumento.replace(',', '.'))
    if (!Number.isFinite(p)) return
    const sig: Record<string, string> = { ...nuevos }
    for (const f of filas) if (f.base != null) sig[f.clave] = aTexto(redondear(f.base * (1 + p / 100)))
    setNuevos(sig)
    setEstado(null)
  }

  function copiarBase() {
    const sig: Record<string, string> = { ...nuevos }
    for (const f of filas) if (f.base != null) sig[f.clave] = aTexto(f.base)
    setNuevos(sig)
  }

  const aGuardar = filas
    .map((f) => ({ f, v: Number((nuevos[f.clave] ?? '').replace(',', '.')) }))
    .filter(({ f, v }) => (nuevos[f.clave] ?? '').trim() !== '' && Number.isFinite(v) && v > 0 && v !== f.yaCargado)
  const invalidos = filas.filter((f) => {
    const t = (nuevos[f.clave] ?? '').trim()
    return t !== '' && !(Number(t.replace(',', '.')) > 0)
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
      aGuardar.map(({ f, v }) => ({ cliente_id: f.cliente.id, sku: f.sku, mes: mesNuevo, precio: v })),
      { onConflict: 'cliente_id,sku,mes' },
    )
    setGuardando(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeError(error) })
    setEstado({ tipo: 'ok', texto: `Se guardaron ${aGuardar.length} precio(s) de ${nombreMes(mesNuevo)}.` })
    setPrecios(await preciosDeClientes())
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Envío mensual</CardTitle>
          <CardDescription>
            Elegí un cliente ESPECIAL (o TODOS), el mes a cargar y, si querés, un % de aumento sobre el último precio. Revisá, corregí a mano y guardá.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="cliente">Cliente</Label>
            <Select id="cliente" value={seleccion} onChange={(e) => setSeleccion(e.target.value)} disabled={cargando}>
              <option value="">{cargando ? 'Cargando…' : 'Elegí un cliente'}</option>
              <option value={TODOS}>TODOS los clientes especiales ({clientes.length})</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}{c.nro_cliente ? ` (${c.nro_cliente})` : ''}
                </option>
              ))}
            </Select>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f, i) => {
                const t = nuevos[f.clave] ?? ''
                const v = Number(t.replace(',', '.'))
                const varPct = f.base && t && v > 0 ? (v / f.base - 1) * 100 : null
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
                        className="h-8 text-right tabular-nums"
                        inputMode="decimal"
                        aria-label={`Precio ${f.sku}`}
                        aria-invalid={t !== '' && !(v > 0)}
                        value={t}
                        onChange={(e) => setNuevos({ ...nuevos, [f.clave]: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {varPct != null && (
                        <Badge variant={varPct > UMBRAL_AUMENTO_ATIPICO ? 'alerta' : varPct < 0 ? 'baja' : 'outline'}>{pct(varPct)}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!filas.length && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
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
