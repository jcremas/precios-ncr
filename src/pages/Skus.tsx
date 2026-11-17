import { useEffect, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import type { EstadoSku, Sku } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const ESTADOS: EstadoSku[] = ['ACTIVO', 'INACTIVO', 'DESCONTINUADO']

function FilaSku({ s, onGuardado }: { s: Sku; onGuardado: () => void }) {
  const [d, setD] = useState(s)
  const [error, setError] = useState<string | null>(null)
  const cambio = d.descripcion !== s.descripcion || d.familia !== s.familia || d.estado !== s.estado || d.admite_descuento !== s.admite_descuento

  async function guardar() {
    if (!d.descripcion.trim()) return setError('Falta descripción')
    const { error } = await supabase.from('skus')
      .update({ descripcion: d.descripcion.trim(), familia: d.familia?.trim() || null, estado: d.estado, admite_descuento: d.admite_descuento })
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
      <TableCell>
        {cambio && <Button size="sm" onClick={guardar}>Guardar</Button>}
        {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
      </TableCell>
    </TableRow>
  )
}

export default function Skus() {
  const [skus, setSkus] = useState<Sku[]>([])
  const [nuevo, setNuevo] = useState({ sku: '', descripcion: '', familia: '', admite_descuento: true })
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      sku: Number(sku), descripcion: nuevo.descripcion.trim(), familia: nuevo.familia.trim() || null, admite_descuento: nuevo.admite_descuento,
    })
    if (error) return setError(mensajeError(error).includes('skus_pkey') ? 'Ese SKU ya existe.' : mensajeError(error))
    setError(null)
    setNuevo({ sku: '', descripcion: '', familia: '', admite_descuento: true })
    setAbierto(false)
    cargar()
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center">
        <h1 className="mr-auto text-xl font-semibold">SKUs</h1>
        <Button onClick={() => setAbierto(true)}><Plus /> Nuevo SKU</Button>
      </div>

      {abierto && (
        <Card>
          <CardHeader><CardTitle>Nuevo SKU</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={crear} className="grid gap-4 md:grid-cols-[1fr_2fr_1fr_auto] md:items-end">
              <div className="grid gap-2"><Label htmlFor="sku">SKU (número)</Label><Input id="sku" inputMode="numeric" required value={nuevo.sku} onChange={(e) => setNuevo({ ...nuevo, sku: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="desc">Descripción</Label><Input id="desc" required value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="fam">Familia</Label><Input id="fam" value={nuevo.familia} onChange={(e) => setNuevo({ ...nuevo, familia: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" checked={nuevo.admite_descuento} onChange={(e) => setNuevo({ ...nuevo, admite_descuento: e.target.checked })} /> Admite descuento (destildalo si vale lo mismo para todos los niveles)</label>
              <div className="flex gap-2"><Button type="submit">Crear</Button><Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button></div>
            </form>
            <p className="mt-3 text-xs text-muted-foreground">El SKU nuevo queda tildado en todos los clientes genéricos. A los especiales se lo agregás desde su ficha. Su precio se carga en Lista general.</p>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead>Familia</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-center">Admite descuento</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {skus.map((s) => <FilaSku key={`${s.sku}-${s.descripcion}-${s.familia}-${s.estado}-${s.admite_descuento}`} s={s} onGuardado={cargar} />)}
        </TableBody>
      </Table>
    </div>
  )
}
