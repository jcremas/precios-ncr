const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC']

/** '2026-05-01' -> 'MAY 2026' */
export function nombreMes(iso: string): string {
  const [a, m] = iso.split('-')
  return `${MESES[Number(m) - 1]} ${a}`
}

/** '2026-05-01' -> '2026-06-01' */
export function mesSiguiente(iso: string): string {
  const [a, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(a, m, 1))
  return d.toISOString().slice(0, 10)
}

/** Mes actual como 'AAAA-MM-01' */
export function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** 'AAAA-MM' (input type=month) <-> 'AAAA-MM-01' */
export const aInputMes = (iso: string) => iso.slice(0, 7)
export const desdeInputMes = (v: string) => `${v}-01`

const fmtPrecio = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const precio = (n: number | null | undefined) => (n == null ? '' : `$ ${fmtPrecio.format(n)}`)

const fmtPct = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' })
export const pct = (n: number | null | undefined) => (n == null ? '' : `${fmtPct.format(n)}%`)

export const redondear = (n: number, dec = 2) => Math.round(n * 10 ** dec) / 10 ** dec

/** Umbral para marcar aumentos atípicos. */
export const UMBRAL_AUMENTO_ATIPICO = 30
