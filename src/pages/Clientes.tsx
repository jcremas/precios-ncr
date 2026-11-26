import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { nombreMes } from '@/lib/formato'
import { MODALIDADES, nombreModalidad, type IndiceCliente } from '@/lib/tipos'
import { useNiveles } from '@/lib/niveles'
import { useUsuarios } from '@/lib/usuarios'
import { clienteVacio, traducirError, type DatosCliente } from '@/lib/clientes'
import { FormCliente } from '@/components/FormCliente'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function Clientes() {
  const { niveles } = useNiveles()
  const { yo, usuarios, nombreDe } = useUsuarios()
  // '' = todos; si no, el email del dueño. Arranca en "Mis clientes".
  const [dueno, setDueno] = useState<string | null>(null)
  const duenoElegido = dueno ?? yo
  const navigate = useNavigate()
  const [lista, setLista] = useState<IndiceCliente[]>([])
  const [filtro, setFiltro] = useState('')
  const [modalidad, setModalidad] = useState('')
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
    const { data, error } = await supabase.from('clientes').insert(d).select('id').single()
    if (error) return traducirError(error)
    setNuevo(false)
    // Un especial nuevo va a su ficha para armar la primera lista.
    if (d.modalidad === 'ESPECIAL') navigate(`/clientes/${data.id}`)
    else await cargar()
    return null
  }

  const f = filtro.trim().toUpperCase()
  const visibles = lista.filter(
    (c) =>
      (!duenoElegido || c.dueno === undefined || c.dueno === duenoElegido) &&
      (!modalidad || c.modalidad === modalidad) &&
      (!nivel || (nivel === 'NO' ? !c.cotiza : c.nivel === nivel)) &&
      (!f || c.nombre.toUpperCase().includes(f) || (c.nro_cliente ?? '').toUpperCase().includes(f)),
  )

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold">Clientes</h1>
        <Input className="w-64" placeholder="Buscar por nombre o código" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <Select className="w-44" aria-label="Dueño" value={duenoElegido} onChange={(e) => setDueno(e.target.value)}>
          <option value="">Clientes de todos</option>
          {usuarios.map((u) => <option key={u.email} value={u.email}>{u.email === yo ? 'Mis clientes' : `De ${nombreDe(u.email)}`}</option>)}
        </Select>
        <Select className="w-40" value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
          <option value="">Genéricos y especiales</option>
          {MODALIDADES.map((m) => <option key={m} value={m}>{nombreModalidad(m)}s</option>)}
        </Select>
        <Select className="w-40" value={nivel} onChange={(e) => setNivel(e.target.value)}>
          <option value="">Todos los niveles</option>
          {niveles.map((n) => <option key={n.nombre}>{n.nombre}</option>)}
          <option value="NO">No cotiza</option>
        </Select>
        <Button onClick={() => setNuevo(true)}><Plus /> Nuevo cliente</Button>
      </div>

      {nuevo && (
        <Card>
          <CardHeader><CardTitle>Nuevo cliente</CardTitle></CardHeader>
          <CardContent>
            <FormCliente inicial={clienteVacio} onGuardar={crear} onCancelar={() => setNuevo(false)} />
            <p className="mt-3 text-xs text-muted-foreground">
              Si es genérico se le tildan los SKUs marcados “Genéricos” en SKUs (los de vino); si es especial, todos los activos. Después destildás en su ficha los que no se cotizan. Si es especial, en su ficha armás la primera lista a partir de la lista general. El cliente queda a tu nombre: solo vos lo modificás (los demás lo ven).
            </p>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="text-sm text-muted-foreground">{visibles.length} de {lista.length} clientes</p>
      <Table fija>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Modalidad</TableHead>
            <TableHead>Nivel</TableHead>
            <TableHead>Segmento</TableHead>
            <TableHead className="text-right">SKUs tildados</TableHead>
            <TableHead>Último mes</TableHead>
            <TableHead>Dueño</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((c) => (
            <TableRow key={c.id} className={c.activo ? '' : 'opacity-50'}>
              <TableCell className="font-mono text-xs">{c.nro_cliente ?? <span className="text-amber-700">sin código</span>}</TableCell>
              <TableCell><Link className="font-medium text-primary hover:underline" to={`/clientes/${c.id}`}>{c.nombre}</Link></TableCell>
              <TableCell>
                <Badge variant={c.modalidad === 'ESPECIAL' ? 'default' : 'secondary'}>{nombreModalidad(c.modalidad)}</Badge>
                {!c.cotiza && <Badge variant="baja" className="ml-1">No cotiza</Badge>}
              </TableCell>
              <TableCell>{c.nivel ?? ''}</TableCell>
              <TableCell>{c.segmento}</TableCell>
              <TableCell className="text-right tabular-nums">{c.skus_activos}</TableCell>
              <TableCell>{c.ultimo_mes ? nombreMes(c.ultimo_mes) : ''}</TableCell>
              <TableCell className="text-muted-foreground">{nombreDe(c.dueno)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
