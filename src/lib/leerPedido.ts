/** Lectura de pedidos por reglas, sin IA: compara cada línea del pedido con
 *  la descripción, el color y los "Otros nombres" de cada SKU. Es instantánea
 *  y siempre da el mismo resultado. */

export interface SkuParaLeer {
  sku: number
  descripcion: string
  color?: string | null
  sinonimos?: string | null
  unidades_pallet: number | null
  estado: string
}

export interface FilaLeida {
  texto: string
  sku: number | null
  pallets: number | null
  botellas: number | null
  confianza: 'alta' | 'media' | 'baja'
  nota: string | null
}

/** Palabras que no ayudan a distinguir productos. */
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'x', 'por', 'para', 'en', 'a',
  'botella', 'botellas', 'pallet', 'pallets', 'palet', 'palets', 'pal', 'plt', 'unidades', 'unidad', 'u', 'un', 'unid',
  'boca', 'tapa', 'ml', 'cc', 'cm3', 'gr', 'g', 'tipo', 'modelo', 'envase', 'envases'])

/** Formas equivalentes comunes (a la izquierda lo que puede venir, a la derecha cómo se compara). */
const EQUIVALENTES: Record<string, string> = {
  blanca: 'blanco', flint: 'blanco', transparente: 'blanco', cristal: 'blanco',
  verdes: 'verde', ambar: 'ambar', caramelo: 'ambar', bordelesa: 'burdeos', bordeles: 'burdeos',
  conica: 'conica', rosca: 'rosca', corcho: 'corcho',
}

/** Sin acentos, en minúsculas, números separados de letras ("750cc" -> "750 cc"). */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

function palabras(t: string): string[] {
  return normalizar(t).split(' ').filter((p) => p && !VACIAS.has(p)).map((p) => EQUIVALENTES[p] ?? p)
}

/** "3.402" / "3402" -> 3402 */
const entero = (t: string) => Number(t.replace(/[.\s]/g, ''))

function cantidades(linea: string) {
  const n = linea.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const pal = n.match(/(\d+(?:[.,]\d+)?)\s*(?:pallets?|palets?|pal|plt)\b/)
  const bot = n.match(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:botellas?|unidades|unid|u\b|frascos?)/)
  return {
    pallets: pal ? Number(pal[1].replace(',', '.')) : null,
    botellas: bot ? entero(bot[1]) : null,
  }
}

interface Clave { sku: SkuParaLeer; desc: string[]; frases: string[] }

function preparar(catalogo: SkuParaLeer[]): Clave[] {
  return catalogo.filter((s) => s.estado === 'ACTIVO').map((s) => ({
    sku: s,
    desc: [...new Set([...palabras(s.descripcion), ...palabras(s.color ?? '')])],
    frases: (s.sinonimos ?? '').split(/[,;]/).map((x) => palabras(x).join(' ')).filter(Boolean),
  }))
}

/** Puntaje 0..1+: qué parte de la descripción aparece en la línea, más los otros nombres que coinciden. */
function puntaje(c: Clave, enLinea: Set<string>, lineaPlana: string) {
  let total = 0
  let ok = 0
  for (const p of c.desc) {
    const peso = /^\d+$/.test(p) ? 2 : 1 // la capacidad (750) pesa más
    total += peso
    if (enLinea.has(p)) ok += peso
  }
  const base = total ? ok / total : 0
  const extra = c.frases.filter((f) => ` ${lineaPlana} `.includes(` ${f} `)).length * 0.35
  return base + extra
}

export function leerPedidoPorReglas(texto: string, catalogo: SkuParaLeer[]): FilaLeida[] {
  const claves = preparar(catalogo)
  const filas: FilaLeida[] = []
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim()
    if (!limpia) continue
    const ps = palabras(limpia)
    const enLinea = new Set(ps)
    const plana = ps.join(' ')
    const { pallets: palletsTexto, botellas } = cantidades(limpia)
    const ranking = claves.map((c) => ({ c, v: puntaje(c, enLinea, plana) })).sort((a, b) => b.v - a.v)
    const [mejor, segundo] = ranking
    // Línea sin cantidades ni parecido a ningún producto: saludo, firma, etc.
    if ((!mejor || mejor.v < 0.34) && palletsTexto == null && botellas == null) continue

    let sku: number | null = null
    let confianza: FilaLeida['confianza'] = 'baja'
    let nota: string | null = null
    if (mejor && mejor.v >= 0.5) {
      sku = mejor.c.sku.sku
      const margen = mejor.v - (segundo?.v ?? 0)
      confianza = mejor.v >= 0.75 && margen >= 0.12 ? 'alta' : 'media'
      if (margen < 0.12 && segundo) nota = `Parecido a ${segundo.c.sku.sku} · ${segundo.c.sku.descripcion}`
    } else {
      nota = 'No se reconoció el producto. Elegilo a mano o cargá sus "Otros nombres" en SKUs.'
    }

    let pallets = palletsTexto
    const up = sku != null ? mejor.c.sku.unidades_pallet : null
    if (pallets == null && botellas != null && up) pallets = Math.round((botellas / up) * 100) / 100
    filas.push({ texto: limpia, sku, pallets, botellas, confianza, nota })
  }
  return filas
}
