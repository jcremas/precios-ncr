import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { nombreMes, precio } from '@/lib/formato'
import { MODALIDADES, nombreModalidad, type Cliente, type Modalidad } from '@/lib/tipos'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Linea { sku: number; descripcion: string; precio: number; mes: string; origen: string; pallet?: number | null }

const fmtUnidades = new Intl.NumberFormat('es-AR')

export default function Cotizar() {
  const [clientes, setClientes] = useState<Pick<Cliente, 'id' | 'nombre' | 'nivel' | 'nro_cliente' | 'modalidad' | 'cotiza'>[]>([])
  const [id, setId] = useState('')
  const [modalidad, setModalidad] = useState<Modalidad | ''>('')
  const [buscar, setBuscar] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    supabase.from('clientes').select('id, nombre, nivel, nro_cliente, modalidad, cotiza').eq('activo', true).order('nombre')
      .then(({ data }) => setClientes(data ?? []))
  }, [])

  const cliente = clientes.find((c) => String(c.id) === id)
  const texto = buscar.trim().toUpperCase()
  const visibles = clientes.filter((c) =>
    (!modalidad || c.modalidad === modalidad) &&
    (!texto || c.nombre.toUpperCase().includes(texto) || (c.nro_cliente ?? '').toUpperCase().includes(texto)))

  useEffect(() => {
    setLineas([])
    setAviso(null)
    setCopiado(false)
    if (!cliente) return
    if (!cliente.cotiza) return setAviso('Este cliente está marcado como NO COTIZA.')
    Promise.all([cotizar(cliente), supabase.from('skus').select('sku, unidades_pallet')]).then(([{ lineas, error }, s]) => {
      if (error) return setAviso(error)
      const pallet = new Map((s.data ?? []).map((x) => [x.sku, x.unidades_pallet as number | null]))
      setLineas(lineas.map((l) => ({ ...l, pallet: pallet.get(l.sku) ?? null })))
      if (!lineas.length) setAviso(cliente.modalidad === 'ESPECIAL' ? 'Este cliente todavía no tiene precios cargados.' : 'No hay lista general cargada o el cliente no tiene SKUs tildados.')
    })
  }, [cliente])

  /** Genérico: lista vigente menos su descuento; si no hay lista vigente,
   *  sus últimos precios guardados. Especial: sus últimos precios. */
  async function cotizar(c: NonNullable<typeof cliente>): Promise<{ lineas: Linea[]; error?: string }> {
    const { data, error } = await supabase.rpc('cotizar', { p_cliente_id: c.id })
    if (error) return { lineas: [], error: mensajeError(error) }
    if (data?.length || c.modalidad === 'ESPECIAL') return { lineas: (data ?? []) as Linea[] }
    const [u, g, s] = await Promise.all([
      supabase.from('v_ultimo_precio_cliente').select('sku, mes, precio').eq('cliente_id', c.id),
      supabase.from('cliente_skus').select('sku').eq('cliente_id', c.id).eq('activo', true),
      supabase.from('skus').select('sku, descripcion'),
    ])
    const tildados = new Set((g.data ?? []).map((x) => x.sku))
    const desc = new Map((s.data ?? []).map((x) => [x.sku, x.descripcion as string]))
    return {
      lineas: (u.data ?? [])
        .filter((x) => tildados.has(x.sku))
        .map((x) => ({ sku: x.sku, descripcion: desc.get(x.sku) ?? '', precio: Number(x.precio), mes: x.mes, origen: 'último precio guardado' }))
        .sort((a, b) => a.descripcion.localeCompare(b.descripcion) || a.sku - b.sku),
    }
  }

  async function copiar() {
    // Texto compacto para pegar en el cuerpo del correo: una línea por SKU.
    const texto = [
      `Lista de precios - ${cliente?.nombre}`,
      '',
      ...lineas.map((l) => [l.sku, l.descripcion, precio(Number(l.precio)), l.pallet ? `${fmtUnidades.format(l.pallet)} u/pallet` : null]
        .filter(Boolean).join(' · ')),
    ].join('\n')
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Cotizar a un cliente</CardTitle>
          <CardDescription>Genérico: lista general vigente menos el descuento de su nivel. Especial: su último precio cargado. No cotiza: bloqueado. Solo SKUs tildados.</CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-3xl gap-4 md:grid-cols-[180px_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="mod">Tipo de cliente</Label>
            <Select id="mod" value={modalidad} onChange={(e) => setModalidad(e.target.value as Modalidad | '')}>
              <option value="">Todos ({clientes.length})</option>
              {MODALIDADES.map((m) => <option key={m} value={m}>{m === 'GENERICO' ? 'Genéricos' : 'Especiales'} ({clientes.filter((c) => c.modalidad === m).length})</option>)}
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="buscar">Buscar por nombre o código</Label>
            <Input id="buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Ej.: SIETE" />
          </div>
          <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="cli">Cliente</Label>
          <Select id="cli" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Elegí un cliente ({visibles.length})</option>
            {visibles.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {nombreModalidad(c.modalidad)}{c.nivel ? ` ${c.nivel}` : ''}{c.cotiza ? '' : ' · NO COTIZA'}</option>)}
          </Select>
          </div>
        </CardContent>
      </Card>

      {aviso && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{aviso}</p>}

      {lineas.length > 0 && (
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <Badge>{cliente && nombreModalidad(cliente.modalidad)}{cliente?.nivel ? ` · ${cliente.nivel}` : ''}</Badge>
            <span className="text-sm text-muted-foreground">{lineas.length} SKU(s)</span>
            <Button className="ml-auto" variant="outline" onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar para enviar'}</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Unid./pallet</TableHead>
                <TableHead>Desde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineas.map((l) => (
                <TableRow key={l.sku}>
                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                  <TableCell>{l.descripcion}</TableCell>
                  <TableCell className="text-right tabular-nums">{precio(Number(l.precio))}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.pallet ? fmtUnidades.format(l.pallet) : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{nombreMes(l.mes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
