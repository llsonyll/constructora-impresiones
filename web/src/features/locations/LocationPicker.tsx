import { useMemo, useState } from 'react'
import type { Location } from '@/types/domain'
import { normalizeCode, useLocations } from './api'

/**
 * Buscador de ubicación con autocompletado: escribir "e2n5", "E2-N5" o solo "E4" y elegir de la lista.
 * Solo ofrece ubicaciones activas y no asignadas todavía (`exclude`).
 */
export default function LocationPicker({ exclude = [], onPick, placeholder = 'Agregar ubicación (p. ej. E2-N5)' }: {
  exclude?: number[]; onPick: (l: Location) => void; placeholder?: string
}) {
  const { data: locations = [] } = useLocations()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    const n = normalizeCode(q.trim())
    const pool = locations.filter(l => l.active && !exclude.includes(l.id))
    if (!n) return pool.slice(0, 8)
    const starts = pool.filter(l => l.code.startsWith(n))
    const rest = pool.filter(l => !l.code.startsWith(n) && (l.code.includes(n) || (l.description?.toUpperCase().includes(q.trim().toUpperCase()) ?? false)))
    return [...starts, ...rest].slice(0, 12)
  }, [locations, exclude, q])

  const pick = (l: Location) => { onPick(l); setQ(''); setOpen(false) }

  return (
    <div className="relative">
      <input value={q} placeholder={placeholder} aria-label="Buscar ubicación" autoCapitalize="characters" autoComplete="off"
             onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
             onBlur={() => setTimeout(() => setOpen(false), 150)}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (options[0]) pick(options[0]) } }}
             className="min-h-11 w-full rounded-lg border px-3 text-base uppercase placeholder:normal-case" />
      {open && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-white shadow-lg">
          {options.map(l => (
            <li key={l.id}>
              {/* onMouseDown: elegir antes de que el blur cierre la lista. */}
              <button type="button" role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); pick(l) }}
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-amber-50">
                <span className="font-mono font-medium">{l.code}</span>
                {l.description && <span className="truncate text-xs text-stone-500">{l.description}</span>}
              </button>
            </li>
          ))}
          {!options.length && <li className="px-3 py-2 text-sm text-stone-500">Sin coincidencias</li>}
        </ul>
      )}
    </div>
  )
}
