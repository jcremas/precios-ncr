import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { listasGenerales, mensajeError } from '@/lib/datos'
import { aInputMes, desdeInputMes, mesActual, nombreMes, pct, precio, redondear } from '@/lib/formato'
import { exportarExcel, listaVigente, precioConDescuento } from '@/lib/precios'
import type { ListaGeneral as Lista, Sku } from '@/lib/tipos'
import { useNiveles } from '@/lib/niveles'
import { useUsuarios } from '@/lib/usuarios'
import { AvisoSoloAdmin } from '@/components/AvisoSoloAdmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const aTexto = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
const aNumero = (t: string) => Number(t.trim().replace(/\$|\s/g, '').replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.'))

interface Edicion { precio: string; minimo: string }
/** Estado de una lista (vista v_estado_listas). */
interface EstadoLista { mes: string; skus: number; publicada_en: string | null; ultimo_cambio: string | null }

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ListaGeneral() {
  const { niveles } = useNiveles()
  const { esAdmin } = useUsuarios()
  const conDescuento = niveles.filter((n) => n.descuento_pct > 0)
  const [skus, setSkus] = useState<Sku[]>([])
  const [listas, setListas] = useState<Lista[]>([])
  const [mes, setMes] = useState(mesActual())
  const [ed, setEd] = useState<Record<number, Edicion>>({})
  const [aumento, setAumento] = useState('')
  const [pegado, setPegado] = useState('')
  const [verPegar, setVerPegar] = useState(false)
  const [genericos, setGenericos] = useState(0)
  const [estados, setEstados] = useState<EstadoLista[]>([])
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function cargar(mesElegido?: string) {
    const [s, l, g, e] = await Promise.all([
      supabase.from('skus').select('*').order('descripcion'),
      listasGenerales().catch((err) => err as Error),
      supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('modalidad', 'GENERICO').eq('cotiza', true).eq('activo', true),
      supabase.from('v_estado_listas').select('mes, skus, publicada_en, ultimo_cambio'),
    ])
    if (l instanceof Error) return setEstado({ tipo: 'error', texto: mensajeError(l) })
    const ls = l
    if (s.error) return setEstado({ tipo: 'error', texto: mensajeError(s.error) })
    setSkus(s.data as Sku[])
    setListas(ls)
    setGenericos(g.count ?? 0)
    setEstados((e.data ?? []) as EstadoLista[])
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
    setEstado({ tipo: 'ok', texto: `Lista de ${nombreMes(mes)} guardada. Para que llegue a los clientes genéricos y a Cotizar, apretá Publicar.` })
    await cargar(mes)
  }

  async function publicar() {
    if (!window.confirm(`Se van a calcular y guardar los precios de ${nombreMes(mes)} para ${genericos} cliente(s) genérico(s), en los SKUs que cada uno tiene tildados.\n\nSi ya estaban publicados y la lista cambió, se corrigen (queda registrado el valor anterior).\n\n¿Publicar?`)) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('publicar_lista', { p_mes: mes })
    setOcupado(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeError(error) })
    setEstado({ tipo: 'ok', texto: `Lista de ${nombreMes(mes)} publicada: ${data} precio(s) nuevos o corregidos en clientes genéricos.` })
    await cargar(mes)
  }

  // Borrador / publicada / publicada con cambios sin publicar.
  const est = estados.find((x) => x.mes === mes)
  const sinPublicar = !!est && (!est.publicada_en || (!!est.ultimo_cambio && est.ultimo_cambio > est.publicada_en))

  function exportar() {
    exportarExcel(`lista_general_${aInputMes(mes)}`, ['SKU', 'Producto', 'Sin descuento', ...niveles.map((n) => n.nombre), 'Mínimo'],
      filas.filter((f) => f.precio != null).map((f) => [
        f.s.sku, f.s.descripcion, f.s.admite_descuento ? '' : 'SÍ',
        ...niveles.map((n) => precioConDescuento(f.precio!, n.descuento_pct, f.s.admite_descuento)), f.minimo,
      ]))
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Lista general</CardTitle>
          <CardDescription>
            Un precio de LISTA por SKU y mes, más el precio mínimo (piso) de referencia. Los demás niveles se calculan con su descuento y se redondean a 1 decimal; los SKUs "sin descuento" valen lo mismo en todos los niveles. Guardá la lista y después publicala: mientras no la publiques es un borrador y no llega a los clientes genéricos ni a Cotizar. Si corregís un precio ya guardado, el valor anterior queda registrado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-full"><AvisoSoloAdmin que="la lista general" /></div>
          <div className="grid gap-2">
            <Label htmlFor="mes">Mes de la lista</Label>
            <Input id="mes" type="month" className="w-44" value={aInputMes(mes)} onChange={(e) => e.target.value && setMes(desdeInputMes(e.target.value))} />
          </div>
          {esAdmin && <div className="grid gap-2">
            <Label htmlFor="aum">% sobre la lista anterior</Label>
            <Input id="aum" className="w-32" inputMode="decimal" placeholder="ej. 4,5" value={aumento} onChange={(e) => setAumento(e.target.value)} />
          </div>}
          {esAdmin && <>
          <Button variant="secondary" disabled={!anterior.size || !aumento} onClick={() => desdeAnterior(aNumero(aumento))}>Aplicar %</Button>
          <Button variant="outline" disabled={!anterior.size} onClick={() => desdeAnterior(0)}>Copiar anterior</Button>
          <Button variant="outline" onClick={() => setVerPegar(!verPegar)}>Pegar desde Excel</Button>
          </>}
          <Button variant="outline" onClick={exportar} disabled={!delMes.size}>Exportar a Excel</Button>
        </CardContent>
        {esAdmin && verPegar && (
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
          {est && (est.publicada_en
            ? <Badge variant={sinPublicar ? 'alerta' : 'outline'} className="ml-2">{sinPublicar ? `Publicada el ${fechaHora(est.publicada_en)}, con cambios sin publicar` : `Publicada el ${fechaHora(est.publicada_en)}`}</Badge>
            : <Badge variant="alerta" className="ml-2">Borrador: todavía no llega a los genéricos ni a Cotizar</Badge>)}
          {cambios.length > 0 && ` · ${cambios.length} cambio(s) sin guardar`}
          {invalidos.length > 0 && ` · ${invalidos.length} valor(es) inválido(s)`}
        </p>
        {esAdmin && <div className="ml-auto flex gap-2">
          <Button onClick={guardar} disabled={ocupado || !cambios.length || invalidos.length > 0}>Guardar lista</Button>
          <Button variant={sinPublicar ? 'default' : 'secondary'} onClick={publicar} disabled={ocupado || !delMes.size || cambios.length > 0}>
            Publicar a {genericos} genérico(s)
          </Button>
        </div>}
      </div>

      <fieldset disabled={!esAdmin} className="contents">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Anterior</TableHead>
            <TableHead className="w-32 text-right">LISTA</TableHead>
            <TableHead className="text-right">Var.</TableHead>
            {conDescuento.map((n) => <TableHead key={n.nombre} className="text-right">{n.nombre}</TableHead>)}
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
                {conDescuento.map((n) => (
                  <TableCell key={n.nombre} className="text-right tabular-nums">{f.precio != null ? precio(precioConDescuento(f.precio, n.descuento_pct, f.s.admite_descuento)) : ''}</TableCell>
                ))}
                <TableCell>
                  <Input className="h-8 text-right tabular-nums" inputMode="decimal" aria-label={`Mínimo ${f.s.sku}`} value={f.e.minimo} onChange={(e) => set(f.s.sku, 'minimo', e.target.value)} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      </fieldset>
    </div>
  )
}
