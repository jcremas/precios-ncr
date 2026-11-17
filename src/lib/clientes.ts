import { mensajeError } from '@/lib/datos'
import type { Cliente } from '@/lib/tipos'

export type DatosCliente = Omit<Cliente, 'id' | 'activo'>

export const clienteVacio: DatosCliente = {
  nro_cliente: '', segmento: '', nombre: '', contacto: '', email: '', condicion_pago: '',
  modalidad: 'GENERICO', nivel: 'LISTA', cotiza: true, observaciones: '',
}

const CAMPOS: (keyof DatosCliente)[] = [
  'nro_cliente', 'segmento', 'nombre', 'contacto', 'email', 'condicion_pago',
  'modalidad', 'nivel', 'cotiza', 'observaciones',
]

/** Solo los campos editables (sin id ni fechas), para guardar en la base. */
export function soloDatos(d: DatosCliente): DatosCliente {
  return Object.fromEntries(CAMPOS.map((k) => [k, d[k]])) as DatosCliente
}

export function traducirError(e: unknown) {
  const m = mensajeError(e)
  if (m.includes('clientes_nombre_unico')) return 'Ya existe un cliente con ese nombre.'
  if (m.includes('clientes_nro_cliente_key')) return 'Ya existe un cliente con ese código.'
  if (m.includes('clientes_generico_con_nivel')) return 'Un cliente genérico que cotiza necesita su nivel de descuento.'
  return m
}
