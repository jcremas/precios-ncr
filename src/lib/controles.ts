import { UMBRAL_AUMENTO_ATIPICO } from '@/lib/formato'

/** Controles al guardar precios: avisos que se pueden confirmar ("Guardar igual"), no bloqueos. */

export interface PrecioARevisar {
  /** Cómo se muestra en el aviso: ej. "11008938 Bordelesa 750 cc" o "CLIENTE · SKU …". */
  etiqueta: string
  nuevo: number
  /** Último precio antes de este mes (o null si no hay). */
  anterior?: number | null
  anteriorMes?: string | null
  /** Precio piso de la lista general (o null si no hay). */
  minimo?: number | null
}

export type TipoAviso = 'minimo' | 'suba' | 'baja'

export interface Aviso extends PrecioARevisar {
  tipo: TipoAviso
  /** Variación contra el anterior, en %. */
  variacion: number | null
}

export interface OpcionesControl {
  /** Avisar si sube más que esto (%). Por defecto UMBRAL_AUMENTO_ATIPICO (30). */
  suba?: number
  /** Avisar si baja más que esto (%). 0 = cualquier baja. */
  baja?: number
  /** Controlar el mínimo (en competencia no aplica: el precio es de ellos). */
  minimo?: boolean
}

/** Devuelve los avisos de una tanda de precios a guardar. Un mismo precio puede tener dos (ej. baja y bajo el mínimo). */
export function revisarPrecios(items: PrecioARevisar[], op: OpcionesControl = {}): Aviso[] {
  const suba = op.suba ?? UMBRAL_AUMENTO_ATIPICO
  const baja = op.baja ?? 0
  const salida: Aviso[] = []
  for (const it of items) {
    if (!(it.nuevo > 0)) continue
    const variacion = it.anterior ? (it.nuevo / it.anterior - 1) * 100 : null
    if (op.minimo !== false && it.minimo != null && it.minimo > 0 && it.nuevo < it.minimo) salida.push({ ...it, tipo: 'minimo', variacion })
    // Con una tolerancia mínima para no avisar por redondeos (ej. 300,15 → 300,1).
    if (variacion != null && variacion > suba + 1e-9) salida.push({ ...it, tipo: 'suba', variacion })
    if (variacion != null && variacion < -baja - 1e-9 && it.nuevo < it.anterior! - 0.051) salida.push({ ...it, tipo: 'baja', variacion })
  }
  return salida
}
