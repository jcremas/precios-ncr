import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeError, traerTodo } from '@/lib/datos'
import { nombreMes } from '@/lib/formato'
import { MODALIDADES, nombreModalidad, type Cliente } from '@/lib/tipos'
import { useUsuarios } from '@/lib/usuarios'
import { useNiveles } from '@/lib/niveles'
import {
  MARCAS, PLANTILLA_INICIAL, armarZip, bajar, destinatarios, emlDeCliente, guardarPlantilla, leerPlantilla, nombreArchivo,
  type LineaCorreo, type Plantilla,
} from '@/lib/correo'
import { enviosPorMes, fecha, filaEnvio, registrarEnvios } from '@/lib/envios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Ayuda } from '@/components/Ayuda'

type ClienteEnvio = Pick<Cliente, 'id' | 'nombre' | 'nro_cliente' | 'modalidad' | 'nivel_id' | 'contacto' | 'email' | 'condicion_pago' | 'empaque_consignado' | 'dueno'>

interface Resultado { armados: number; sinPrecios: string[]; sinEmail: string[]; errores: string[]; avisoRegistro: string | null }

/** Meses con lista de cada cliente (id -> meses, del más nuevo al más viejo).
 *  Usa meses_cotizables_todos() (0011); si todavía no se corrió, pregunta
 *  cliente por cliente con meses_cotizables() (0007), que es más lento. */
async function mesesPorCliente(ids: number[]): Promise<Map<number, string[]>> {
  const mapa = new Map<number, string[]>()
  const agregar = (id: number, mes: string) => {
    const l = mapa.get(id)
    if (l) l.push(mes); else mapa.set(id, [mes])
  }
  try {
    const filas = await traerTodo<{ cliente_id: number; mes: string }>((d, h) =>
      supabase.rpc('meses_cotizables_todos').order('cliente_id').order('mes').range(d, h))
    for (const f of filas) agregar(f.cliente_id, f.mes)
  } catch {
    const cola = [...ids]
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (let id = cola.shift(); id != null; id = cola.shift()) {
        const { data } = await supabase.rpc('meses_cotizables', { p_cliente_id: id })
        for (const x of (data ?? []) as { mes: string }[]) agregar(id, x.mes)
      }
    }))
  }
  for (const l of mapa.values()) l.sort().reverse()
  return mapa
}

