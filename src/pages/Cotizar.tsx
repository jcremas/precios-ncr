import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { copiarTabla } from '@/lib/copiar'
import { bajar, destinatarios, emlDeCliente, leerPlantilla, nombreArchivo } from '@/lib/correo'
import { filaEnvio, registrarEnvios } from '@/lib/envios'
import { nombreMes, precio } from '@/lib/formato'
import { MODALIDADES, nombreModalidad, type Cliente, type Modalidad } from '@/lib/tipos'
import { useNiveles } from '@/lib/niveles'
import PegarPedido from '@/components/PegarPedido'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Ayuda } from '@/components/Ayuda'

interface Linea { sku: number; descripcion: string; precio: number; mes: string; origen: string; pallet?: number | null; peso?: number | null }

const fmtUnidades = new Intl.NumberFormat('es-AR')
const fmtPpt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** PPT miles = (precio / peso de la botella en gramos) × 1000. Solo pantalla: no va en la copia ni en el correo. */
function pptMiles(l: Linea): string {
  const peso = Number(l.peso)
  return l.peso && peso > 0 ? fmtPpt.format((Number(l.precio) / peso) * 1000) : '—'
}

export default function Cotizar() {
  const { nombre: nombreNivel } = useNiveles()
  const [clientes, setClientes] = useState<Pick<Cliente, 'id' | 'nombre' | 'nivel_id' | 'nro_cliente' | 'modalidad' | 'cotiza' | 'contacto' | 'email' | 'condicion_pago' | 'empaque_consignado'>[]>([])
  // /cotizar?cliente=ID (desde la ficha del cliente) entra con ese cliente elegido.
  const [params] = useSearchParams()
  const [id, setId] = useState(params.get('cliente') ?? '')
  const [modalidad, setModalidad] = useState<Modalidad | ''>('')
  const [meses, setMeses] = useState<string[]>([])
  const [mes, setMes] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [verPedido, setVerPedido] = useState(false)
  const [correoListo, setCorreoListo] = useState(false)
  const [avisoRegistro, setAvisoRegistro] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('clientes').select('id, nombre, nivel_id, nro_cliente, modalidad, cotiza, contacto, email, condicion_pago, empaque_consignado').eq('activo', true).order('nombre')
      .then(({ data }) => setClientes(data ?? []))
  }, [])

  const cliente = clientes.find((c) => String(c.id) === id)
  const visibles = clientes.filter((c) => !modalidad || c.modalidad === modalidad)

  // Al elegir cliente: sus meses cotizables, del más nuevo al más viejo.
  useEffect(() => {
    setMeses([])
    setMes('')
    setLineas([])
    setAviso(null)
    setCopiado(false)
    if (!cliente) return
    if (!cliente.cotiza) return setAviso('Este cliente está marcado como NO COTIZA.')
    let vigente = true
    supabase.rpc('meses_cotizables', { p_cliente_id: cliente.id }).then(({ data, error }) => {
      if (!vigente) return
      if (error) return setAviso(mensajeError(error))
      const lista = ((data ?? []) as { mes: string }[]).map((x) => x.mes)
      setMeses(lista)
      if (lista.length) setMes(lista[0])
      else setAviso(cliente.modalidad === 'ESPECIAL' ? 'Este cliente todavía no tiene precios cargados.' : 'No hay lista general cargada ni precios guardados para este cliente.')
    })
    return () => { vigente = false }
  }, [cliente])

  // Al elegir mes: solo los precios de ese mes.
  useEffect(() => {
    setLineas([])
    setCopiado(false)
    setCorreoListo(false)
    setAvisoRegistro(null)
    if (!cliente || !mes || !meses.includes(mes)) return
    let vigente = true
    Promise.all([cotizar(cliente, mes), supabase.from('skus').select('sku, unidades_pallet, peso')]).then(([{ lineas, error }, s]) => {
      if (!vigente) return
      if (error) return setAviso(error)
      setAviso(lineas.length ? null : 'El cliente no tiene SKUs tildados con precio en ese mes.')
      const datos = new Map((s.data ?? []).map((x) => [x.sku, x as { unidades_pallet: number | null; peso: number | null }]))
      setLineas(lineas.map((l) => ({ ...l, pallet: datos.get(l.sku)?.unidades_pallet ?? null, peso: datos.get(l.sku)?.peso ?? null })))
    })
    return () => { vigente = false }
  }, [cliente, mes, meses])

  /** Solo los precios del mes elegido (no se mezclan meses). */
  async function cotizar(c: NonNullable<typeof cliente>, m: string): Promise<{ lineas: Linea[]; error?: string }> {
    const { data, error } = await supabase.rpc('cotizar', { p_cliente_id: c.id, p_mes: m })
    if (error) return { lineas: [], error: mensajeError(error) }
    return { lineas: (data ?? []) as Linea[] }
  }

  async function copiar() {
    const pallet = (l: Linea) => (l.pallet ? fmtUnidades.format(l.pallet) : '')
    await copiarTabla(
      `Lista de precios - ${cliente?.nombre ?? ''}`,
      [{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Precio', derecha: true }, { titulo: 'Unid./pallet', derecha: true }],
      lineas.map((l) => [String(l.sku), l.descripcion, precio(Number(l.precio)), pallet(l)]),
      // Texto de respaldo (programas que no aceptan formato): una línea por SKU.
      ([sku, desc, p, u]) => [sku, desc, p, u ? `${u} u/pallet` : null].filter(Boolean).join(' · '),
    )
    setCopiado(true)
  }

  /** Baja un correo (.eml) que Outlook abre como mensaje nuevo, listo para Enviar. */
  async function correo() {
    if (!cliente) return
    const plantilla = leerPlantilla()
    const datos = { cliente: cliente.nombre, contacto: cliente.contacto, email: cliente.email, condicion_pago: cliente.condicion_pago, empaque_consignado: cliente.empaque_consignado, mes, lineas }
    bajar(nombreArchivo(cliente.nombre, mes), emlDeCliente(datos, plantilla))
    setCorreoListo(true)
    // Queda en el historial de listas enviadas (ficha del cliente y Enviar listas).
    setAvisoRegistro(await registrarEnvios([filaEnvio(cliente.id, datos, plantilla, 'cotizar')]))
  }

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Cotizar a un cliente</CardTitle>
          <Ayuda resumen="Elegí el cliente y el mes: muestra solo los precios de ese mes, listos para copiar o armar el correo.">
            <p>No mezcla meses (de entrada, el más nuevo). Si un SKU no tiene precio ese mes o está en cero, no se cotiza. Solo van los SKUs tildados del cliente.</p>
            <p>Especial: su lista de ese mes. Genérico: sus precios guardados ese mes o, si no hay, la lista general de ese mes menos el descuento de su nivel. No cotiza: bloqueado.</p>
          </Ayuda>
        </CardHeader>
        <CardContent className="grid max-w-4xl gap-4 md:grid-cols-[180px_1fr_190px]">
          <div className="grid gap-2">
            <Label htmlFor="mod">Tipo de cliente</Label>
            <Select id="mod" value={modalidad} onChange={(e) => setModalidad(e.target.value as Modalidad | '')}>
              <option value="">Todos ({clientes.length})</option>
              {MODALIDADES.map((m) => <option key={m} value={m}>{m === 'GENERICO' ? 'Genéricos' : 'Especiales'} ({clientes.filter((c) => c.modalidad === m).length})</option>)}
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cli">Cliente (escribí parte del nombre o del código)</Label>
            <Combobox id="cli" value={id} onChange={setId} placeholder={`Buscar entre ${visibles.length} clientes…`}
              opciones={visibles.map((c) => ({
                value: String(c.id),
                label: c.nombre,
                detalle: [c.nro_cliente, `${nombreModalidad(c.modalidad)}${c.nivel_id != null ? ` ${nombreNivel(c.nivel_id)}` : ''}`, c.cotiza ? null : 'NO COTIZA'].filter(Boolean).join(' · '),
              }))} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mes">Mes</Label>
            <Select id="mes" value={mes} onChange={(e) => setMes(e.target.value)} disabled={!meses.length}>
              {!meses.length && <option value="">—</option>}
              {meses.map((m, i) => <option key={m} value={m}>{nombreMes(m)}{i === 0 ? ' (último)' : ''}</option>)}
            </Select>
          </div>
        </CardContent>
      </Card>

      {aviso && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{aviso}</p>}

      {lineas.length > 0 && (
        <div className="grid gap-3 [&>*]:min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>{cliente && nombreModalidad(cliente.modalidad)}{cliente?.nivel_id != null ? ` · ${nombreNivel(cliente.nivel_id)}` : ''}</Badge>
            <span className="text-sm text-muted-foreground">Precios de {nombreMes(lineas[0].mes)} · {lineas.length} SKU(s)</span>
            <Button className="sm:ml-auto" variant={verPedido ? 'secondary' : 'outline'} onClick={() => setVerPedido(!verPedido)}>Pegar pedido</Button>
            <Button variant="outline" onClick={copiar}>{copiado ? 'Copiado ✓ Pegalo en el correo' : 'Copiar para enviar'}</Button>
            <Button variant="outline" onClick={correo}
              title={cliente && destinatarios(cliente.email).length ? `Para: ${destinatarios(cliente.email).join(', ')}` : 'El cliente no tiene email cargado: completalo en Outlook'}>
              {correoListo ? 'Correo bajado ✓ Abrilo' : 'Correo para Outlook'}
            </Button>
          </div>
          {correoListo && (
            <p className="text-sm text-muted-foreground">
              Abrí el archivo que bajó el navegador: se abre en Outlook como mensaje nuevo, listo para revisar y apretar Enviar.
              {cliente && !destinatarios(cliente.email).length && ' Este cliente no tiene email cargado: escribilo en el campo Para.'}
              {' '}El texto del correo se cambia en Enviar listas.
              {!avisoRegistro && ' Quedó registrado en la ficha del cliente; si al final no lo mandás, marcalo ahí como "No se envió".'}
            </p>
          )}
          {avisoRegistro && <p className="text-sm text-amber-800">{avisoRegistro}</p>}
          {verPedido && cliente && <PegarPedido clienteNombre={cliente.nombre} mes={mes} precios={lineas} />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Unid./pallet</TableHead>
                <TableHead className="text-right" title="(Precio / peso de la botella en gramos) × 1000. Solo se ve acá: no sale en la copia ni en el correo.">PPT miles</TableHead>
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
                  <TableCell className="text-right tabular-nums">{pptMiles(l)}</TableCell>
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
