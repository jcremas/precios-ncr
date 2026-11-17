import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { aInputMes, desdeInputMes, mesActual, nombreMes, pct, precio, redondear } from '@/lib/formato'
import { exportarExcel, listaVigente, precioConDescuento } from '@/lib/precios'
import { NIVELES, type ListaGeneral as Lista, type Sku } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const aTexto = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
const aNumero = (t: string) => Number(t.trim().replace(/\$|\s/g, '').replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.'))

interface Edicion { precio: string; minimo: string }

export default function ListaGeneral() {
  const [skus, setSkus] = useState<Sku[]>([])
  const [listas, setListas] = useState<Lista[]>([])
  const [mes, setMes] = useState(mesActual())
  const [ed, setEd] = useState<Record<number, Edicion>>({})
  const [aumento, setAumento] = useState('')
  const [pegado, setPegado] = useState('')
  const [verPegar, setVerPegar] = useState(false)
  const [genericos, setGenericos] = useState(0)
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function cargar(mesElegido?: string) {
    const [s, l, g] = await Promise.all([
      supabase.from('skus').select('*').order('descripcion'),
      supabase.from('lista_general').select('mes, sku, precio, precio_minimo'),
      supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('modalidad', 'GENERICO').eq('cotiza', true).eq('activo', true),
    ])
    if (s.error || l.error) return setEstado({ tipo: 'error', texto: mensajeError(s.error ?? l.error) })
    setSkus(s.data as Sku[])
    const ls = (l.data ?? []) as Lista[]
    setListas(ls)
    setGenericos(g.count ?? 0)
    if (!mesElegido) {
      const ultima = ls.reduce((m, x) => (x.mes > m ? x.mes : m), '')
      if (ultima) setMes(ultima)
    }
  }
  useEffect(() => {
    cargar()
  }, [])

  const delMes = useMemo(() => new Map(listas.filter((l) => l.mes === mes).map((l) => [l.sku, l])), [listas, mes])
  const anterior = useMemo(() => {
    const previos = listas.filter((l) => l.mes < mes)
    return listaVigente(previos, mes)
  }, [listas, mes])

  // Al cambiar de mes, cargar en pantalla lo guardado en ese mes.
  useEffect(() => {
    const ini: Record<number, Edicion> = {}
    for (const [sku, l] of delMes) ini[sku] = { precio: aTexto(Number(l.precio)), minimo: aTexto(l.precio_minimo == null ? null : Number(l.precio_minimo)) }
    setEd(ini)
  }, [delMes])

  const filas = skus
    .filter((s) => s.estado === 'ACTIVO' || delMes.has(s.sku))
    .map((s) => {
      const e = ed[s.sku] ?? { precio: '', minimo: '' }
      const p = aNumero(e.precio)
      const m = aNumero(e.minimo)
      const ant = anterior.get(s.sku)
      return {
        s, e,
        precio: e.precio.trim() && p > 0 ? p : null,
        minimo: e.minimo.trim() && m > 0 ? m : null,
        invalido: (e.precio.trim() !== '' && !(p > 0)) || (e.minimo.trim() !== '' && !(m > 0)),
        anterior: ant ? Number(ant.precio) : null,
        anteriorMes: ant?.mes ?? null,
      }
    })

  const cambios = filas.filter((f) => {
    const g = delMes.get(f.s.sku)
    return (f.precio ?? null) !== (g ? Number(g.precio) : null) || (f.minimo ?? null) !== (g?.precio_minimo == null ? null : Number(g.precio_minimo))
  })
  const invalidos = filas.filter((f) => f.invalido)

  function set(sku: number, campo: keyof Edicion, valor: string) {
    setEd({ ...ed, [sku]: { ...(ed[sku] ?? { precio: '', minimo: '' }), [campo]: valor } })
  }

  function desdeAnterior(porc: number) {
    const sig = { ...ed }
    for (const f of filas) {
      const ant = anterior.get(f.s.sku)
      if (!ant) continue
      sig[f.s.sku] = {
        precio: aTexto(redondear(Number(ant.precio) * (1 + porc / 100), 1)),
        minimo: ant.precio_minimo == null ? (sig[f.s.sku]?.minimo ?? '') : aTexto(redondear(Number(ant.precio_minimo) * (1 + porc / 100), 1)),
      }
    }
    setEd(sig)
  }

  function aplicarPegado() {
    // Formato: SKU [tab] precio [tab mínimo], una fila por línea (copiado de Excel).
    const sig = { ...ed }
    const desconocidos: string[] = []
    let ok = 0
    for (const linea of pegado.split(/\r?\n/)) {
      const partes = linea.split(/\t|;/).map((x) => x.trim())
      if (!/^\d+$/.test(partes[0] ?? '')) continue
      const sku = Number(partes[0])
      if (!skus.some((s) => s.sku === sku)) { desconocidos.push(partes[0]); continue }
      sig[sku] = { precio: partes[1] ?? '', minimo: partes[2] ?? sig[sku]?.minimo ?? '' }
      ok++
    }
    setEd(sig)
    setVerPegar(false)
    setPegado('')
    setEstado({ tipo: desconocidos.length ? 'error' : 'ok', texto: `Se pegaron ${ok} SKU(s).` + (desconocidos.length ? ` No existen: ${desconocidos.join(', ')}. Crealos en SKUs primero.` : '') })
  }

  async function guardar() {
    setOcupado(true)
    const subir = cambios.filter((f) => f.precio != null).map((f) => ({ mes, sku: f.s.sku, precio: f.precio, precio_minimo: f.minimo }))
    const borrar = cambios.filter((f) => f.precio == null && delMes.has(f.s.sku)).map((f) => f.s.sku)
    let error = null
    if (subir.length) error = (await supabase.from('lista_general').upsert(subir, { onConflict: 'mes,sku' })).error
    if (!error && borrar.length) error = (await supabase.from('lista_general').delete().eq('mes', mes).in('sku', borrar)).error
    setOcupado(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeError(error) })
    setEstado({ tipo: 'ok', texto: `Lista de ${nombreMes(mes)} guardada. Para que llegue a los clientes genéricos, apretá Publicar.` })
    await cargar(mes)
  }

  async function publicar() {
    if (!window.confirm(`Se van a calcular y guardar los precios de ${nombreMes(mes)} para ${genericos} cliente(s) genérico(s), en los SKUs que cada uno tiene tildados.\n\nSi ya estaban publicados y la lista cambió, se corrigen (queda registrado el valor anterior).\n\n¿Publicar?`)) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('publicar_lista', { p_mes: mes })
    setOcupado(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeError(error) })
    setEstado({ tipo: 'ok', texto: `Lista de ${nombreMes(mes)} publicada: ${data} precio(s) nuevos o corregidos en clientes genéricos.` })
  }

  function exportar() {
    exportarExcel(`lista_general_${aInputMes(mes)}`, ['SKU', 'Producto', 'Sin descuento', ...NIVELES, 'Mínimo'],
      filas.filter((f) => f.precio != null).map((f) => [
        f.s.sku, f.s.descripcion, f.s.admite_descuento ? '' : 'SÍ',
        ...NIVELES.map((n) => precioConDescuento(f.precio!, n, f.s.admite_descuento)), f.minimo,
      ]))
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Lista general</CardTitle>
          <CardDescription>
            Un precio de LISTA por SKU y mes, más el precio mínimo (piso) de referencia. Los demás niveles se calculan con su descuento y se redondean a 1 decimal; los SKUs "sin descuento" valen lo mismo en todos los niveles. Guardá la lista y después publicala para actualizar a los clientes genéricos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="mes">Mes de la lista</Label>
            <Input id="mes" type="month" className="w-44" value={aInputMes(mes)} onChange={(e) => e.target.value && setMes(desdeInputMes(e.target.value))} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="aum">% sobre la lista anterior</Label>
            <Input id="aum" className="w-32" inputMode="decimal" placeholder="ej. 4,5" value={aumento} onChange={(e) => setAumento(e.target.value)} />
          </div>
          <Button variant="secondary" disabled={!anterior.size || !aumento} onClick={() => desdeAnterior(aNumero(aumento))}>Aplicar %</Button>
          <Button variant="outline" disabled={!anterior.size} onClick={() => desdeAnterior(0)}>Copiar anterior</Button>
          <Button variant="outline" onClick={() => setVerPegar(!verPegar)}>Pegar desde Excel</Button>
          <Button variant="outline" onClick={exportar} disabled={!delMes.size}>Exportar a Excel</Button>
        </CardContent>
        {verPegar && (
          <CardContent className="grid gap-2">
            <Label htmlFor="pegado">Copiá en Excel las columnas SKU, precio de LISTA y (opcional) mínimo, y pegalas acá:</Label>
            <textarea id="pegado" className="min-h-32 rounded-md border p-2 font-mono text-sm" value={pegado} onChange={(e) => setPegado(e.target.value)} placeholder={'11008938\t308,3\t250\n11008939\t313,2'} />
            <div><Button size="sm" onClick={aplicarPegado} disabled={!pegado.trim()}>Cargar en la grilla</Button></div>
          </CardContent>
        )}
      </Card>

      {estado && (
        <p className={estado.tipo === 'ok' ? 'rounded-md bg-green-50 p-3 text-sm text-green-800' : 'rounded-md bg-red-50 p-3 text-sm text-red-800'}>{estado.texto}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {delMes.size ? `${delMes.size} SKU(s) guardados en ${nombreMes(mes)}` : `Todavía no hay lista de ${nombreMes(mes)}`}
          {cambios.length > 0 && ` · ${cambios.length} cambio(s) sin guardar`}
          {invalidos.length > 0 && ` · ${invalidos.length} valor(es) inválido(s)`}
        </p>
        <div className="ml-auto flex gap-2">
          <Button onClick={guardar} disabled={ocupado || !cambios.length || invalidos.length > 0}>Guardar lista</Button>
          <Button variant="secondary" onClick={publicar} disabled={ocupado || !delMes.size || cambios.length > 0}>
            Publicar a {genericos} genérico(s)
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Anterior</TableHead>
            <TableHead className="w-32 text-right">LISTA</TableHead>
            <TableHead className="text-right">Var.</TableHead>
            {NIVELES.slice(1).map((n) => <TableHead key={n} className="text-right">{n}</TableHead>)}
            <TableHead className="w-32 text-right">Mínimo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filas.map((f) => {
            const varPct = f.precio && f.anterior ? (f.precio / f.anterior - 1) * 100 : null
            return (
              <TableRow key={f.s.sku}>
                <TableCell className="font-mono text-xs">{f.s.sku}</TableCell>
                <TableCell>
                  {f.s.descripcion}
                  {!f.s.admite_descuento && <Badge variant="outline" className="ml-2">sin descuento</Badge>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{precio(f.anterior)}</TableCell>
                <TableCell>
                  <Input className="h-8 text-right tabular-nums" inputMode="decimal" aria-label={`LISTA ${f.s.sku}`} aria-invalid={f.invalido} value={f.e.precio} onChange={(e) => set(f.s.sku, 'precio', e.target.value)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{varPct != null && Math.abs(varPct) >= 0.05 && <Badge variant={varPct < 0 ? 'baja' : 'outline'}>{pct(varPct)}</Badge>}</TableCell>
                {NIVELES.slice(1).map((n) => (
                  <TableCell key={n} className="text-right tabular-nums">{f.precio != null ? precio(precioConDescuento(f.precio, n, f.s.admite_descuento)) : ''}</TableCell>
                ))}
                <TableCell>
                  <Input className="h-8 text-right tabular-nums" inputMode="decimal" aria-label={`Mínimo ${f.s.sku}`} value={f.e.minimo} onChange={(e) => set(f.s.sku, 'minimo', e.target.value)} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
