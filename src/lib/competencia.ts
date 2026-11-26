import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/datos'
import { mediana } from '@/lib/precios'
import type { Modalidad } from '@/lib/tipos'

/** Competidor (0015). */
export interface Competidor { id: number; nombre: string; activo: boolean; observaciones: string | null }

/** Producto de un competidor, con su nombre, vinculado a nuestro SKU equivalente (0015). */
export interface ProductoCompetencia {
  id: number
  competidor_id: number
  nombre: string
  sku: number
  activo: boolean
  observaciones: string | null
}

/** Una fila de v_competencia: precio de la competencia + nuestro precio a ese cliente. */
export interface PrecioCompetencia {
  id: number
  mes: string
  precio: number
  observaciones: string | null
  /** null = dato general de mercado (sin cliente). */
  cliente_id: number | null
  cliente: string | null
  nro_cliente: string | null
  modalidad: Modalidad | null
  dueno: string | null
  nivel: string | null
  producto_id: number
  producto: string
  competidor_id: number
  competidor: string
  sku: number
  descripcion: string
  familia: string | null
  /** Lo que le cobramos a ese cliente ese SKU ese mes (o el último mes anterior: nuestro_mes). */
  nuestro_precio: number | null
  nuestro_mes: string | null
  /** Lista general publicada vigente ese mes. */
  lista: number | null
  cargado_por_email: string | null
  actualizado_en: string
}

const num = (v: unknown) => (v == null ? null : Number(v))

export async function preciosCompetencia(): Promise<PrecioCompetencia[]> {
  const filas = await traerTodo<PrecioCompetencia>((d, h) => supabase.from('v_competencia').select('*').order('id').range(d, h))
  return filas.map((f) => ({ ...f, precio: Number(f.precio), nuestro_precio: num(f.nuestro_precio), lista: num(f.lista) }))
}

/** Nosotros contra la competencia, en %: positivo = estamos más caros. */
export const difPct = (nuestro: number | null | undefined, competencia: number | null | undefined) =>
  nuestro != null && competencia ? (nuestro / competencia - 1) * 100 : null

const promedio = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

export interface Resumen {
  clave: string
  titulo: string
  filas: PrecioCompetencia[]
  datos: number
  clientes: number
  competidores: number
  skus: number
  minimo: PrecioCompetencia
  maximo: PrecioCompetencia
  promedio: number
  mediana: number
  /** Promedio de nuestro precio, solo en las filas donde hay precio nuestro. */
  nuestroPromedio: number | null
  /** Promedio de la diferencia fila por fila (mismo cliente y SKU). */
  difPromedio: number | null
  /** Filas comparables (con precio nuestro) y en cuántas la competencia está más barata. */
  comparables: number
  competenciaMasBarata: number
  lista: number | null
}

/** Agrupa y resume (mínimo, máximo, promedio, mediana, diferencia con nosotros). */
export function resumir(filas: PrecioCompetencia[], clave: (f: PrecioCompetencia) => string, titulo: (f: PrecioCompetencia) => string): Resumen[] {
  const grupos = new Map<string, PrecioCompetencia[]>()
  for (const f of filas) {
    const k = clave(f)
    const g = grupos.get(k)
    if (g) g.push(f)
    else grupos.set(k, [f])
  }
  return [...grupos.entries()].map(([k, g]) => {
    const precios = g.map((f) => f.precio)
    const conNuestro = g.filter((f) => f.nuestro_precio != null)
    const difs = conNuestro.map((f) => difPct(f.nuestro_precio, f.precio)!)
    // La lista del mes más nuevo del grupo.
    const masNuevo = g.reduce((a, b) => (b.mes > a.mes ? b : a))
    return {
      clave: k,
      titulo: titulo(g[0]),
      filas: g,
      datos: g.length,
      clientes: new Set(g.map((f) => f.cliente_id ?? 'mercado')).size,
      competidores: new Set(g.map((f) => f.competidor_id)).size,
      skus: new Set(g.map((f) => f.sku)).size,
      minimo: g.reduce((a, b) => (b.precio < a.precio ? b : a)),
      maximo: g.reduce((a, b) => (b.precio > a.precio ? b : a)),
      promedio: promedio(precios)!,
      mediana: mediana(precios)!,
      nuestroPromedio: promedio(conNuestro.map((f) => f.nuestro_precio!)),
      difPromedio: promedio(difs),
      comparables: conNuestro.length,
      competenciaMasBarata: conNuestro.filter((f) => f.precio < f.nuestro_precio!).length,
      lista: masNuevo.lista,
    }
  })
}
