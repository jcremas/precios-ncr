export type Nivel = 'LISTA' | 'MEDIO' | 'AGRESIVO' | 'DIEGO' | 'MATAR'
export const NIVELES: Nivel[] = ['LISTA', 'MEDIO', 'AGRESIVO', 'DIEGO', 'MATAR']
export const DESCUENTOS: Record<Nivel, number> = { LISTA: 0, MEDIO: 3, AGRESIVO: 6, DIEGO: 10, MATAR: 15 }

export type Modalidad = 'GENERICO' | 'ESPECIAL'
export const MODALIDADES: Modalidad[] = ['GENERICO', 'ESPECIAL']
export const nombreModalidad = (m: Modalidad) => (m === 'GENERICO' ? 'Genérico' : 'Especial')

export type Origen = 'LISTA' | 'AUMENTO' | 'MANUAL' | 'MIGRACION'

export type EstadoSku = 'ACTIVO' | 'INACTIVO' | 'DESCONTINUADO'

export interface Sku {
  sku: number
  descripcion: string
  familia: string | null
  estado: EstadoSku
  admite_descuento: boolean
}

export interface Cliente {
  id: number
  nro_cliente: string | null
  segmento: string | null
  nombre: string
  contacto: string | null
  email: string | null
  condicion_pago: string | null
  modalidad: Modalidad
  nivel: Nivel | null
  cotiza: boolean
  observaciones: string | null
  activo: boolean
}

export interface IndiceCliente {
  id: number
  nro_cliente: string | null
  nombre: string
  modalidad: Modalidad
  nivel: Nivel | null
  cotiza: boolean
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
  origen?: Origen
}

export interface ListaGeneral {
  mes: string
  sku: number
  precio: number
  precio_minimo: number | null
}

export interface PrecioDetalle {
  mes: string
  sku: number
  descripcion: string
  familia: string | null
  cliente_id: number
  cliente: string
  nro_cliente: string | null
  modalidad: Modalidad
  nivel: Nivel | null
  segmento: string | null
  precio: number
  origen: Origen
  lista: number | null
  matar: number | null
  precio_minimo: number | null
}
