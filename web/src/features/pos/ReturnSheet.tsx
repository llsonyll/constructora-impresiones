import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Search, Undo2 } from 'lucide-react'
import Sheet from '@/components/Sheet'
import CajaIcon from '@/components/CajaIcon'
import { CAJA_LABEL } from '@/lib/caja'
import { money } from '@/lib/format'
import { fetchSalesForReturn } from '@/features/sales/api'
import type { CartLine } from '@/types/domain'
import {
  RETURN_WINDOW_DAYS, type ReturnLine, type ReturnableSale, daysSince, remaining, returnLines, returnedValue,
} from './returns'

const when = (iso: string) => {
  const d = daysSince(iso)
  const hour = new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (d === 0) return `hoy ${hour}`
  if (d === 1) return `ayer ${hour}`
  return `${new Date(iso).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })} ${hour}`
}
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * Cambio o devolución: se busca la venta (número o producto, últimos 7 días, de cualquier cajero), se elige qué
 * devuelve el cliente y pasa al ticket de su caja en negativo, al precio que pagó. Luego se agrega lo que se lleva
 * y se cobra (o devuelve) la diferencia. `saleNumber` abre directo esa venta (desde Hoy).
 */
export default function ReturnSheet({ saleNumber, current = [], onAdd, onClose }: {
  saleNumber?: number
  current?: CartLine[]                       // líneas devueltas que ya están en el ticket (se editan aquí)
  onAdd: (sale: ReturnableSale, lines: ReturnLine[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(saleNumber != null ? `#${saleNumber}` : '')
  // Busca al dejar de escribir (no una consulta por tecla).
  const [search, setSearch] = useState(query.trim())
  useEffect(() => { const t = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(t) }, [query])
  const [sale, setSale] = useState<ReturnableSale | null>(null)
  const [picks, setPicks] = useState<Record<number, number>>({})
  const online = navigator.onLine

  const results = useQuery({
    queryKey: ['sales-for-return', search],
    queryFn: () => fetchSalesForReturn(search),
    enabled: online,
    staleTime: 0,
    meta: { silent: true },
  })

  function open(s: ReturnableSale) {
    setSale(s)
    // Lo que ya estaba en el ticket de esta venta queda marcado para corregirlo.
    const ids = new Set(s.items.map(i => i.id))
    setPicks(Object.fromEntries(current.filter(l => l.returns_item_id != null && ids.has(l.returns_item_id))
      .map(l => [l.returns_item_id!, -l.qty])))
  }

  // Desde Hoy: si la búsqueda por número trae esa venta, se abre sola.
  useEffect(() => {
    if (saleNumber == null || sale || !results.data) return
    const found = results.data.find(s => s.number === saleNumber)
    if (found) open(found)
  }, [results.data])

  const lines = sale ? returnLines(sale, picks) : []
  const value = returnedValue(lines)
  const bump = (id: number, d: number, max: number) =>
    setPicks(p => ({ ...p, [id]: Math.min(max, Math.max(0, Math.round(((p[id] ?? 0) + d) * 1000) / 1000)) }))

  return (
    <Sheet onClose={onClose} label="Cambio o devolución" className="space-y-3 sm:max-w-lg">
      <div className="flex items-center gap-2">
        {sale && (
          <button onClick={() => setSale(null)} className="-ml-2 grid size-11 place-items-center" aria-label="Volver a la búsqueda">
            <ArrowLeft className="size-5" />
          </button>
        )}
        <h2 className="flex-1 text-lg font-semibold"><Undo2 className="mr-1 inline size-5 align-[-0.2em]" />Cambio o devolución</h2>
      </div>

      {!online && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">Necesitas internet para buscar la venta.</p>}

      {!sale && online && (
        <>
          <label className="flex items-center gap-2 rounded-lg border px-3">
            <Search className="size-5 shrink-0 text-stone-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} autoFocus={saleNumber == null}
                   placeholder="N° de venta o producto (1234, codo pvc)" aria-label="Buscar venta"
                   className="min-h-12 min-w-0 flex-1 text-base outline-none" />
          </label>
          <p className="text-xs text-stone-500">Ventas de los últimos {RETURN_WINDOW_DAYS} días que todavía tienen algo por devolver.</p>
          {results.isLoading && <p className="text-sm text-stone-500">Buscando…</p>}
          {results.error && <p className="text-sm text-red-600">No se pudo buscar: {(results.error as Error).message}</p>}
          <ul className="max-h-[55vh] divide-y overflow-y-auto rounded-lg border">
            {results.data?.map(s => (
              <li key={s.id}>
                <button onClick={() => open(s)} className="w-full p-3 text-left hover:bg-amber-50">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-semibold">#{s.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-stone-500">
                      {when(s.sold_at)} · <CajaIcon caja={s.caja} /> {CAJA_LABEL[s.caja]}{s.cashier_name && ` · ${s.cashier_name}`}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(s.total)}</span>
                  </div>
                  <div className="truncate text-sm">{s.items.map(i => `${qtyText(i.qty)}× ${i.description}`).join(', ')}</div>
                  {s.customer_name && <div className="truncate text-xs text-stone-500">{s.customer_name}</div>}
                </button>
              </li>
            ))}
            {results.data && !results.data.length && (
              <li className="p-4 text-center text-sm text-stone-500">
                {search ? 'Ninguna venta de los últimos 7 días coincide (o ya se devolvió todo).' : 'No hay ventas recientes por devolver.'}
              </li>
            )}
          </ul>
        </>
      )}

      {sale && (
        <>
          <div className="text-sm text-stone-600">
            Venta <b className="font-mono">#{sale.number}</b> · {when(sale.sold_at)} · <CajaIcon caja={sale.caja} /> {CAJA_LABEL[sale.caja]} · {money(sale.total)}
          </div>
          <p className="text-sm text-stone-500">¿Qué devuelve el cliente? Se descuenta al precio que pagó.</p>
          <ul className="divide-y rounded-lg border">
            {sale.items.map(i => {
              const max = remaining(i)
              const n = picks[i.id] ?? 0
              return (
                <li key={i.id} className={`flex items-center gap-2 py-1 pl-3 ${max ? '' : 'opacity-50'}`}>
                  <button onClick={() => bump(i.id, Math.min(1, max - n), max)} disabled={!max || n >= max} className="min-h-11 min-w-0 flex-1 py-1 text-left">
                    <span className="block text-sm font-medium">{i.description}</span>
                    <span className="text-xs tabular-nums text-stone-500">
                      {qtyText(i.qty)} × {money(i.unit_price)}{i.returned_qty > 0 && ` · ya devuelto ${qtyText(i.returned_qty)}`}{!max && ' · nada por devolver'}
                    </span>
                  </button>
                  {max > 0 && (
                    <div className="flex items-center rounded border">
                      <button className="grid size-11 place-items-center text-lg" onClick={() => bump(i.id, -1, max)} aria-label={`Menos ${i.description}`}>−</button>
                      <span className="w-10 text-center tabular-nums" aria-label={`Devuelve de ${i.description}`}>{qtyText(n)}</span>
                      <button className="grid size-11 place-items-center text-lg" onClick={() => bump(i.id, Math.min(1, max - n), max)} aria-label={`Más ${i.description}`}>+</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-stone-500">
            Luego agrega lo que se lleva y cobra la diferencia. Si no se lleva nada, es una devolución de dinero (solo administrador).
          </p>
          <button onClick={() => onAdd(sale, lines)} disabled={!lines.length && !current.some(l => l.returns_item_id != null)}
                  className="flex min-h-12 w-full items-center justify-between rounded-lg bg-rose-700 px-4 font-medium text-white disabled:opacity-40">
            <span>{lines.length ? 'Pasar al ticket' : 'Quitar lo devuelto del ticket'}</span>
            {lines.length > 0 && <span className="tabular-nums">−{money(value)}</span>}
          </button>
        </>
      )}
    </Sheet>
  )
}
