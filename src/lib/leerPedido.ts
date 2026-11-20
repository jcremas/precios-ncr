/** Lectura de pedidos por reglas, sin IA. Es instantánea y siempre da el mismo
 *  resultado. Usa expresiones regulares para:
 *   - cantidades: "3 pallets", "3 pal", "3.402 botellas", "6000 u."
 *   - atributos: color (verde = oliva, blanca = flint = blanco…), boca
 *     (tapón = corcho, rosca, corona, pilfer), línea (liviana = eco, pesada,
 *     premium) y capacidad (750, 750cc, 0,75 l).
 *  Y un puntaje por palabras clave contra la descripción, el color, la familia
 *  y los "Otros nombres" de cada SKU. Si un atributo del pedido contradice al
 *  SKU (pidió tapón y el SKU es rosca), ese SKU queda muy abajo. */

export interface SkuParaLeer {
  sku: number
  descripcion: string
  familia?: string | null
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
  /** Otros SKUs posibles, del más al menos parecido. */
  alternativas?: number[]
}

/** Atributos que se reconocen con expresiones regulares (sobre texto ya normalizado). */
const ATRIBUTOS: Record<string, [string, RegExp][]> = {
  color: [
    ['oliva', /\b(oliva|verde|verdes|vde|green)\b/],
    ['blanco', /\b(blanc[oa]s?|flint|transparente|cristal|bco|bca)\b/],
    ['ambar', /\b(ambar|amb|caramelo|marron)\b/],
    ['esmeralda', /\b(esmeralda|esm|verde claro)\b/],
  ],
  boca: [
    ['tapon', /\b(tapon|tapones|corcho|corchos|boca corcho|bc)\b/],
    ['rosca', /\b(rosca|tapa rosca|screw|bvs|stelvin)\b/],
    ['corona', /\b(corona|crown)\b/],
    ['pilfer', /\b(pilfer|pp)\b/],
  ],
  linea: [
    ['eco', /\b(eco|liviana|liviano|livianas|light|lite)\b/],
    ['pesada', /\b(pesada|pesado|heavy)\b/],
    ['premium', /\b(premium)\b/],
  ],
}

/** Palabras sueltas que significan lo mismo (a la derecha, cómo se compara). */
const EQUIVALENTES: Record<string, string> = {
  bordalesa: 'burdeos', bordelesa: 'burdeos', bordeles: 'burdeos', bordeaux: 'burdeos',
  borgona: 'borgona', bourgogne: 'borgona', burgundy: 'borgona',
  conicas: 'conica', cerv: 'cerveza', cervezas: 'cerveza', espumantes: 'espumante', champagne: 'espumante',
}

/** Palabras que no ayudan a distinguir productos. */
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'c', 'y', 'x', 'por', 'para', 'en', 'a', 'al',
  'botella', 'botellas', 'pallet', 'pallets', 'palet', 'palets', 'pal', 'plt', 'unidades', 'unidad', 'u', 'un', 'unid',
  'boca', 'tapa', 'ml', 'cc', 'cm', 'l', 'lt', 'gr', 'g', 'tipo', 'modelo', 'envase', 'envases', 'frasco', 'frascos',
  'necesito', 'pedido', 'quiero', 'mandar', 'enviar', 'favor', 'cotizar', 'precio', 'nr', 'cna', 'generica', 'generico'])

/** Sin acentos, en minúsculas, números separados de letras ("750cc" -> "750 cc"). */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Atributos (color, boca, línea) y capacidad encontrados en un texto normalizado. */
function atributos(n: string): Record<string, string> {
  const r: Record<string, string> = {}
  for (const [grupo, opciones] of Object.entries(ATRIBUTOS)) {
    const hit = opciones.find(([, re]) => re.test(n))
    if (hit) r[grupo] = hit[0]
  }
  // Capacidad: 750 / 1125 / 355 / 0,75 l / 1 l.
  const cap = n.match(/\b(\d{3,4})\b/) ?? null
  if (cap) r.capacidad = cap[1]
  else {
    const litros = n.match(/\b(\d+)\s(\d+)?\s?(?:l|lt|litros?)\b/)
    if (litros) r.capacidad = String(Math.round(Number(`${litros[1]}.${litros[2] ?? 0}`) * 1000))
  }
  return r
}

