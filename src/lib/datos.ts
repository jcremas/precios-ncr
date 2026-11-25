import { supabase } from '@/lib/supabase'
import type { ListaGeneral, PrecioCliente } from '@/lib/tipos'

/** Supabase devuelve como máximo 1000 filas por pedido: esto trae todas.
 *  IMPORTANTE: el pedido tiene que estar ordenado por columnas que no se
 *  repitan (ej. mes + cliente + SKU). Si no, al pedir por partes se pueden
 *  saltear o repetir filas. */
export async function traerTodo<T>(armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const salida: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await armar(desde, desde + 999)
    if (error) throw error
    salida.push(...(data ?? []))
    if (!data || data.length < 1000) return salida
  }
}

export async function preciosDeClientes(ids?: number[]) {
  return traerTodo<PrecioCliente>((d, h) => {
    let q = supabase.from('precios_cliente').select('cliente_id, sku, mes, precio').order('mes').order('cliente_id').order('sku')
    if (ids) q = q.in('cliente_id', ids)
    return q.range(d, h)
  })
}

/** Toda la lista general (todos los meses), sin el tope de 1000 filas. */
export async function listasGenerales() {
  return traerTodo<ListaGeneral>((d, h) =>
    supabase.from('lista_general').select('mes, sku, precio, precio_minimo').order('mes').order('sku').range(d, h))
}

/** Mapa SKU × cliente (solo tildados), sin el tope de 1000 filas. */
export async function grillasActivas(ids?: number[]) {
  return traerTodo<{ cliente_id: number; sku: number }>((d, h) => {
    let q = supabase.from('cliente_skus').select('cliente_id, sku').eq('activo', true)
    if (ids) q = q.in('cliente_id', ids)
    return q.order('cliente_id').order('sku').range(d, h)
  })
}

export function mensajeError(e: unknown): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e)
  // Permisos de la base (multiusuario, 0013).
  if (/row-level security|row level security/i.test(m))
    return 'No tenés permiso para modificar esto: los clientes y sus precios los modifica solo su dueño; la lista general, los SKUs y los niveles, solo el administrador.'
  return m
}
