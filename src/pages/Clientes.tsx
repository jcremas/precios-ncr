import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { nombreMes } from '@/lib/formato'
import { NIVELES, type IndiceCliente } from '@/lib/tipos'
import { clienteVacio, traducirError, type DatosCliente } from '@/lib/clientes'
import { FormCliente } from '@/components/FormCliente'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function Clientes() {
  const [lista, setLista] = useState<IndiceCliente[]>([])
  const [filtro, setFiltro] = useState('')
  const [nivel, setNivel] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    const { data, error } = await supabase.from('v_indice_clientes').select('*').order('nombre')
    if (error) setError(mensajeError(error))
    else setLista(data as IndiceCliente[])
  }
  useEffect(() => {
    cargar()
  }, [])

  async function crear(d: DatosCliente) {
    const { error } = await supabase.from('clientes').insert(d)
    if (error) return traducirError(error)
    setNuevo(false)
    await cargar()
    return null
  }

  const f = filtro.trim().toUpperCase()
  const visibles = lista.filter(
    (c) => (!nivel || c.nivel === nivel) && (!f || c.nombre.toUpperCase().includes(f) || (c.nro_cliente ?? '').toUpperCase().includes(f)),
  )

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold">Clientes</h1>
        <Input className="w-64" placeholder="Buscar por nombre o código" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <Select className="w-40" value={nivel} onChange={(e) => setNivel(e.target.value)}>
          <option value="">Todos los niveles</option>
          {NIVELES.map((n) => <option key={n}>{n}</option>)}
        </Select>
        <Button onClick={() => setNuevo(true)}><Plus /> Nuevo cliente</Button>
      </div>

      {nuevo && (
        <Card>
          <CardHeader><CardTitle>Nuevo cliente</CardTitle></CardHeader>
          <CardContent>
            <FormCliente inicial={clienteVacio} onGuardar={crear} onCancelar={() => setNuevo(false)} />
            <p className="mt-3 text-xs text-muted-foreground">Si es ESPECIAL, se le arma la grilla con todos los SKUs activos y el historial arranca vacío.</p>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="text-sm text-muted-foreground">{visibles.length} de {lista.length} clientes</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Nivel</TableHead>
            <TableHead>Segmento</TableHead>
            <TableHead className="text-right">SKUs activos</TableHead>
            <TableHead>Último mes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((c) => (
            <TableRow key={c.id} className={c.activo ? '' : 'opacity-50'}>
              <TableCell className="font-mono text-xs">{c.nro_cliente ?? <span className="text-amber-700">sin código</span>}</TableCell>
              <TableCell><Link className="font-medium text-primary hover:underline" to={`/clientes/${c.id}`}>{c.nombre}</Link></TableCell>
              <TableCell><Badge variant={c.nivel === 'ESPECIAL' ? 'default' : c.nivel === 'NO COTIZA' ? 'baja' : 'secondary'}>{c.nivel}</Badge></TableCell>
              <TableCell>{c.segmento}</TableCell>
              <TableCell className="text-right tabular-nums">{c.skus_activos}</TableCell>
              <TableCell>{c.ultimo_mes ? nombreMes(c.ultimo_mes) : ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
