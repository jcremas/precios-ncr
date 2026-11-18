import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { nombreMes, precio } from '@/lib/formato'
import { MODALIDADES, nombreModalidad, type Cliente, type Modalidad } from '@/lib/tipos'
import { useNiveles } from '@/lib/niveles'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Linea { sku: number; descripcion: string; precio: number; mes: string; origen: string; pallet?: number | null }

const fmtUnidades = new Intl.NumberFormat('es-AR')

export default function Cotizar() {
  const { nombre: nombreNivel } = useNiveles()
  const [clientes, setClientes] = useState<Pick<Cliente, 'id' | 'nombre' | 'nivel_id' | 'nro_cliente' | 'modalidad' | 'cotiza'>[]>([])
  const [id, setId] = useState('')
  const [modalidad, setModalidad] = useState<Modalidad | ''>('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    supabase.from('clientes').select('id, nombre, nivel_id, nro_cliente, modalidad, cotiza').eq('activo', true).order('nombre')
      .then(({ data }) => setClientes(data ?? []))
  }, [])

  const cliente = clientes.find((c) => String(c.id) === id)
  const visibles = clientes.filter((c) => !modalidad || c.modalidad === modalidad)

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
      if (!lineas.length) setAviso(cliente.modalidad === 'ESPECIAL' ? 'Este cliente todavía no tiene precios cargados.' : 'El cliente no tiene SKUs tildados en la última lista general ni precios guardados.')
    })
  }, [cliente])

  /** Solo los precios del mes más nuevo (no se mezclan meses).
   *  Genérico: última lista general menos su descuento (o, si no hay lista,
   *  sus precios guardados del último mes). Especial: su último mes. */
  async function cotizar(c: NonNullable<typeof cliente>): Promise<{ lineas: Linea[]; error?: string }> {
    const { data, error } = await supabase.rpc('cotizar', { p_cliente_id: c.id })
    if (error) return { lineas: [], error: mensajeError(error) }
    return { lineas: (data ?? []) as Linea[] }
  }

  async function copiar() {
    const titulo = `Lista de precios - ${cliente?.nombre ?? ''}`
    const pallet = (l: Linea) => (l.pallet ? fmtUnidades.format(l.pallet) : '')
    // Texto de respaldo (programas que no aceptan formato): una línea por SKU.
    const texto = [
      titulo,
      '',
      ...lineas.map((l) => [l.sku, l.descripcion, precio(Number(l.precio)), l.pallet ? `${pallet(l)} u/pallet` : null]
        .filter(Boolean).join(' · ')),
    ].join('\n')
    // Tabla compacta con estilos en línea, que Outlook respeta al pegar.
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const celda = 'padding:3px 8px;border:1px solid #d0d7e2;'
    const cab = `${celda}background:#1f3a5f;color:#ffffff;font-weight:bold;`
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#222222;">
<p style="margin:0 0 6px 0;font-size:11pt;font-weight:bold;color:#1f3a5f;">${esc(titulo)}</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:10pt;">
<tr><th style="${cab}text-align:left;">SKU</th><th style="${cab}text-align:left;">Producto</th><th style="${cab}text-align:right;">Precio</th><th style="${cab}text-align:right;">Unid./pallet</th></tr>
${lineas.map((l, i) => {
  const fondo = i % 2 ? 'background:#f3f6fa;' : 'background:#ffffff;'
  return `<tr><td style="${celda}${fondo}">${l.sku}</td><td style="${celda}${fondo}">${esc(l.descripcion)}</td><td style="${celda}${fondo}text-align:right;white-space:nowrap;">${esc(precio(Number(l.precio)))}</td><td style="${celda}${fondo}text-align:right;">${pallet(l)}</td></tr>`
}).join('\n')}
</table></div>`
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      })])
    } catch {
      await navigator.clipboard.writeText(texto)
    }
    setCopiado(true)
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Cotizar a un cliente</CardTitle>
          <CardDescription>Solo los precios del mes más nuevo, sin mezclar meses: si un SKU no tiene precio ese mes, no se cotiza. Genérico: última lista general menos el descuento de su nivel. Especial: su último mes cargado. No cotiza: bloqueado. Solo SKUs tildados.</CardDescription>
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
            <Label htmlFor="cli">Cliente (escribí parte del nombre o del código)</Label>
            <Combobox id="cli" value={id} onChange={setId} placeholder={`Buscar entre ${visibles.length} clientes…`}
              opciones={visibles.map((c) => ({
                value: String(c.id),
                label: c.nombre,
                detalle: [c.nro_cliente, `${nombreModalidad(c.modalidad)}${c.nivel_id != null ? ` ${nombreNivel(c.nivel_id)}` : ''}`, c.cotiza ? null : 'NO COTIZA'].filter(Boolean).join(' · '),
              }))} />
          </div>
        </CardContent>
      </Card>

      {aviso && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{aviso}</p>}

      {lineas.length > 0 && (
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <Badge>{cliente && nombreModalidad(cliente.modalidad)}{cliente?.nivel_id != null ? ` · ${nombreNivel(cliente.nivel_id)}` : ''}</Badge>
            <span className="text-sm text-muted-foreground">Precios de {nombreMes(lineas[0].mes)} · {lineas.length} SKU(s)</span>
            <Button className="ml-auto" variant="outline" onClick={copiar}>{copiado ? 'Copiado ✓ Pegalo en el correo' : 'Copiar para enviar'}</Button>
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
