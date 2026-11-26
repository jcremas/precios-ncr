import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * `fija`: para tablas largas. En pantallas medianas o grandes la tabla scrollea adentro de su
 * caja (alto de la ventana) y los títulos de las columnas quedan fijos arriba.
 */
function Table({ className, fija, ...props }: React.ComponentProps<'table'> & { fija?: boolean }) {
  return (
    <div className={cn('relative w-full overflow-x-auto rounded-md border',
      fija && 'md:max-h-[calc(100dvh-7rem)] md:overflow-y-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted [&_thead_th]:shadow-[inset_0_-1px_0_var(--color-border)]')}>
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}
function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('bg-muted/60 [&_tr]:border-b', className)} {...props} />
}
function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-b transition-colors hover:bg-muted/40', className)} {...props} />
}
function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return <th className={cn('h-9 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground', className)} {...props} />
}
function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('p-2 align-middle whitespace-nowrap', className)} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
