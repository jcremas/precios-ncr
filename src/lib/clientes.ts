import { mensajeError } from '@/lib/datos'
import type { Cliente } from '@/lib/tipos'

export type DatosCliente = Omit<Cliente, 'id' | 'activo' | 'dueno'>

export const clienteVacio: DatosCliente = {
  nro_cliente: '', segmento: '', nombre: '', contacto: '', email: '', condicion_pago: '',
  empaque_consignado: false, marca_principal: '',
  modalidad: 'GENERICO', nivel_id: null, cotiza: true, observaciones: '',
}

const CAMPOS: (keyof DatosCliente)[] = [
  'nro_cliente', 'segmento', 'nombre', 'contacto', 'email', 'condicion_pago',
  'empaque_consignado', 'marca_principal',
  'modalidad', 'nivel_id', 'cotiza', 'observaciones',
]

/** Solo los campos editables (sin id ni fechas), para guardar en la base. */
export function soloDatos(d: DatosCliente): DatosCliente {
  return Object.fromEntries(CAMPOS.map((k) => [k, d[k]])) as DatosCliente
}

/** Emails separados por ";" (también acepta "," o espacios). Devuelve el texto
 *  normalizado "a@x.com; b@y.com" o el primer email inválido. */
export function normalizarEmails(t: string | null): { ok: string | null } | { malo: string } {
  const lista = (t ?? '').split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean)
  const malo = lista.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
  if (malo) return { malo }
  return { ok: lista.length ? lista.map((x) => x.toLowerCase()).join('; ') : null }
}

export function traducirError(e: unknown) {
  const m = mensajeError(e)
  if (m.includes('clientes_nombre_unico')) return 'Ya existe un cliente con ese nombre.'
  if (m.includes('clientes_nro_cliente_key')) return 'Ya existe un cliente con ese código.'
  if (m.includes('clientes_condicion_pago_30')) return 'La condición de pago admite hasta 30 caracteres (falta correr la migración 0012 para llevarla a 50).'
  if (m.includes('clientes_condicion_pago_50')) return 'La condición de pago admite hasta 50 caracteres.'
  if (m.includes('clientes_generico_con_nivel')) return 'Un cliente genérico que cotiza necesita su nivel de descuento.'
  return m
}
