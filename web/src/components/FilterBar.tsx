import { useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import Sheet from '@/components/Sheet'
import { useMediaQuery } from '@/hooks/use-media-query'

interface Props {
  /** Filtros activos en una línea ("Este mes · Ferretería"); vacío = sin filtros. */
  summary: string
  children: ReactNode
  /** Quita todos los filtros (se ofrece cuando hay alguno activo). */
  onReset?: () => void
}

/**
 * Filtros de una pantalla de números: en escritorio, a la vista; en el celular, un botón "Filtros" con el
 * resumen que abre una hoja, para que los totales queden en la primera pantalla.
 */
export default function FilterBar({ summary, children, onReset }: Props) {
  const desktop = useMediaQuery('(min-width: 768px)')
  const [open, setOpen] = useState(false)
  if (desktop) return <div className="space-y-2">{children}</div>
  return (
    <>
      <div className="flex gap-2">
        <button onClick={() => setOpen(true)} aria-haspopup="dialog"
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-white px-3 text-left text-sm">
          <SlidersHorizontal className="size-4 shrink-0 text-stone-500" />
          <span className="shrink-0 font-medium">Filtros</span>
          {summary && <span className="truncate text-stone-500">{summary}</span>}
        </button>
        {summary && onReset && <button onClick={onReset} className="min-h-11 shrink-0 rounded-lg border bg-white px-3 text-sm">Quitar</button>}
      </div>
      {open && (
        <Sheet onClose={() => setOpen(false)} label="Filtros" className="space-y-3">
          <h2 className="pt-1 font-semibold">Filtros</h2>
          {children}
          <button onClick={() => setOpen(false)} className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white">Ver resultados</button>
        </Sheet>
      )}
    </>
  )
}
