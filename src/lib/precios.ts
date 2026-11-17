import { DESCUENTOS, type ListaGeneral, type Nivel } from '@/lib/tipos'

/** Igual que la función precio_con_descuento de la base: 1 decimal. */
export function precioConDescuento(lista: number, nivel: Nivel, admiteDescuento: boolean): number {
  if (!admiteDescuento) return lista
  return Math.round((lista * (1 - DESCUENTOS[nivel] / 100) + 1e-9) * 10) / 10
}

/** Lista vigente a un mes: para cada SKU, la última cargada en ese mes o antes. */
export function listaVigente(listas: ListaGeneral[], mes: string): Map<number, ListaGeneral> {
  const salida = new Map<number, ListaGeneral>()
  for (const l of listas) {
    if (l.mes > mes) continue
    const actual = salida.get(l.sku)
    if (!actual || actual.mes < l.mes) salida.set(l.sku, l)
  }
  return salida
}

export function mediana(valores: number[]): number | null {
  if (!valores.length) return null
  const v = [...valores].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Descarga filas como CSV que Excel abre bien en español (separador ; y coma decimal). */
export function exportarExcel(nombre: string, columnas: string[], filas: (string | number | null | undefined)[][]) {
  const celda = (v: string | number | null | undefined) => {
    if (v == null) return ''
    if (typeof v === 'number') return String(v).replace('.', ',')
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  const texto = '﻿' + [columnas, ...filas].map((f) => f.map(celda).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
