import { useEffect, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import type { EstadoSku, Sku } from '@/lib/tipos'
import { useUsuarios } from '@/lib/usuarios'
import { AvisoSoloAdmin } from '@/components/AvisoSoloAdmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const ESTADOS: EstadoSku[] = ['ACTIVO', 'INACTIVO', 'DESCONTINUADO']

/** '1.200' / '1200' -> 1200; vacío -> null; inválido -> undefined. */
function aUnidades(texto: string): number | null | undefined {
  const t = texto.trim().replace(/\./g, '')
  if (!t) return null
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : undefined
}

/** '0,48' / '480' / '1.250,5' -> número; vacío -> null; inválido -> undefined. */
function aPeso(texto: string): number | null | undefined {
  let t = texto.trim()
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined
}

const txt = (n: number | null) => (n == null ? '' : String(n).replace('.', ','))

/** Valida los tres datos del SKU; devuelve el error o los valores. */
function datosSku(pallet: string, peso: string, color: string) {
  const unidades_pallet = aUnidades(pallet)
  if (unidades_pallet === undefined) return { error: 'Unidades por pallet: número entero' }
  const p = aPeso(peso)
  if (p === undefined) return { error: 'Peso: número mayor a 0' }
  if (color.trim().length > 10) return { error: 'Color: hasta 10 caracteres' }
  return { valores: { unidades_pallet, peso: p, color: color.trim() || null } }
}

function FilaSku({ s, onGuardado }: { s: Sku; onGuardado: () => void }) {
  const [d, setD] = useState(s)
  const [error, setError] = useState<string | null>(null)
  const [pallet, setPallet] = useState(txt(s.unidades_pallet))
  const [peso, setPeso] = useState(txt(s.peso))
  const [color, setColor] = useState(s.color ?? '')
  const [sinonimos, setSinonimos] = useState(s.sinonimos ?? '')
  const cambio = d.descripcion !== s.descripcion || d.familia !== s.familia || d.estado !== s.estado || d.admite_descuento !== s.admite_descuento || d.para_genericos !== s.para_genericos
    || pallet !== txt(s.unidades_pallet) || peso !== txt(s.peso) || color !== (s.color ?? '') || sinonimos !== (s.sinonimos ?? '')

  async function guardar() {
    if (!d.descripcion.trim()) return setError('Falta descripción')
    const r = datosSku(pallet, peso, color)
    if (r.error) return setError(r.error)
    if (sinonimos.trim().length > 300) return setError('Otros nombres: hasta 300 caracteres')
    const { error } = await supabase.from('skus')
      .update({ descripcion: d.descripcion.trim(), familia: d.familia?.trim() || null, estado: d.estado, admite_descuento: d.admite_descuento, ...r.valores,
        ...(sinonimos !== (s.sinonimos ?? '') ? { sinonimos: sinonimos.trim() || null } : {}),
        ...(d.para_genericos !== s.para_genericos ? { para_genericos: !!d.para_genericos } : {}) })
      .eq('sku', s.sku)
    if (error) return setError(mensajeError(error))
    setError(null)
    onGuardado()
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{s.sku}</TableCell>
      <TableCell><Input className="h-8" value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.target.value })} /></TableCell>
      <TableCell><Input className="h-8" value={d.familia ?? ''} onChange={(e) => setD({ ...d, familia: e.target.value })} /></TableCell>
      <TableCell>
        <Select className="h-8" value={d.estado} onChange={(e) => setD({ ...d, estado: e.target.value as EstadoSku })}>
          {ESTADOS.map((x) => <option key={x}>{x}</option>)}
        </Select>
      </TableCell>
      <TableCell className="text-center">
        <input type="checkbox" aria-label={`SKU ${s.sku} admite descuento`} checked={d.admite_descuento} onChange={(e) => setD({ ...d, admite_descuento: e.target.checked })} />
      </TableCell>
      <TableCell className="text-center">
        <input type="checkbox" aria-label={`SKU ${s.sku} va a genéricos`} checked={!!d.para_genericos} onChange={(e) => setD({ ...d, para_genericos: e.target.checked })} />
      </TableCell>
      <TableCell>
        <Input className="h-8 w-20 text-right" inputMode="decimal" aria-label={`Peso ${s.sku}`} value={peso} onChange={(e) => setPeso(e.target.value)} />
      </TableCell>
      <TableCell>
        <Input className="h-8 w-24 text-right" inputMode="numeric" aria-label={`Unidades por pallet ${s.sku}`} value={pallet} onChange={(e) => setPallet(e.target.value)} />
      </TableCell>
      <TableCell>
        <Input className="h-8 w-28" maxLength={10} aria-label={`Color ${s.sku}`} value={color} onChange={(e) => setColor(e.target.value)} />
      </TableCell>
      <TableCell>
        <Input className="h-8 min-w-48" maxLength={300} aria-label={`Otros nombres ${s.sku}`} placeholder="ej. Giuliana, oliva" value={sinonimos} onChange={(e) => setSinonimos(e.target.value)} />
      </TableCell>
      <TableCell>
        {cambio && <Button size="sm" onClick={guardar}>Guardar</Button>}
        {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
      </TableCell>
    </TableRow>
  )
}

