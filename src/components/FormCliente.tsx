import { useState, type FormEvent } from 'react'
import { NIVELES, type Nivel } from '@/lib/tipos'
import type { DatosCliente } from '@/lib/clientes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

/** Formulario de alta / edición, usado acá y en la ficha del cliente. */
export function FormCliente({ inicial, onGuardar, onCancelar }: {
  inicial: DatosCliente
  onGuardar: (d: DatosCliente) => Promise<string | null>
  onCancelar: () => void
}) {
  const [d, setD] = useState<DatosCliente>(inicial)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof DatosCliente) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const limpio = Object.fromEntries(
      Object.entries(d).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    ) as DatosCliente
    if (!limpio.nombre) return setError('El nombre es obligatorio.')
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
        <Label htmlFor="nivel">Nivel</Label>
        <Select id="nivel" value={d.nivel} onChange={(e) => setD({ ...d, nivel: e.target.value as Nivel })}>
          {NIVELES.map((n) => <option key={n}>{n}</option>)}
        </Select>
      </div>
      {campo('segmento', 'Segmento')}
      {campo('condicion_pago', 'Condición de pago')}
      {campo('contacto', 'Contacto')}
      {campo('email', 'Email', { type: 'email' })}
      {campo('observaciones', 'Observaciones')}
      {error && <p className="text-sm text-destructive md:col-span-3">{error}</p>}
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit">Guardar</Button>
        <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </form>
  )
}
