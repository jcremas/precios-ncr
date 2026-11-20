import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

/* Dictado por voz con el reconocimiento del navegador (Chrome, Edge, Safari).
 * Gratis y sin claves. En Chrome y Edge el audio lo procesa el servicio de voz
 * del navegador (Google / Microsoft). Firefox no lo trae. */

interface Resultado { isFinal: boolean; 0: { transcript: string } }
interface EventoVoz { resultIndex: number; results: ArrayLike<Resultado> }
interface Reconocedor {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: EventoVoz) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function crearReconocedor(): Reconocedor | null {
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor }
  const Clase = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Clase ? new Clase() : null
}

const dictadoDisponible = () =>
  typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

const ERRORES: Record<string, string> = {
  'not-allowed': 'El navegador no tiene permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.',
  'service-not-allowed': 'El navegador no tiene permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.',
  'audio-capture': 'No se encontró un micrófono.',
  network: 'El dictado necesita conexión a internet.',
}

/** Botón Dictar / Detener. Cada frase terminada (al hacer una pausa) se agrega como una línea nueva. */
export default function Dictado({ onLinea, onParcial }: { onLinea: (t: string) => void; onParcial: (t: string) => void }) {
  const [escuchando, setEscuchando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Reconocedor | null>(null)
  const disponible = dictadoDisponible()

  useEffect(() => () => rec.current?.stop(), [])

  function empezar() {
    const r = crearReconocedor()
    if (!r) return
    r.lang = 'es-AR'
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let parcial = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim()
        if (e.results[i].isFinal) { if (t) onLinea(t) } else parcial += `${t} `
      }
      onParcial(parcial.trim())
    }
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(ERRORES[e.error] ?? `Error del dictado: ${e.error}`) }
    r.onend = () => { setEscuchando(false); onParcial('') }
    rec.current = r
    setError(null)
    r.start()
    setEscuchando(true)
  }

  function detener() {
    rec.current?.stop()
  }

  if (!disponible) {
    return <span className="text-xs text-muted-foreground" title="Firefox no permite dictar">Para dictar, usá Chrome o Edge.</span>
  }
  return (
    <>
      <Button type="button" variant={escuchando ? 'destructive' : 'outline'} onClick={escuchando ? detener : empezar}>
        {escuchando ? <><MicOff /> Detener</> : <><Mic /> Dictar</>}
      </Button>
      {escuchando && <span className="text-sm text-red-700">Escuchando… hacé una pausa entre producto y producto.</span>}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </>
  )
}
