/** Correos de listas de precios para abrir en Outlook.
 *
 *  La app arma un archivo .eml por cliente (destinatario, asunto y la tabla de
 *  precios en HTML). La cabecera "X-Unsent: 1" hace que Outlook de escritorio
 *  lo abra como un mensaje NUEVO, listo para revisar y apretar Enviar (sale
 *  desde la cuenta de Outlook del usuario). No se guarda solo en Borradores:
 *  si se cierra sin enviar, Outlook pregunta si se guarda como borrador.
 *  La app no manda nada por su cuenta. */
import { esc, tablaHtml } from '@/lib/copiar'
import { nombreMes, precio } from '@/lib/formato'

export interface LineaCorreo { sku: number; descripcion: string; precio: number; pallet?: number | null }

export interface Plantilla {
  asunto: string
  saludo: string
  intro: string
  /** Cierre para clientes con empaque en consignación (clientes.empaque_consignado). */
  cierreConsignado: string
  /** Cierre para clientes sin empaque en consignación (pagan el empaque). */
  cierreSinConsignar: string
}

/** Marcas que se reemplazan en cada correo. */
export const MARCAS = '{cliente} {contacto} {mes} {condicion_pago}'

/** Textos de Javier (2026-11-24). */
export const PLANTILLA_INICIAL: Plantilla = {
  asunto: 'Propuesta de Precios {mes} - {cliente} - Nueva Cristalería Rosario',
  saludo: 'Estimado/a {contacto}:',
  intro: 'Le hacemos llegar nuestra propuesta de precios para el mes de {mes}.',
  cierreConsignado: [
    'Los precios no incluyen impuestos.',
    'Condición de pago: {condicion_pago}',
    'Lugar de entrega: a definir en conjunto con el cliente.',
    '',
    'El embalaje (Pallet, Marco y Chapadur) es propiedad de NCR. En caso de no efectuarse su devolución o que esta sea defectuosa, se facturará a los 60 días ff.',
    'Recordar que para informar y coordinar retiros se debe hacer con Mauricio Bedin: mauricio.bedin@ncrosario.com',
    '',
    'Aguardamos vuestros comentarios.',
    '',
    'Saludos',
  ].join('\n'),
  cierreSinConsignar: [
    'Los precios no incluyen impuestos.',
    'Condición de pago: {condicion_pago}',
    'Lugar de entrega: a definir en conjunto con el cliente.',
    '',
    'Al precio de la botella se debe sumar el precio del material de empaque (Pallet, Marco y Chapadur).',
    '',
    'Aguardamos vuestros comentarios.',
    '',
    'Saludos',
  ].join('\n'),
}

// v2: textos nuevos (los guardados con la versión anterior no se usan).
const CLAVE = 'precios-ncr.plantilla-correo.v2'

/** La plantilla queda guardada en este navegador (comodidad, no es un dato del sistema). */
export function leerPlantilla(): Plantilla {
  try {
    const t = localStorage.getItem(CLAVE)
    if (t) return { ...PLANTILLA_INICIAL, ...(JSON.parse(t) as Partial<Plantilla>) }
  } catch { /* sin almacenamiento: se usa la inicial */ }
  return PLANTILLA_INICIAL
}
export function guardarPlantilla(p: Plantilla) {
  try { localStorage.setItem(CLAVE, JSON.stringify(p)) } catch { /* sin almacenamiento */ }
}

export interface DatosCorreo {
  cliente: string
  contacto: string | null
  email: string | null
  condicion_pago?: string | null
  empaque_consignado?: boolean
  mes: string // 'AAAA-MM-01'
  lineas: LineaCorreo[]
}

const fmtUnidades = new Intl.NumberFormat('es-AR')

function completar(t: string, d: DatosCorreo) {
  return t
    .replace(/\{cliente\}/g, d.cliente)
    .replace(/\{contacto\}/g, d.contacto?.trim() || d.cliente)
    .replace(/\{mes\}/g, nombreMes(d.mes))
    .replace(/\{condicion_pago\}/g, d.condicion_pago?.trim() || 'a convenir')
}

