import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { useNiveles, type NivelDescuento } from '@/lib/niveles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Uso { total: number; genericos: number }

const aPct = (t: string) => {
  const n = Number(t.trim().replace(',', '.'))
  return t.trim() !== '' && Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) / 100 : null
}
const txtPct = (n: number) => String(n).replace('.', ',')

function traducir(e: unknown) {
  const m = mensajeError(e)
  if (m.includes('niveles_nombre_unico') || m.includes('niveles_pkey')) return 'Ya existe un nivel con ese nombre.'
  if (m.includes('clientes_nivel_fkey')) return 'No se puede borrar: hay clientes con este nivel. Cambiales el nivel primero.'
  return m
}

function FilaNivel({ n, uso, onCambio }: { n: NivelDescuento; uso: Uso; onCambio: (msg: string) => void }) {
  const [codigo, setCodigo] = useState(n.nombre)
  const [pct, setPct] = useState(txtPct(n.descuento_pct))
  const [orden, setOrden] = useState(String(n.orden))
  const [error, setError] = useState<string | null>(null)
  const cambio = codigo.trim().toUpperCase() !== n.nombre || pct !== txtPct(n.descuento_pct) || orden !== String(n.orden)

  async function guardar() {
    const nuevoCodigo = codigo.trim().toUpperCase()
    const nuevoPct = aPct(pct)
    if (!nuevoCodigo) return setError('Falta el nombre')
    if (nuevoPct == null) return setError('% entre 0 y 99,99')
    if (!/^\d+$/.test(orden.trim())) return setError('Orden: número entero')
    const cambiaPct = nuevoPct !== n.descuento_pct
    if (cambiaPct && uso.genericos > 0 && !window.confirm(
      `Vas a cambiar ${n.nombre} de ${txtPct(n.descuento_pct)}% a ${txtPct(nuevoPct)}%.\n\n` +
      `Se recalculan los precios de este mes de ${uso.genericos} cliente(s) genérico(s) con la lista vigente. Los meses anteriores no cambian.`)) return
    const { error } = await supabase.from('niveles')
      .update({ nombre: nuevoCodigo, descuento_pct: nuevoPct, orden: Number(orden) })
      .eq('id', n.id)
    if (error) return setError(traducir(error))
    setError(null)
    onCambio(cambiaPct && uso.genericos > 0
      ? `${nuevoCodigo} guardado. Se recalcularon los precios de este mes de ${uso.genericos} cliente(s) genérico(s).`
      : `${nuevoCodigo} guardado.`)
  }

  async function borrar() {
    if (!window.confirm(`¿Borrar el nivel ${n.nombre}?`)) return
    const { error } = await supabase.from('niveles').delete().eq('id', n.id)
    if (error) return setError(traducir(error))
    onCambio(`${n.nombre} borrado.`)
  }

  return (
    <TableRow>
      <TableCell><Input className="h-8 w-48 uppercase" aria-label={`Nombre ${n.nombre}`} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></TableCell>
      <TableCell><Input className="h-8 w-24 text-right" inputMode="decimal" aria-label={`Descuento ${n.nombre}`} value={pct} onChange={(e) => setPct(e.target.value)} /></TableCell>
      <TableCell><Input className="h-8 w-20 text-right" inputMode="numeric" aria-label={`Orden ${n.nombre}`} value={orden} onChange={(e) => setOrden(e.target.value)} /></TableCell>
      <TableCell className="text-right tabular-nums">{uso.total}{uso.genericos ? <span className="text-muted-foreground"> ({uso.genericos} genéricos)</span> : null}</TableCell>
      <TableCell className="whitespace-nowrap">
        {cambio && <Button size="sm" onClick={guardar}>Guardar</Button>}
        <Button size="sm" variant="ghost" disabled={uso.total > 0} title={uso.total > 0 ? 'Tiene clientes: no se puede borrar' : 'Borrar'} aria-label={`Borrar ${n.nombre}`} onClick={borrar}><Trash2 /></Button>
        {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
      </TableCell>
    </TableRow>
  )
}

export default function Niveles() {
  const { niveles, recargar } = useNiveles()
  const [usos, setUsos] = useState<Map<number, Uso>>(new Map())
  const [nuevo, setNuevo] = useState({ codigo: '', pct: '' })
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function cargarUsos() {
    const { data } = await supabase.from('clientes').select('nivel_id, modalidad, cotiza, activo').not('nivel_id', 'is', null)
    const m = new Map<number, Uso>()
    for (const c of data ?? []) {
      const u = m.get(c.nivel_id) ?? { total: 0, genericos: 0 }
      u.total++
      if (c.modalidad === 'GENERICO' && c.cotiza && c.activo) u.genericos++
      m.set(c.nivel_id, u)
    }
    setUsos(m)
  }
  useEffect(() => {
    cargarUsos()
  }, [])

  async function despuesDeCambio(msg: string) {
    setAviso(msg)
    await Promise.all([recargar(), cargarUsos()])
  }

  async function crear(e: FormEvent) {
    e.preventDefault()
    const codigo = nuevo.codigo.trim().toUpperCase()
    const pct = aPct(nuevo.pct)
    if (!codigo) return setError('Falta el nombre.')
    if (pct == null) return setError('El descuento tiene que ser un % entre 0 y 99,99.')
    const orden = Math.max(0, ...niveles.map((n) => n.orden)) + 1
    const { error } = await supabase.from('niveles').insert({ nombre: codigo, descuento_pct: pct, orden })
    if (error) return setError(traducir(error))
    setError(null)
    setNuevo({ codigo: '', pct: '' })
    despuesDeCambio(`${codigo} agregado.`)
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Niveles de descuento</CardTitle>
          <CardDescription>
            Los clientes genéricos pagan la lista general menos el % de su nivel. Si cambiás el %, se recalculan los precios de este mes
            de sus clientes genéricos (los meses anteriores quedan como estaban). Cambiar el nombre no cambia precios. Un nivel con clientes no se puede borrar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2"><Label htmlFor="niv-nombre">Nombre</Label><Input id="niv-nombre" className="w-48 uppercase" value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} /></div>
            <div className="grid gap-2"><Label htmlFor="niv-pct">Descuento %</Label><Input id="niv-pct" className="w-24 text-right" inputMode="decimal" value={nuevo.pct} onChange={(e) => setNuevo({ ...nuevo, pct: e.target.value })} /></div>
            <Button type="submit"><Plus /> Agregar nivel</Button>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {aviso && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Descuento %</TableHead>
            <TableHead>Orden</TableHead>
            <TableHead className="text-right">Clientes</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {niveles.map((n) => (
            <FilaNivel key={`${n.id}-${n.nombre}-${n.descuento_pct}-${n.orden}`} n={n} uso={usos.get(n.id) ?? { total: 0, genericos: 0 }} onCambio={despuesDeCambio} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
