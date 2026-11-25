import { useUsuarios } from '@/lib/usuarios'

/** Aviso para pantallas compartidas que solo modifica el administrador. */
export function AvisoSoloAdmin({ que }: { que: string }) {
  const { esAdmin, usuarios } = useUsuarios()
  if (esAdmin) return null
  const admins = usuarios.filter((u) => u.es_admin).map((u) => u.nombre || u.email).join(', ')
  return (
    <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
      Solo lectura: {que} la modifica el administrador{admins ? ` (${admins})` : ''}.
    </p>
  )
}
