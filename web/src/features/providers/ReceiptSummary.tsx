import { useState } from 'react'
import { money } from '@/lib/format'
import { friendlyError, usePatchProduct } from '@/features/inventory/api'
import { suggestPrice } from '@/features/inventory/ProductEditor'
import type { ReceiptLine } from './api'

const LOW_MARGIN = 0.15
const margin = (price: number | null, cost: number) => (price ? (price - cost) / price : null)
const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * Tras recibir: costo anterior → nuevo y margen con el precio actual. Los que quedan con margen bajo
 * (o sin precio) salen primero, con el precio editable y una sugerencia de costo +35%.
 */
export default function ReceiptSummary({ lines, onDone }: { lines: ReceiptLine[]; onDone: () => void }) {
  const patch = usePatchProduct()
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, number>>({})
  const [error, setError] = useState('')

  const priceOf = (l: ReceiptLine) => saved[l.product_id] ?? l.price
  const needsAttention = (l: ReceiptLine) => { const m = margin(priceOf(l), l.new_cost); return m == null || m < LOW_MARGIN }
  const sorted = [...lines].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)))
  const pending = Object.entries(prices).filter(([id, v]) => {
    const n = Number(v.replace(',', '.'))
    return v.trim() !== '' && n > 0 && n !== priceOf(lines.find(l => l.product_id === id)!)
  })

  async function savePrices() {
    setError('')
    for (const [id, v] of pending) {
      const price = Number(v.replace(',', '.'))
      try {
        // Con precio el producto se puede vender: se activa (los recién creados desde la orden estaban inactivos).
        await patch.mutateAsync({ id, price, active: true })
        setSaved(s => ({ ...s, [id]: price }))
        setPrices(p => { const n = { ...p }; delete n[id]; return n })
      } catch (e) { setError(friendlyError(e)); return }
    }
  }

  const attention = lines.filter(needsAttention).length

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
        ✓ Mercadería recibida: entró el stock de {lines.length} producto{lines.length === 1 ? '' : 's'} y se actualizaron los costos.
        {attention > 0 && <> <strong>{attention}</strong> quedan sin precio o con margen menor a {pct(LOW_MARGIN)}: revísalos abajo.</>}
      </div>
      <ul className="divide-y rounded-lg bg-white shadow">
        {sorted.map(l => {
          const price = priceOf(l)
          const m = margin(price, l.new_cost)
          const changed = l.old_cost != null && Math.abs(l.new_cost - l.old_cost) >= 0.005
          const warn = needsAttention(l)
          const sug = suggestPrice(l.new_cost, 0.35)
          return (
            <li key={l.product_id} className={`space-y-2 p-3 ${warn ? 'bg-amber-50' : ''}`}>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-stone-500">
                    +{Number(l.qty)} {l.unit} · stock {Number(l.stock)} · costo{' '}
                    {changed && <><s>{money(l.old_cost!)}</s> → </>}
                    <span className={changed ? (l.new_cost > l.old_cost! ? 'text-red-600' : 'text-green-700') : ''}>{money(l.new_cost)}</span>
                    {l.old_cost == null && ' (nuevo)'}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="tabular-nums">{price != null ? money(price) : <span className="text-stone-400">sin precio</span>}</div>
                  <div className={`text-xs ${m != null && m >= LOW_MARGIN ? 'text-stone-500' : 'font-medium text-red-600'}`}>
                    {m != null ? `margen ${pct(m)}` : '—'}
                    {saved[l.product_id] != null && <span className="ml-1 text-green-700">✓</span>}
                  </div>
                </div>
              </div>
              {warn && (
                <div className="flex items-center gap-2">
                  <input inputMode="decimal" placeholder="Nuevo precio" value={prices[l.product_id] ?? ''}
                         onChange={e => setPrices(p => ({ ...p, [l.product_id]: e.target.value }))}
                         className="min-h-11 w-32 rounded border px-2 text-base tabular-nums" aria-label={`Precio ${l.name}`} />
                  <button onClick={() => setPrices(p => ({ ...p, [l.product_id]: sug.toFixed(2) }))}
                          className="min-h-11 rounded border bg-white px-3 text-xs">Costo +35% → {money(sug)}</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {pending.length > 0 && (
          <button onClick={savePrices} disabled={patch.isPending} className="min-h-11 rounded bg-amber-700 px-4 text-sm text-white disabled:opacity-50">
            {patch.isPending ? 'Guardando…' : `Guardar ${pending.length} precio${pending.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button onClick={onDone} className="min-h-11 rounded border bg-white px-4 text-sm">Listo</button>
      </div>
    </div>
  )
}
