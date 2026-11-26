import { Fragment, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError } from '@/lib/datos'
import { nombreMes, precio } from '@/lib/formato'
import { useUsuarios } from '@/lib/usuarios'
import { faltaMigracion, fechaHora, type ListaEnviada } from '@/lib/envios'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** Historial de listas enviadas a un cliente (ficha del cliente, 0017). */
export function ListasEnviadas({ clienteId, dueno }: { clienteId: number; dueno: string | null | undefined }) {
  const { yo, esAdmin, nombreDe } = useUsuarios()
  const [filas, setFilas] = useState<ListaEnviada[] | null>(null)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    const { data, error } = await supabase.from('listas_enviadas').select('*')
      .eq('cliente_id', clienteId).order('enviado_en', { ascending: false }).order('id', { ascending: false })
    if (error) {
      if (faltaMigracion(error)) return setSinMigracion(true)
      return setError(mensajeError(error))
    }
    setFilas((data ?? []) as ListaEnviada[])
  }
  useEffect(() => { cargar() }, [clienteId])

  async function marcar(f: ListaEnviada, descartado: boolean) {
    setError(null)
    const { error } = await supabase.from('listas_enviadas').update({ descartado }).eq('id', f.id)
    if (error) return setError(mensajeError(error))
    await cargar()
  }

  const puedeMarcar = (f: ListaEnviada) => esAdmin || f.enviado_por === yo || (dueno != null && dueno === yo)
  const origen = (o: string | null) => (o === 'cotizar' ? 'Cotizar' : o === 'enviar_listas' ? 'Enviar listas' : o ?? '')

  return (
    <div className="grid gap-3">
      <h2 className="text-lg font-semibold">Listas enviadas</h2>
      <p className="text-xs text-muted-foreground">
        Cada vez que se arma el correo para Outlook (Cotizar o Enviar listas) queda acá, con una copia de los precios que salieron.
        La app no ve si apretaste Enviar en Outlook: si al final no lo mandaste, marcalo como "No se envió" (no se borra, deja de contar como enviado).
      </p>
      {sinMigracion && <p className="text-sm text-amber-800">Para ver el historial de envíos falta correr la migración 0017 en Supabase.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {filas && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha y hora</TableHead>
              <TableHead>Lista</TableHead>
              <TableHead>Armado por</TableHead>
              <TableHead>Para</TableHead>
              <TableHead>CC</TableHead>
              <TableHead className="text-right">SKUs</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => (
              <Fragment key={f.id}>
                <TableRow className={f.descartado ? 'text-muted-foreground line-through decoration-muted-foreground/40' : ''}>
                  <TableCell className="whitespace-nowrap">{fechaHora(f.enviado_en)}</TableCell>
                  <TableCell className="whitespace-nowrap font-medium">{nombreMes(f.mes)}</TableCell>
                  <TableCell className="whitespace-nowrap" title={origen(f.origen)}>{nombreDe(f.enviado_por)}</TableCell>
                  <TableCell className="max-w-56 truncate" title={f.para ?? ''}>{f.para || <Badge variant="outline">sin email</Badge>}</TableCell>
                  <TableCell className="max-w-56 truncate text-xs" title={f.cc ?? ''}>{f.cc}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.cantidad_skus}</TableCell>
                  <TableCell className="whitespace-nowrap no-underline">
                    {f.descartado
                      ? <span title={f.descartado_en ? `Marcado por ${nombreDe(f.descartado_por)} el ${fechaHora(f.descartado_en)}` : undefined}><Badge variant="baja">No se envió</Badge></span>
                      : <Badge variant="secondary">Armado</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => setAbierto(abierto === f.id ? null : f.id)}>{abierto === f.id ? 'Ocultar precios' : 'Ver precios'}</Button>
                    {puedeMarcar(f) && (
                      <Button variant="ghost" size="sm" onClick={() => marcar(f, !f.descartado)}>{f.descartado ? 'Sí se envió' : 'No se envió'}</Button>
                    )}
                  </TableCell>
                </TableRow>
                {abierto === f.id && (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-muted/40">
                      {f.asunto && <p className="mb-2 text-sm"><span className="text-muted-foreground">Asunto:</span> {f.asunto}</p>}
                      <table className="text-sm">
                        <tbody>
                          {f.precios.map((p) => (
                            <tr key={p.sku}>
                              <td className="pr-4 font-mono text-xs">{p.sku}</td>
                              <td className="pr-6">{p.descripcion}</td>
                              <td className="text-right tabular-nums">{precio(Number(p.precio))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {!filas.length && (
              <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Todavía no se armó ningún correo para este cliente.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
