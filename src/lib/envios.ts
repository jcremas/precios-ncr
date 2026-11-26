/** Registro de listas enviadas (0017).
 *
 *  La app no ve si se apretó Enviar en Outlook: se registra cada correo
 *  cuando se ARMA (Cotizar o Enviar listas). Si al final no se mandó, se
 *  marca "No se envió" (descartado) desde la ficha del cliente. */
import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/datos'
import { armarCorreo, destinatarios, type DatosCorreo, type Plantilla } from '@/lib/correo'

export interface PrecioEnviado { sku: number; descripcion: string; precio: number }

export interface ListaEnviada {
  id: number
  cliente_id: number
  mes: string
  enviado_por: string
  enviado_en: string
  para: string | null
  cc: string | null
  asunto: string | null
  origen: string | null
  precios: PrecioEnviado[]
  cantidad_skus: number
  descartado: boolean
  descartado_por: string | null
  descartado_en: string | null
}

/** Último envío (no descartado) de cada cliente y mes de lista. */
export interface EnvioPorMes { cliente_id: number; mes: string; ultimo_envio: string; veces: number }

/** Si todavía no se corrió la migración 0017. */
export const faltaMigracion = (e: unknown) =>
  !!e && typeof e === 'object' && 'message' in e && /listas_enviadas|v_envios_por_mes|schema cache|does not exist/i.test(String((e as { message: string }).message))

/** Fila a registrar para un correo armado. */
export function filaEnvio(clienteId: number, d: DatosCorreo, p: Plantilla, origen: 'cotizar' | 'enviar_listas') {
  return {
    cliente_id: clienteId,
    mes: d.mes,
    para: destinatarios(d.email).join('; ') || null,
    cc: destinatarios(p.cc).join('; ') || null,
    asunto: armarCorreo(d, p).asunto,
    origen,
    precios: d.lineas.map((l) => ({ sku: l.sku, descripcion: l.descripcion, precio: Number(l.precio) })),
  }
}

/** Guarda los correos armados. Devuelve un aviso si no se pudo (el correo se baja igual). */
export async function registrarEnvios(filas: ReturnType<typeof filaEnvio>[]): Promise<string | null> {
  if (!filas.length) return null
  // De a 200 por pedido.
  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await supabase.from('listas_enviadas').insert(filas.slice(i, i + 200))
    if (error) {
      return faltaMigracion(error)
        ? 'El correo se bajó, pero no quedó registrado: falta correr la migración 0017 en Supabase.'
        : `El correo se bajó, pero no quedó registrado: ${error.message}`
    }
  }
  return null
}

/** Último envío de cada cliente por mes de lista (null si falta la migración 0017). */
export async function enviosPorMes(): Promise<EnvioPorMes[] | null> {
  try {
    return await traerTodo<EnvioPorMes>((d, h) =>
      supabase.from('v_envios_por_mes').select('cliente_id, mes, ultimo_envio, veces').order('cliente_id').order('mes').range(d, h))
  } catch (e) {
    if (faltaMigracion(e)) return null
    throw e
  }
}

const fmtFecha = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })
const fmtFechaHora = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
/** '25/11/2026' (hora Argentina) */
export const fecha = (iso: string) => fmtFecha.format(new Date(iso))
/** '25/11/2026, 18:40' (hora Argentina) */
export const fechaHora = (iso: string) => fmtFechaHora.format(new Date(iso))