export default function EnviarListas() {
  const { niveles, nombre: nombreNivel } = useNiveles()
  const { yo, usuarios, nombreDe } = useUsuarios()
  const [dueno, setDueno] = useState<string | null>(null) // null = mis clientes
  const duenoElegido = dueno ?? yo
  const [clientes, setClientes] = useState<ClienteEnvio[]>([])
  const [meses, setMeses] = useState<Map<number, string[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalidad, setModalidad] = useState('')
  const [nivel, setNivel] = useState('')
  const [filtro, setFiltro] = useState('')
  const [soloConEmail, setSoloConEmail] = useState(false)
  const [mes, setMes] = useState('') // '' = el último de cada cliente
  const [tildados, setTildados] = useState<Set<number>>(new Set())
  const [plantilla, setPlantilla] = useState<Plantilla>(leerPlantilla)
  const [verTexto, setVerTexto] = useState(false)
  const [avance, setAvance] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  // Envíos registrados (0017): cliente -> mes de lista -> fecha del último envío.
  // null = todavía cargando o falta la migración (sinRegistro).
  const [envios, setEnvios] = useState<Map<number, Map<string, string>> | null>(null)
  const [sinRegistro, setSinRegistro] = useState(false)
  const [soloSinEnviar, setSoloSinEnviar] = useState(false)

  async function cargarEnvios() {
    try {
      const filas = await enviosPorMes()
      if (!filas) return setSinRegistro(true)
      const mapa = new Map<number, Map<string, string>>()
      for (const f of filas) {
        const m = mapa.get(f.cliente_id) ?? new Map<string, string>()
        m.set(f.mes, f.ultimo_envio)
        mapa.set(f.cliente_id, m)
      }
      setEnvios(mapa)
    } catch (e) {
      setError(mensajeError(e))
    }
  }
  useEffect(() => { cargarEnvios() }, [])

  useEffect(() => {
    supabase.from('clientes').select('*')
      .eq('activo', true).eq('cotiza', true).order('nombre').order('id')
      .then(({ data, error }) => {
        if (error) return setError(mensajeError(error))
        const lista = (data ?? []) as ClienteEnvio[]
        setClientes(lista)
        mesesPorCliente(lista.map((c) => c.id)).then(setMeses, (e) => setError(mensajeError(e)))
      })
  }, [])

  /** Todos los meses con alguna lista, del más nuevo al más viejo. */
  const mesesDisponibles = useMemo(
    () => [...new Set([...(meses?.values() ?? [])].flat())].sort().reverse(),
    [meses])
  /** Mes de la lista que se manda a ese cliente (el elegido o su último), o null si no tiene. */
  const mesDe = (id: number) => {
    const l = meses?.get(id) ?? []
    return mes ? (l.includes(mes) ? mes : null) : (l[0] ?? null)
  }
  const cuantos = (m: string) => clientes.filter((c) => meses?.get(c.id)?.includes(m)).length
  /** Fecha del último envío de la lista que le toca (mesDe), o null si no se le mandó. */
  const enviadoEn = (id: number) => {
    const m = mesDe(id)
    return m ? envios?.get(id)?.get(m) ?? null : null
  }
  /** Último envío de cualquier lista: { mes de la lista, fecha }. */
  const ultimoEnvio = (id: number) => {
    let u: { mes: string; en: string } | null = null
    for (const [mes, en] of envios?.get(id) ?? []) if (!u || en > u.en) u = { mes, en }
    return u
  }
  function cambiarMes(m: string) {
    setMes(m)
    setTildados(new Set())
    setResultado(null)
  }

  const f = filtro.trim().toUpperCase()
  const visibles = useMemo(() => clientes.filter((c) =>
    (!mes || (meses?.get(c.id) ?? []).includes(mes)) &&
    (!duenoElegido || c.dueno === undefined || c.dueno === duenoElegido) &&
    (!modalidad || c.modalidad === modalidad) &&
    (!nivel || String(c.nivel_id) === nivel) &&
    (!soloConEmail || destinatarios(c.email).length > 0) &&
    (!soloSinEnviar || !enviadoEn(c.id)) &&
    (!f || c.nombre.toUpperCase().includes(f) || (c.nro_cliente ?? '').toUpperCase().includes(f))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [clientes, meses, mes, duenoElegido, modalidad, nivel, soloConEmail, soloSinEnviar, envios, f])

  const tildables = visibles.filter((c) => mesDe(c.id))
  const todosVisiblesTildados = tildables.length > 0 && tildables.every((c) => tildados.has(c.id))
  function tildarVisibles(si: boolean) {
    const n = new Set(tildados)
    for (const c of tildables) if (si) n.add(c.id); else n.delete(c.id)
    setTildados(n)
  }
  function tildar(id: number, si: boolean) {
    if (si && !mesDe(id)) return
    const n = new Set(tildados)
    if (si) n.add(id); else n.delete(id)
    setTildados(n)
  }
  function cambiarPlantilla(p: Plantilla) {
    setPlantilla(p)
    guardarPlantilla(p)
  }

  async function armar() {
    const elegidos = clientes.filter((c) => tildados.has(c.id))
    if (!elegidos.length) return
    setResultado(null)
    setAvance(`Armando 0 de ${elegidos.length}…`)
    const { data: skus } = await supabase.from('skus').select('sku, unidades_pallet')
    const pallet = new Map((skus ?? []).map((x) => [x.sku as number, x.unidades_pallet as number | null]))
    const archivos: { nombre: string; contenido: string }[] = []
    const r: Resultado = { armados: 0, sinPrecios: [], sinEmail: [], errores: [], avisoRegistro: null }
    const registro: ReturnType<typeof filaEnvio>[] = []
    let hechos = 0
    // De a 4 clientes a la vez, para no saturar la base.
    const cola = [...elegidos]
    async function trabajar() {
      for (let c = cola.shift(); c; c = cola.shift()) {
        const { data, error } = await supabase.rpc('cotizar', { p_cliente_id: c.id, p_mes: mesDe(c.id) })
        hechos++
        setAvance(`Armando ${hechos} de ${elegidos.length}…`)
        if (error) { r.errores.push(`${c.nombre}: ${mensajeError(error)}`); continue }
        const filas = (data ?? []) as (LineaCorreo & { mes: string })[]
        if (!filas.length) { r.sinPrecios.push(c.nombre); continue }
        const lineas = filas.map((l) => ({ ...l, pallet: pallet.get(l.sku) ?? null }))
        const mesCorreo = filas[0].mes
        const datos = { cliente: c.nombre, contacto: c.contacto, email: c.email, condicion_pago: c.condicion_pago, empaque_consignado: c.empaque_consignado, mes: mesCorreo, lineas }
        archivos.push({ nombre: nombreArchivo(c.nombre, mesCorreo), contenido: emlDeCliente(datos, plantilla) })
        registro.push(filaEnvio(c.id, datos, plantilla, 'enviar_listas'))
        r.armados++
        if (!destinatarios(c.email).length) r.sinEmail.push(c.nombre)
      }
    }
    await Promise.all(Array.from({ length: 4 }, trabajar))
    archivos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    if (archivos.length === 1) bajar(archivos[0].nombre, archivos[0].contenido)
    else if (archivos.length > 1) bajar(`Listas de precios ${mes ? nombreMes(mes) : new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}.zip`, armarZip(archivos))
    r.sinPrecios.sort()
    r.sinEmail.sort()
    // Queda registrado (ficha del cliente y columna "Último envío").
    if (registro.length) {
      setAvance('Registrando envíos…')
      r.avisoRegistro = await registrarEnvios(registro)
      if (!r.avisoRegistro) await cargarEnvios()
    }
    setTildados(new Set())
    setAvance(null)
    setResultado(r)
  }

  const campo = (k: keyof Plantilla, titulo: string, filas = 1) => (
    <div className="grid gap-1">
      <Label htmlFor={`pl-${k}`}>{titulo}</Label>
      {filas === 1
        ? <Input id={`pl-${k}`} value={plantilla[k]} onChange={(e) => cambiarPlantilla({ ...plantilla, [k]: e.target.value })} />
        : <textarea id={`pl-${k}`} rows={filas} className="rounded-md border p-2 text-sm" value={plantilla[k]} onChange={(e) => cambiarPlantilla({ ...plantilla, [k]: e.target.value })} />}
    </div>
  )

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Enviar listas de precios por Outlook</CardTitle>
          <Ayuda resumen='Tildá los clientes y apretá "Bajar correos": se baja un .zip con un correo por cliente para abrir en Outlook y apretar Enviar.'>
            <p>La app arma un correo por cliente (para su email, con asunto y la tabla de precios) y los baja juntos en un .zip. Abrí el .zip y hacé doble clic en cada correo: se abre en Outlook como mensaje nuevo, lo revisás y apretás Enviar. La app no envía nada sola y no quedan en Borradores salvo que los cierres guardándolos.</p>
            <p>En "Precios de" elegí un mes para ver solo los clientes que tienen lista ese mes, o "La última lista de cada cliente" para verlos a todos con el mes de su última lista. Los clientes NO COTIZA no aparecen.</p>
            <p>Cada correo que se baja queda registrado (columna "Último envío" y ficha del cliente). "Sin enviar este mes" muestra los clientes a los que todavía no se les armó el correo de la lista de ese mes. Si al final no mandaste uno, marcalo como "No se envió" en la ficha del cliente.</p>
          </Ayuda>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="mes">Precios de</Label>
              <Select id="mes" className="w-72" value={mes} onChange={(e) => cambiarMes(e.target.value)}>
                <option value="">La última lista de cada cliente</option>
                {mesesDisponibles.map((m) => (
                  <option key={m} value={m}>Solo {nombreMes(m)} ({cuantos(m)} cliente{cuantos(m) === 1 ? '' : 's'})</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="dueno">Dueño</Label>
              <Select id="dueno" className="w-44" value={duenoElegido} onChange={(e) => setDueno(e.target.value)}>
                <option value="">Clientes de todos</option>
                {usuarios.map((u) => <option key={u.email} value={u.email}>{u.email === yo ? 'Mis clientes' : `De ${nombreDe(u.email)}`}</option>)}
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tipo">Tipo</Label>
              <Select id="tipo" className="w-40" value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
                <option value="">Todos</option>
                {MODALIDADES.map((m) => <option key={m} value={m}>{m === 'GENERICO' ? 'Genéricos' : 'Especiales'}</option>)}
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="nivel">Nivel</Label>
              <Select id="nivel" className="w-40" value={nivel} onChange={(e) => setNivel(e.target.value)}>
                <option value="">Todos</option>
                {niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="buscar">Buscar</Label>
              <Input id="buscar" className="w-56" placeholder="Nombre o código" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={soloConEmail} onChange={(e) => setSoloConEmail(e.target.checked)} /> Solo con email
            </label>
            <label className="flex h-9 items-center gap-2 text-sm" title={sinRegistro ? 'Falta correr la migración 0017 en Supabase' : 'Clientes a los que todavía no se les armó el correo con la lista de ese mes'}>
              <input type="checkbox" disabled={sinRegistro} checked={soloSinEnviar} onChange={(e) => setSoloSinEnviar(e.target.checked)} /> Sin enviar este mes
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={armar} disabled={!tildados.size || !!avance}>
              {avance ?? `Bajar ${tildados.size} correo${tildados.size === 1 ? '' : 's'}`}
            </Button>
            {tildados.size > 0 && !avance && <Button variant="ghost" onClick={() => setTildados(new Set())}>Destildar todos</Button>}
            <Button variant={verTexto ? 'secondary' : 'outline'} className="ml-auto" onClick={() => setVerTexto(!verTexto)}>Texto del correo</Button>
          </div>

          {verTexto && (
            <div className="grid max-w-3xl gap-3 rounded-md border p-4">
              <p className="text-sm text-muted-foreground">
                Se usa en todos los correos (también en el botón "Correo para Outlook" de Cotizar) y queda guardado en este navegador.
                Podés usar {MARCAS}: se reemplazan por los datos de cada cliente (si no tiene contacto, va el nombre del cliente).
                La tabla de precios va entre la introducción y el cierre. El cierre depende de la casilla "Empaque en consignación" de la ficha del cliente. Si el cliente no tiene condición de pago cargada, va "a convenir". Outlook no agrega tu firma sola a estos correos: escribila en el cierre.
              </p>
              {campo('cc', 'Siempre en copia (CC), separados con ;')}
              {campo('asunto', 'Asunto')}
              {campo('saludo', 'Saludo')}
              {campo('intro', 'Introducción (antes de la tabla)', 3)}
              {campo('cierreConsignado', 'Cierre y firma: clientes CON empaque en consignación', 10)}
              {campo('cierreSinConsignar', 'Cierre y firma: clientes SIN empaque en consignación', 8)}
              <div><Button variant="ghost" size="sm" onClick={() => cambiarPlantilla(PLANTILLA_INICIAL)}>Volver al texto inicial</Button></div>
            </div>
          )}

          {resultado && (
            <div className="grid gap-1 rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">
                {resultado.armados
                  ? `Listo: ${resultado.armados} correo${resultado.armados === 1 ? '' : 's'} bajado${resultado.armados === 1 ? '' : 's'}. ${resultado.armados > 1 ? 'Abrí el .zip y hacé doble clic en cada uno.' : 'Abrilo con doble clic.'}`
                  : 'No se armó ningún correo.'}
              </p>
              {resultado.sinEmail.length > 0 && <p className="text-amber-800">Sin email cargado (escribilo en el campo Para de Outlook, o cargalo en la ficha del cliente): {resultado.sinEmail.join(', ')}.</p>}
              {resultado.sinPrecios.length > 0 && <p className="text-amber-800">Sin SKUs tildados con precio (no se armó correo): {resultado.sinPrecios.join(', ')}.</p>}
              {resultado.errores.length > 0 && <p className="text-destructive">Con error: {resultado.errores.join('; ')}.</p>}
              {resultado.avisoRegistro && <p className="text-amber-800">{resultado.avisoRegistro}</p>}
            </div>
          )}
          {sinRegistro && <p className="text-sm text-amber-800">Para registrar los envíos (columna "Último envío" y filtro "Sin enviar este mes") falta correr la migración 0017 en Supabase. Mientras tanto los correos se bajan igual.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Table fija>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input type="checkbox" aria-label="Tildar todos los de la lista" checked={todosVisiblesTildados} onChange={(e) => tildarVisibles(e.target.checked)} />
            </TableHead>
            <TableHead>Cliente ({visibles.length})</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>{mes ? 'Lista' : 'Última lista'}</TableHead>
            {!sinRegistro && <TableHead>Último envío</TableHead>}
            <TableHead>Empaque</TableHead>
            <TableHead>Contacto</TableHead>
            <TableHead>Email</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((c) => {
            const para = destinatarios(c.email)
            const m = mesDe(c.id)
            const u = ultimoEnvio(c.id)
            const enviadoEsta = enviadoEn(c.id)
            return (
              <TableRow key={c.id} className={m ? 'cursor-pointer' : 'text-muted-foreground'} onClick={() => tildar(c.id, !tildados.has(c.id))}>
                <TableCell>
                  <input type="checkbox" aria-label={`Tildar ${c.nombre}`} disabled={!m} checked={tildados.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => tildar(c.id, e.target.checked)} />
                </TableCell>
                <TableCell>{c.nombre}</TableCell>
                <TableCell className="font-mono text-xs">{c.nro_cliente}</TableCell>
                <TableCell className="whitespace-nowrap">{nombreModalidad(c.modalidad)}{c.nivel_id != null ? ` · ${nombreNivel(c.nivel_id)}` : ''}</TableCell>
                <TableCell className="whitespace-nowrap">{m ? nombreMes(m) : meses ? <Badge variant="outline">sin lista</Badge> : '…'}</TableCell>
                {!sinRegistro && (
                  <TableCell className="whitespace-nowrap" title={enviadoEsta ? `Lista de ${m && nombreMes(m)} armada el ${fecha(enviadoEsta)}` : m ? `Todavía no se armó el correo con la lista de ${nombreMes(m)}` : undefined}>
                    {!envios ? '…' : u ? (
                      <span className="flex items-center gap-2">
                        {fecha(u.en)} <span className="text-xs text-muted-foreground">({nombreMes(u.mes)})</span>
                        {enviadoEsta ? <Badge variant="secondary">✓</Badge> : m && <Badge variant="alerta">sin enviar {nombreMes(m)}</Badge>}
                      </span>
                    ) : m ? <Badge variant="outline">nunca</Badge> : '—'}
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap">{c.empaque_consignado ? 'Consignado' : 'Se cobra'}</TableCell>
                <TableCell>{c.contacto}</TableCell>
                <TableCell>{para.length ? para.join(', ') : <Badge variant="outline">sin email</Badge>}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
