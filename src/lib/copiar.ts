/** Copia una tabla al portapapeles en dos formatos: HTML compacto con estilos
 *  en línea (Outlook los respeta al pegar) y texto simple de respaldo. */
export interface ColumnaCopia {
  titulo: string
  derecha?: boolean
}

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Tabla compacta con estilos en línea (el mismo formato al copiar y en el correo). */
export function tablaHtml(titulo: string, columnas: ColumnaCopia[], filas: string[][]) {
  const celda = 'padding:3px 8px;border:1px solid #d0d7e2;'
  const cab = `${celda}background:#1f3a5f;color:#ffffff;font-weight:bold;`
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#222222;">
<p style="margin:0 0 6px 0;font-size:11pt;font-weight:bold;color:#1f3a5f;">${esc(titulo)}</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:10pt;">
<tr>${columnas.map((c) => `<th style="${cab}text-align:${c.derecha ? 'right' : 'left'};">${esc(c.titulo)}</th>`).join('')}</tr>
${filas.map((f, i) => {
  const fondo = i % 2 ? 'background:#f3f6fa;' : 'background:#ffffff;'
  return `<tr>${f.map((v, j) => `<td style="${celda}${fondo}${columnas[j]?.derecha ? 'text-align:right;white-space:nowrap;' : ''}">${esc(v)}</td>`).join('')}</tr>`
}).join('\n')}
</table></div>`
}

export async function copiarTabla(titulo: string, columnas: ColumnaCopia[], filas: string[][], textoFila: (f: string[]) => string) {
  const texto = [titulo, '', ...filas.map(textoFila)].join('\n')
  const html = tablaHtml(titulo, columnas, filas)
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([texto], { type: 'text/plain' }),
    })])
  } catch {
    await navigator.clipboard.writeText(texto)
  }
}