/** Asunto, texto simple y HTML de un correo. */
export function armarCorreo(d: DatosCorreo, p: Plantilla) {
  const asunto = completar(p.asunto, d)
  const saludo = completar(p.saludo, d)
  const intro = completar(p.intro, d)
  const cierre = completar(d.empaque_consignado ? p.cierreConsignado : p.cierreSinConsignar, d)
  const titulo = `Lista de precios ${nombreMes(d.mes)} - ${d.cliente}`
  const filas = d.lineas.map((l) => [String(l.sku), l.descripcion, precio(Number(l.precio)), l.pallet ? fmtUnidades.format(l.pallet) : ''])
  const tabla = tablaHtml(titulo, [{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Precio', derecha: true }, { titulo: 'Unid./pallet', derecha: true }], filas)
  const parrafo = (t: string) => (t.trim() ? `<p style="margin:0 0 10px 0;">${esc(t).replace(/\n/g, '<br>')}</p>` : '')
  const html = `<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222222;">
${parrafo(saludo)}${parrafo(intro)}${tabla}
<div style="height:10px"></div>${parrafo(cierre)}</body></html>`
  const texto = [saludo, '', intro, '', titulo, '',
    ...filas.map(([sku, desc, pr, u]) => [sku, desc, pr, u ? `${u} u/pallet` : null].filter(Boolean).join(' · ')),
    '', cierre].join('\n')
  return { asunto, texto, html }
}

// ---------------------------------------------------------------------------
// Archivo .eml

const utf8 = new TextEncoder()

function base64(bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const base64Lineas = (t: string) => base64(utf8.encode(t)).replace(/.{76}/g, '$&\r\n')
/** Encabezado con acentos (RFC 2047). */
const encabezado = (t: string) => `=?UTF-8?B?${base64(utf8.encode(t))}?=`

/** "a@x.com; b@y.com" -> "a@x.com, b@y.com" (solo direcciones válidas). */
export function destinatarios(email: string | null) {
  return (email ?? '').split(/[;,\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
}

export function armarEml(para: string[], asunto: string, texto: string, html: string) {
  const limite = `----=_ncr_${Math.random().toString(36).slice(2)}`
  return [
    'X-Unsent: 1',
    ...(para.length ? [`To: ${para.join(', ')}`] : []),
    `Subject: ${encabezado(asunto)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${limite}"`,
    '',
    `--${limite}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lineas(texto.replace(/\r?\n/g, '\r\n')),
    `--${limite}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lineas(html),
    `--${limite}--`,
    '',
  ].join('\r\n')
}

/** Correo completo de un cliente, listo para bajar. */
export function emlDeCliente(d: DatosCorreo, p: Plantilla) {
  const { asunto, texto, html } = armarCorreo(d, p)
  return armarEml(destinatarios(d.email), asunto, texto, html)
}

/** Nombre de archivo seguro: "Lista MAY 2026 - CLIENTE.eml". */
export function nombreArchivo(cliente: string, mes: string) {
  const limpio = cliente.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `Lista ${nombreMes(mes)} - ${limpio}.eml`
}

// ---------------------------------------------------------------------------
// .zip simple (sin compresión) para bajar varios correos juntos.

const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function armarZip(archivos: { nombre: string; contenido: string }[]): Blob {
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let desplazamiento = 0
  const usados = new Set<string>()
  const ahora = new Date()
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1)
  const fecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate()
  for (const a of archivos) {
    // Nombres repetidos: se agrega (2), (3)…
    let nombre = a.nombre
    for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = a.nombre.replace(/(\.[^.]+)?$/, ` (${i})$1`)
    usados.add(nombre.toLowerCase())
    const n = utf8.encode(nombre)
    const datos = utf8.encode(a.contenido)
    const crc = crc32(datos)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // nombres en UTF-8
    local.setUint16(8, 0, true) // sin compresión
    local.setUint16(10, hora, true)
    local.setUint16(12, fecha, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, datos.length, true)
    local.setUint32(22, datos.length, true)
    local.setUint16(26, n.length, true)
    local.setUint16(28, 0, true)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, hora, true)
    c.setUint16(14, fecha, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, datos.length, true)
    c.setUint32(24, datos.length, true)
    c.setUint16(28, n.length, true)
    c.setUint32(42, desplazamiento, true)
    partes.push(new Uint8Array(local.buffer), n, datos)
    central.push(new Uint8Array(c.buffer), n)
    desplazamiento += 30 + n.length + datos.length
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0)
  const fin = new DataView(new ArrayBuffer(22))
  fin.setUint32(0, 0x06054b50, true)
  fin.setUint16(8, archivos.length, true)
  fin.setUint16(10, archivos.length, true)
  fin.setUint32(12, tamCentral, true)
  fin.setUint32(16, desplazamiento, true)
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)] as BlobPart[], { type: 'application/zip' })
}

/** Hace que el navegador baje un archivo. */
export function bajar(nombre: string, contenido: Blob | string, tipo = 'message/rfc822') {
  const blob = typeof contenido === 'string' ? new Blob([contenido], { type: tipo }) : contenido
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