/** Quita las palabras de atributos (ya se compararon aparte) y las vacías. */
function palabrasClave(n: string): string[] {
  let t = ` ${n} `
  for (const opciones of Object.values(ATRIBUTOS)) for (const [, re] of opciones) t = t.replace(new RegExp(re.source, 'g'), ' ')
  return t.split(' ').filter((p) => p && !VACIAS.has(p) && !/^\d+$/.test(p) && !(p in NUMEROS)).map((p) => EQUIVALENTES[p] ?? p)
}

/** "3.402" / "3402" -> 3402 */
const entero = (t: string) => Number(t.replace(/[.\s]/g, ''))

/** Cantidades con expresiones regulares (sobre el texto original, sin acentos). */
/** Números dichos en palabras (dictado por voz): "tres pallets" -> "3 pallets". */
const NUMEROS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, medio: 0.5,
}
const numerosEnPalabras = (t: string) =>
  t.replace(/\b([a-z]+)\b(?=\s+(?:pallets?|palets?|pals?|plts?))/g, (m, w: string) => (w in NUMEROS ? String(NUMEROS[w]) : m))

function cantidades(linea: string) {
  const n = numerosEnPalabras(linea.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
  const pal = n.match(/(\d+(?:[.,]\d+)?)\s*(?:pallets?|palets?|pals?|plts?|pall)\b/)
  const bot = n.match(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:botellas?|unidades|unid|u\b|uds?\b|frascos?|envases?)/)
  return { pallets: pal ? Number(pal[1].replace(',', '.')) : null, botellas: bot ? entero(bot[1]) : null }
}

interface Clave { sku: SkuParaLeer; attrs: Record<string, string>; palabras: string[]; frases: string[] }

function preparar(catalogo: SkuParaLeer[]): Clave[] {
  return catalogo.filter((s) => s.estado === 'ACTIVO').map((s) => {
    const n = normalizar(`${s.descripcion} ${s.color ?? ''}`)
    return {
      sku: s,
      attrs: atributos(n),
      palabras: [...new Set([...palabrasClave(n), ...palabrasClave(normalizar(s.familia ?? ''))])],
      frases: (s.sinonimos ?? '').split(/[,;]/).map((x) => normalizar(x)).filter(Boolean),
    }
  })
}

