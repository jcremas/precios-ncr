import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { nombreMes, precio } from '@/lib/formato'
import { nombreModalidad, type Cliente } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Linea { sku: number; descripcion: string; precio: number; mes: string; origen: string }

export default function Cotizar() {
  const [clientes, setClientes] = useState<Pick<Cliente, 'id' | 'nombre' | 'nivel' | 'nro_cliente' | 'modalidad' | 'cotiza'>[]>([])
  const [id, setId] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    supabase.from('clientes').select('id, nombre, nivel, nro_cliente, modalidad, cotiza').eq('activo', true).order('nombre')
      .then(({ data }) => setClientes(data ?? []))
  }, [])

  const cliente = clientes.find((c) => String(c.id) === id)

  useEffect(() => {
    setLineas([])
    setAviso(null)
    setCopiado(false)
    if (!cliente) return
    if (!cliente.cotiza) return setAviso('Este cliente está marcado como NO COTIZA.')
    supabase.rpc('cotizar', { p_cliente_id: cliente.id }).then(({ data, error }) => {
      if (error) return setAviso(mensajeError(error))
      setLineas((data ?? []) as Linea[])
      if (!data?.length) setAviso(cliente.modalidad === 'ESPECIAL' ? 'Este cliente todavía no tiene precios cargados.' : 'No hay lista general cargada o el cliente no tiene SKUs tildados.')
    })
  }, [cliente])

  async function copiar() {
    const texto = [
      `Lista de precios - ${cliente?.nombre}`,
      '',
      ...lineas.map((l) => `${l.sku}\t${l.descripcion}\t${precio(l.precio)}`),
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
        <CardContent className="grid max-w-xl gap-2">
          <Label htmlFor="cli">Cliente</Label>
          <Select id="cli" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Elegí un cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {nombreModalidad(c.modalidad)}{c.nivel ? ` ${c.nivel}` : ''}{c.cotiza ? '' : ' · NO COTIZA'}</option>)}
          </Select>
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
                <TableHead>Desde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineas.map((l) => (
                <TableRow key={l.sku}>
                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                  <TableCell>{l.descripcion}</TableCell>
                  <TableCell className="text-right tabular-nums">{precio(Number(l.precio))}</TableCell>
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