export default function Skus() {
  const { esAdmin } = useUsuarios()
  const [skus, setSkus] = useState<Sku[]>([])
  const [nuevo, setNuevo] = useState({ sku: '', descripcion: '', familia: '', admite_descuento: true, para_genericos: true })
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verPegar, setVerPegar] = useState(false)
  const [pegado, setPegado] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  async function cargar() {
    const { data, error } = await supabase.from('skus').select('*').order('descripcion')
    if (error) setError(mensajeError(error))
    else setSkus(data as Sku[])
  }
  useEffect(() => {
    cargar()
  }, [])

  async function crear(e: FormEvent) {
    e.preventDefault()
    const sku = nuevo.sku.trim()
    if (!/^\d+$/.test(sku)) return setError('El SKU tiene que ser un número entero, sin letras ni puntos.')
    const { error } = await supabase.from('skus').insert({
      sku: Number(sku), descripcion: nuevo.descripcion.trim(), familia: nuevo.familia.trim() || null, admite_descuento: nuevo.admite_descuento, para_genericos: nuevo.para_genericos,
    })
    if (error) return setError(mensajeError(error).includes('skus_pkey') ? 'Ese SKU ya existe.' : mensajeError(error))
    setError(null)
    setNuevo({ sku: '', descripcion: '', familia: '', admite_descuento: true, para_genericos: true })
    setAbierto(false)
    cargar()
  }

  async function aplicarPegado() {
    // Formato: SKU [tab] peso [tab] unidades por pallet [tab] color, una fila por línea (copiado de Excel).
    const desconocidos: string[] = []
    const invalidos: string[] = []
    let ok = 0
    for (const linea of pegado.split(/\r?\n/)) {
      const partes = linea.split(/\t|;/).map((x) => x.trim())
      if (!/^\d+$/.test(partes[0] ?? '')) continue
      const sku = Number(partes[0])
      if (!skus.some((s) => s.sku === sku)) { desconocidos.push(partes[0]); continue }
      const r = datosSku(partes[2] ?? '', partes[1] ?? '', partes[3] ?? '')
      if (r.error) { invalidos.push(`${partes[0]} (${r.error})`); continue }
      // 5ª columna opcional: otros nombres (si no viene, no se toca).
      const extra = partes.length >= 5 ? { sinonimos: partes[4].slice(0, 300) || null } : {}
      const { error } = await supabase.from('skus').update({ ...r.valores!, ...extra }).eq('sku', sku)
      if (error) return setError(mensajeError(error))
      ok++
    }
    setPegado('')
    setVerPegar(false)
    setAviso(`Se guardaron los datos de ${ok} SKU(s).`
      + (desconocidos.length ? ` No existen: ${desconocidos.join(', ')}.` : '')
      + (invalidos.length ? ` Valor no válido en: ${invalidos.join(', ')}.` : ''))
    cargar()
  }

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">SKUs</h1>
        {esAdmin && <>
        <Button variant="outline" onClick={() => setVerPegar(!verPegar)}>Pegar datos desde Excel</Button>
        <Button onClick={() => setAbierto(true)}><Plus /> Nuevo SKU</Button>
        </>}
      </div>
      <AvisoSoloAdmin que="la tabla de SKUs" />

      {verPegar && (
        <Card>
          <CardContent className="grid gap-2 pt-6">
            <Label htmlFor="pegado">Copiá en Excel las columnas SKU, Peso, Unidades por pallet y Color (en ese orden), y pegalas acá. Opcional: una quinta columna con Otros nombres. Una celda vacía borra ese dato.</Label>
            <textarea id="pegado" className="min-h-32 rounded-md border p-2 font-mono text-sm" value={pegado} onChange={(e) => setPegado(e.target.value)} placeholder={'11008938\t480\t1200\tVERDE\n11008939\t520\t1450\tCARAMELO'} />
            <div><Button size="sm" onClick={aplicarPegado} disabled={!pegado.trim()}>Guardar</Button></div>
          </CardContent>
        </Card>
      )}
      {aviso && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}

      {abierto && (
        <Card>
          <CardHeader><CardTitle>Nuevo SKU</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={crear} className="grid gap-4 md:grid-cols-[1fr_2fr_1fr_auto] md:items-end">
              <div className="grid gap-2"><Label htmlFor="sku">SKU (número)</Label><Input id="sku" inputMode="numeric" required value={nuevo.sku} onChange={(e) => setNuevo({ ...nuevo, sku: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="desc">Descripción</Label><Input id="desc" required value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="fam">Familia</Label><Input id="fam" value={nuevo.familia} onChange={(e) => setNuevo({ ...nuevo, familia: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" checked={nuevo.admite_descuento} onChange={(e) => setNuevo({ ...nuevo, admite_descuento: e.target.checked })} /> Admite descuento (destildalo si vale lo mismo para todos los niveles)</label>
              <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" checked={nuevo.para_genericos} onChange={(e) => setNuevo({ ...nuevo, para_genericos: e.target.checked })} /> Para genéricos (se tilda en todos los clientes genéricos; destildalo si no es de vino)</label>
              <div className="flex gap-2"><Button type="submit">Crear</Button><Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button></div>
            </form>
            <p className="mt-3 text-xs text-muted-foreground">Si es “para genéricos”, el SKU nuevo queda tildado en todos los clientes genéricos. A los especiales se lo agregás desde su ficha. Su precio se carga en Lista general.</p>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <fieldset disabled={!esAdmin} className="contents">
      <Table fija>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead>Familia</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-center">Admite descuento</TableHead>
            <TableHead className="text-center" title="Si va tildado en los clientes genéricos nuevos y cuando se crea el SKU. No cambia a los genéricos ya cargados: eso se hace desde la ficha del cliente.">Genéricos</TableHead>
            <TableHead>Peso</TableHead>
            <TableHead>Unid./pallet</TableHead>
            <TableHead>Color</TableHead>
            <TableHead title="Cómo lo nombran los clientes en sus pedidos, separado por coma. Lo usa Pegar pedido en Cotizar.">Otros nombres</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {skus.map((s) => <FilaSku key={`${s.sku}-${s.descripcion}-${s.familia}-${s.estado}-${s.admite_descuento}-${s.para_genericos}-${s.unidades_pallet}-${s.peso}-${s.color}-${s.sinonimos}`} s={s} onGuardado={cargar} />)}
        </TableBody>
      </Table>
      </fieldset>
    </div>
  )
}