/** Puntaje (0..1, o 1..2 si coincide un "Otro nombre"): cuánto de la línea explica el SKU y cuánto del SKU aparece en la línea. */
function puntaje(c: Clave, linea: { attrs: Record<string, string>; palabras: Set<string>; plana: string; upp: number | null }) {
  let enComun = 0
  let delSku = 0
  let deLinea = 0
  let contradice = 0
  for (const g of ['color', 'boca', 'linea', 'capacidad']) {
    const a = linea.attrs[g]
    const b = c.attrs[g]
    let peso = g === 'capacidad' ? 1.5 : 1
    // Si el pedido no dice la capacidad, se asume la habitual (750): no resta;
    // una capacidad distinta (1125, 355…) sí resta, porque no se pidió.
    if (g === 'capacidad' && !a) {
      if (b === '750') continue
      peso = 2
    }
    if (b) delSku += peso
    if (a) deLinea += peso
    if (a && b) {
      if (a === b) enComun += peso
      else contradice++
    }
  }
  // Si el pedido trae pallets y botellas, sus unidades por pallet tienen que
  // coincidir con las del SKU (ej. 4.872 / 4 = 1.218). Es una pista muy fuerte.
  const up = c.sku.unidades_pallet
  if (linea.upp && up) {
    if (Math.abs(linea.upp - up) <= up * 0.01) { enComun += 2; delSku += 2; deLinea += 2 }
    else contradice++
  }
  // Otros nombres cargados por Javier: mandan sobre la descripción. Si la línea
  // tiene uno, ese SKU gana a cualquiera que no lo tenga (puntaje 1 a 2) y entre
  // los que lo tienen deciden color, boca, línea y capacidad. Una contradicción
  // (pidió rosca y es tapón) igual lo baja.
  const sinonimo = c.frases.some((f) => ` ${linea.plana} `.includes(` ${f} `))
  if (sinonimo) {
    const pa = deLinea ? enComun / deLinea : 1
    const ra = delSku ? enComun / delSku : 1
    const fa = pa + ra ? (2 * pa * ra) / (pa + ra) : 0
    return (1 + fa) * (contradice ? 0.35 ** contradice : 1)
  }
  for (const p of c.palabras) {
    delSku += 1.5 // modelo/familia (Cónica, Baja, Nobile…) es lo que más distingue
    if (linea.palabras.has(p)) enComun += 1.5
  }
  for (const p of linea.palabras) if (!c.palabras.includes(p)) deLinea += 1.5
  deLinea += [...linea.palabras].filter((p) => c.palabras.includes(p)).length * 1.5
  if (!enComun) return 0
  const p = enComun / deLinea
  const r = enComun / delSku
  const f = (2 * p * r) / (p + r)
  return f * (contradice ? 0.35 ** contradice : 1)
}

export function leerPedidoPorReglas(texto: string, catalogo: SkuParaLeer[]): FilaLeida[] {
  const claves = preparar(catalogo)
  const filas: FilaLeida[] = []
  for (const original of texto.split(/\r?\n/)) {
    const limpia = original.trim()
    if (!limpia) continue
    const n = normalizar(limpia)
    const linea = { attrs: atributos(n.replace(/\b\d+\s(?:pallets?|palets?|pals?|plts?|botellas?|unidades|u)\b/g, ' ')), palabras: new Set(palabrasClave(n)), plana: n }
    const { pallets: palletsTexto, botellas } = cantidades(limpia)
    const upp = palletsTexto && botellas ? botellas / palletsTexto : null
    const ranking = claves.map((c) => ({ c, v: puntaje(c, { ...linea, upp }) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
    const [mejor, segundo] = ranking
    // Línea sin cantidades ni parecido a ningún producto: saludo, firma, etc.
    if ((!mejor || mejor.v < 0.3) && palletsTexto == null && botellas == null) continue

    let sku: number | null = null
    let confianza: FilaLeida['confianza'] = 'baja'
    let nota: string | null = null
    const margen = mejor ? mejor.v - (segundo?.v ?? 0) : 0
    if (mejor && mejor.v >= 0.3) {
      sku = mejor.c.sku.sku
      const claro = !segundo || segundo.v <= mejor.v * 0.5 // el segundo queda muy lejos
      confianza = mejor.v >= 0.7 && margen >= 0.1 ? 'alta' : mejor.v >= 0.5 || claro ? 'media' : 'baja'
      if (confianza === 'baja') nota = 'Es el más parecido, pero no es seguro.'
    } else {
      nota = 'No se reconoció el producto. Elegilo a mano o cargá sus "Otros nombres" en SKUs.'
    }
    const alternativas = ranking.filter((x) => x.c.sku.sku !== sku && x.v >= 0.2).slice(0, 3).map((x) => x.c.sku.sku)

    let pallets = palletsTexto
    const up = sku != null ? mejor.c.sku.unidades_pallet : null
    if (pallets == null && botellas != null && up) pallets = Math.round((botellas / up) * 100) / 100
    filas.push({ texto: limpia, sku, pallets, botellas, confianza, nota, alternativas })
  }
  return filas
}
