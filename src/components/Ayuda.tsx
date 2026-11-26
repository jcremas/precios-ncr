import type { ReactNode } from 'react'

/**
 * Texto de ayuda corto (una línea) y, si hace falta, el detalle plegado en "¿Cómo funciona?".
 * Reemplaza a CardDescription en las pantallas con explicaciones largas.
 */
export function Ayuda({ resumen, children }: { resumen: ReactNode; children?: ReactNode }) {
  return (
    <div className="text-sm text-muted-foreground">
      <p>{resumen}</p>
      {children && (
        <details className="mt-1">
          <summary className="w-fit cursor-pointer text-xs font-medium text-primary select-none hover:underline">¿Cómo funciona?</summary>
          <div className="mt-2 grid gap-1.5 rounded-md bg-muted/60 p-3 text-sm">{children}</div>
        </details>
      )}
    </div>
  )
}
