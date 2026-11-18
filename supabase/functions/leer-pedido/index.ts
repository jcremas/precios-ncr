// =====================================================================
// Función "leer-pedido" (Supabase Edge Function).
// Recibe el texto de un pedido pegado en Cotizar y le pide a Google
// Gemini que lo convierta en filas: SKU + cantidad de pallets.
//
// * La clave de Gemini vive SOLO acá (secreto GEMINI_API_KEY en Supabase),
//   nunca en el navegador.
// * A Gemini se le manda solo el texto del pedido y el catálogo de SKUs
//   activos (número, descripción, color, unidades por pallet y otros
//   nombres). NO se mandan precios ni datos de clientes.
// * Solo la pueden usar usuarios logueados y autorizados (es_autorizado()).
// * Archivo único y sin dependencias: se puede pegar tal cual en el editor
//   de Edge Functions del panel de Supabase.
// Secretos: GEMINI_API_KEY (obligatorio), GEMINI_MODEL (opcional).
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_TEXTO = 8000

interface SkuCatalogo {
  sku: number
  descripcion: string
  familia: string | null
  color: string | null
  unidades_pallet: number | null
  sinonimos: string | null
}

interface FilaIA {
  texto: string
  sku: number | null
  pallets: number | null
  botellas: number | null
  confianza: 'alta' | 'media' | 'baja'
  nota: string | null
}

function responder(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    filas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          texto: { type: 'STRING', description: 'La línea del pedido, tal como vino' },
          sku: { type: 'INTEGER', nullable: true, description: 'SKU del catálogo; null si no hay uno que corresponda con seguridad' },
          pallets: { type: 'NUMBER', nullable: true, description: 'Cantidad de pallets pedida' },
          botellas: { type: 'INTEGER', nullable: true, description: 'Cantidad de botellas/unidades si el pedido la dice' },
          confianza: { type: 'STRING', enum: ['alta', 'media', 'baja'] },
          nota: { type: 'STRING', nullable: true, description: 'Breve, en español: por qué hay duda o qué alternativa hay' },
        },
        required: ['texto', 'sku', 'pallets', 'botellas', 'confianza', 'nota'],
      },
    },
  },
  required: ['filas'],
}

