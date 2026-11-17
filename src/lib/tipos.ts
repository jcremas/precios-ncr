export type Nivel = 'LISTA' | 'MEDIO' | 'AGRESIVO' | 'DIEGO' | 'MATAR' | 'ESPECIAL' | 'NO COTIZA'
export const NIVELES: Nivel[] = ['LISTA', 'MEDIO', 'AGRESIVO', 'DIEGO', 'MATAR', 'ESPECIAL', 'NO COTIZA']
export const NIVELES_ESTANDAR: Nivel[] = ['LISTA', 'MEDIO', 'AGRESIVO', 'DIEGO', 'MATAR']

export type EstadoSku = 'ACTIVO' | 'INACTIVO' | 'DESCONTINUADO'

export interface Sku {
  sku: number
  descripcion: string
  familia: string | null
  estado: EstadoSku
}

export interface Cliente {
  id: number
  nro_cliente: string | null
  segmento: string | null
  nombre: string
  contacto: string | null
  email: string | null
  condicion_pago: string | null
  nivel: Nivel
  observaciones: string | null
  activo: boolean
}

export interface IndiceCliente {
  id: number
  nro_cliente: string | null
  nombre: string
  nivel: Nivel
  segmento: string | null
  activo: boolean
  skus_activos: number
  ultimo_mes: string | null
}

export interface PrecioCliente {
  cliente_id: number
  sku: number
  mes: string // 'AAAA-MM-01'
  precio: number
}
