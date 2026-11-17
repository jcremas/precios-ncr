import { supabase } from '@/lib/supabase'
import type { PrecioCliente } from '@/lib/tipos'

/** Supabase devuelve como máximo 1000 filas por pedido: esto trae todas. */
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
    let q = supabase.from('precios_cliente').select('cliente_id, sku, mes, precio').order('mes')
    if (ids) q = q.in('cliente_id', ids)
    return q.range(d, h)
  })
}

export function mensajeError(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message)
  return String(e)
}