const INSTRUCCIONES = `Sos un asistente de ventas de una fábrica de envases de vidrio (botellas para vino y frascos para alimentos) en Argentina.
Te paso el CATÁLOGO de SKUs y un PEDIDO escrito por un cliente. Devolvé una fila por cada producto pedido.
Reglas:
- Elegí el SKU del catálogo que corresponde por modelo/nombre, capacidad (ml o cc), color y tipo de boca (corcho, tapa rosca, etc.). Usá también los "otros nombres" de cada SKU.
- Si ningún SKU coincide con seguridad (por ejemplo, falta el color o hay dos parecidos), poné sku null o el más probable con confianza "baja", y explicá en "nota" la duda.
- "pallets": la cantidad de pallets del pedido. Si solo dice botellas/unidades y el SKU tiene unidades por pallet, calculá pallets = botellas / unidades por pallet.
- "botellas": solo si el pedido lo dice; los números usan punto de miles (3.402 = 3402).
- Ignorá saludos, firmas y líneas que no sean productos.
- No inventes SKUs: solo números del catálogo.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Usar POST' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const clave = Deno.env.get('GEMINI_API_KEY')
  const modelo = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'
  if (!url || !anon) return responder({ error: 'Falta configuración de Supabase en la función.' }, 500)
  if (!clave) return responder({ error: 'Falta la clave de Gemini: cargá el secreto GEMINI_API_KEY en Supabase (Edge Functions > Secrets).' }, 500)

  // Consultas a la base con el login del usuario: así rigen RLS y es_autorizado().
  const auth = req.headers.get('Authorization') ?? ''
  const db = (ruta: string, init?: RequestInit) =>
    fetch(`${url}/rest/v1/${ruta}`, { ...init, headers: { apikey: anon, Authorization: auth, 'Content-Type': 'application/json' } })

  const permiso = await db('rpc/es_autorizado', { method: 'POST', body: '{}' })
  if (!permiso.ok || (await permiso.json()) !== true) return responder({ error: 'Usuario no autorizado.' }, 403)

  let texto = ''
  try {
    texto = String((await req.json())?.texto ?? '').trim()
  } catch {
    return responder({ error: 'Pedido vacío.' }, 400)
  }
  if (!texto) return responder({ error: 'Pedido vacío.' }, 400)
  if (texto.length > MAX_TEXTO) return responder({ error: `El pedido es muy largo (máximo ${MAX_TEXTO} caracteres).` }, 400)

  const r = await db('skus?select=sku,descripcion,familia,color,unidades_pallet,sinonimos&estado=eq.ACTIVO&order=sku')
  if (!r.ok) return responder({ error: 'No se pudo leer el catálogo de SKUs. ¿Corriste la migración 0009?' }, 500)
  const catalogo = (await r.json()) as SkuCatalogo[]
  if (!catalogo.length) return responder({ error: 'No hay SKUs activos en el catálogo.' }, 400)

  const lineasCatalogo = catalogo.map((s) =>
    [s.sku, s.descripcion, s.familia && `familia: ${s.familia}`, s.color && `color: ${s.color}`,
      s.unidades_pallet && `${s.unidades_pallet} u/pallet`, s.sinonimos && `otros nombres: ${s.sinonimos}`]
      .filter(Boolean).join(' | '))

  const pedidoIA = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
      contents: [{ role: 'user', parts: [{ text: `CATÁLOGO (SKU | descripción | datos):\n${lineasCatalogo.join('\n')}\n\nPEDIDO:\n${texto}` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ESQUEMA },
    }),
  })

  if (!pedidoIA.ok) {
    const detalle = await pedidoIA.text()
    if (pedidoIA.status === 429) return responder({ error: 'Se llegó al límite gratuito de Gemini por ahora. Probá de nuevo en un minuto (o mañana si es el límite diario).' }, 429)
    if (pedidoIA.status === 400 && /API key/i.test(detalle)) return responder({ error: 'La clave de Gemini no es válida. Revisá el secreto GEMINI_API_KEY.' }, 502)
    if (pedidoIA.status === 404) return responder({ error: `El modelo "${modelo}" no existe. Revisá el secreto GEMINI_MODEL o borralo.` }, 502)
    return responder({ error: `Gemini respondió con error ${pedidoIA.status}.`, detalle: detalle.slice(0, 500) }, 502)
  }

  const resultado = await pedidoIA.json()
  const crudo = resultado?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  let filas: FilaIA[]
  try {
    filas = (JSON.parse(crudo).filas ?? []) as FilaIA[]
  } catch {
    return responder({ error: 'La IA devolvió una respuesta que no se pudo leer. Probá de nuevo.' }, 502)
  }

  // Control: el SKU tiene que existir en el catálogo (la IA no puede inventar).
  const existentes = new Set(catalogo.map((s) => s.sku))
  const limpias = filas.map((f) => {
    const valido = f.sku != null && existentes.has(Number(f.sku))
    return {
      texto: String(f.texto ?? ''),
      sku: valido ? Number(f.sku) : null,
      pallets: f.pallets != null && Number.isFinite(Number(f.pallets)) ? Number(f.pallets) : null,
      botellas: f.botellas != null && Number.isFinite(Number(f.botellas)) ? Math.round(Number(f.botellas)) : null,
      confianza: valido ? (['alta', 'media', 'baja'].includes(f.confianza) ? f.confianza : 'baja') : 'baja',
      nota: f.sku != null && !valido ? `La IA propuso un SKU que no existe (${f.sku}).` : (f.nota || null),
    }
  })

  return responder({ filas: limpias, modelo })
})
