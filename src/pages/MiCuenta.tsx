import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useUsuarios } from '@/lib/usuarios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const MINIMO = 8

/** Mi cuenta: datos del usuario y cambio de contraseña. */
export default function MiCuenta() {
  const { yo, esAdmin, nombreDe, debeCambiarClave, recargar } = useUsuarios()
  const navigate = useNavigate()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function cambiar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(false)
    if (nueva.length < MINIMO) return setError(`La contraseña nueva tiene que tener al menos ${MINIMO} caracteres.`)
    if (nueva !== repetida) return setError('Las dos contraseñas nuevas no son iguales.')
    if (nueva === actual) return setError('La contraseña nueva tiene que ser distinta de la actual.')
    setGuardando(true)
    // Primero se confirma la contraseña actual.
    const login = await supabase.auth.signInWithPassword({ email: yo, password: actual })
    if (login.error) {
      setGuardando(false)
      return setError('La contraseña actual no es correcta.')
    }
    const { error } = await supabase.auth.updateUser({ password: nueva })
    if (error) {
      setGuardando(false)
      return setError(/weak|short|characters/i.test(error.message) ? 'Esa contraseña es muy débil: usá una más larga, con letras y números.' : error.message)
    }
    const eraTemporal = debeCambiarClave
    await supabase.rpc('clave_cambiada') // apaga el aviso de contraseña temporal (0014)
    await recargar()
    setGuardando(false)
    setActual('')
    setNueva('')
    setRepetida('')
    setOk(true)
    if (eraTemporal) navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto grid max-w-md gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Mi cuenta</CardTitle>
          <CardDescription>
            {nombreDe(yo)} · {yo}{esAdmin ? ' · Administrador' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {debeCambiarClave && (
            <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Estás usando una contraseña temporal. Elegí una propia para seguir.
            </p>
          )}
          <form onSubmit={cambiar} className="grid gap-4">
            <h2 className="font-medium">Cambiar contraseña</h2>
            <div className="grid gap-2">
              <Label htmlFor="actual">Contraseña actual</Label>
              <Input id="actual" type="password" autoComplete="current-password" required value={actual} onChange={(e) => setActual(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nueva">Contraseña nueva (al menos {MINIMO} caracteres)</Label>
              <Input id="nueva" type="password" autoComplete="new-password" required value={nueva} onChange={(e) => setNueva(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="repetida">Repetí la contraseña nueva</Label>
              <Input id="repetida" type="password" autoComplete="new-password" required value={repetida} onChange={(e) => setRepetida(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {ok && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">Listo: la próxima vez entrás con la contraseña nueva.</p>}
            <Button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Cambiar contraseña'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
