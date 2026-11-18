import { useState, type FormEvent } from 'react'
import { MODALIDADES, nombreModalidad, type Modalidad } from '@/lib/tipos'
import { etiquetaNivel, useNiveles } from '@/lib/niveles'
import { soloDatos, type DatosCliente } from '@/lib/clientes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

/** Formulario de alta / edición de cliente. */
export function FormCliente({ inicial, onGuardar, onCancelar }: {
  inicial: DatosCliente
  onGuardar: (d: DatosCliente) => Promise<string | null>
  onCancelar: () => void
}) {
  const { niveles } = useNiveles()
  // Un genérico nuevo arranca con el primer nivel (normalmente LISTA).
  const [d, setD] = useState<DatosCliente>(() =>
    !inicial.nombre && inicial.modalidad === 'GENERICO' && inicial.nivel_id == null ? { ...inicial, nivel_id: niveles[0]?.id ?? null } : inicial)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof DatosCliente) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const limpio = Object.fromEntries(
      Object.entries(soloDatos(d)).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    ) as DatosCliente
    if (!limpio.nombre) return setError('El nombre es obligatorio.')
    if (limpio.modalidad === 'GENERICO' && limpio.cotiza && limpio.nivel_id == null)
      return setError('Un cliente genérico necesita su nivel de descuento.')
    setError(await onGuardar(limpio))
  }

  const campo = (k: keyof DatosCliente, texto: string, extra: object = {}) => (
    <div className="grid gap-2">
      <Label htmlFor={k}>{texto}</Label>
      <Input id={k} value={(d[k] as string) ?? ''} onChange={set(k)} {...extra} />
    </div>
  )

  return (
    <form onSubmit={enviar} className="grid gap-4 md:grid-cols-3">
      {campo('nro_cliente', 'Código de cliente')}
      <div className="md:col-span-2">{campo('nombre', 'Nombre completo', { required: true })}</div>
      <div className="grid gap-2">
        <Label htmlFor="modalidad">Modalidad</Label>
        <Select id="modalidad" value={d.modalidad} onChange={(e) => {
          const modalidad = e.target.value as Modalidad
          // Un especial nuevo arranca sin nivel: se define al armar su primera lista.
          setD({ ...d, modalidad, nivel_id: modalidad === 'ESPECIAL' && !inicial.nombre ? null : d.nivel_id ?? (modalidad === 'GENERICO' ? niveles[0]?.id ?? null : null) })
        }}>
          {MODALIDADES.map((m) => <option key={m} value={m}>{nombreModalidad(m)}</option>)}
        </Select>
        <p className="text-xs text-muted-foreground">
          {d.modalidad === 'GENERICO'
            ? 'Paga la lista general menos el descuento de su nivel. Sus precios se guardan al crearlo, al cambiarle el nivel y al publicar cada lista.'
            : 'Tiene su lista de precios propia. Se maneja desde Envío mensual.'}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nivel">{d.modalidad === 'GENERICO' ? 'Nivel de descuento' : 'Nivel de referencia (opcional)'}</Label>
        <Select id="nivel" value={d.nivel_id ?? ''} onChange={(e) => setD({ ...d, nivel_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Sin nivel</option>
          {niveles.map((n) => <option key={n.id} value={n.id}>{etiquetaNivel(n)}</option>)}
        </Select>
      </div>
      <div className="flex items-center gap-2 pt-6">
        <input id="cotiza" type="checkbox" checked={d.cotiza} onChange={(e) => setD({ ...d, cotiza: e.target.checked })} />
        <Label htmlFor="cotiza">Se le cotiza</Label>
      </div>
      {campo('segmento', 'Segmento')}
      {campo('condicion_pago', 'Condición de pago')}
      {campo('contacto', 'Contacto')}
      {campo('email', 'Email', { type: 'email' })}
      <div className="md:col-span-2">{campo('observaciones', 'Observaciones')}</div>
      {error && <p className="text-sm text-destructive md:col-span-3">{error}</p>}
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit">Guardar</Button>
        <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </form>
  )
}
