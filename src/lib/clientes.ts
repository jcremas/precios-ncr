import { mensajeError } from '@/lib/datos'
import type { Cliente } from '@/lib/tipos'

export type DatosCliente = Omit<Cliente, 'id' | 'activo'>

export const clienteVacio: DatosCliente = {
  nro_cliente: '', segmento: '', nombre: '', contacto: '', email: '', condicion_pago: '', nivel: 'LISTA', observaciones: '',
}

export function traducirError(e: unknown) {
  const m = mensajeError(e)
  if (m.includes('clientes_nombre_unico')) return 'Ya existe un cliente con ese nombre.'
  if (m.includes('clientes_nro_cliente_key')) return 'Ya existe un cliente con ese código.'
  return m
}
