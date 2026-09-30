import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDb } from '@/db/local'
import { igvBreakdown, money } from '@/lib/format'
import type { PaymentMethod } from '@/types/domain'
import { useCart } from './useCart'
import { checkout } from './checkout'

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' }, { id: 'yape', label: 'Yape' },
  { id: 'plin', label: 'Plin' }, { id: 'tarjeta', label: 'Tarjeta' },
]

export default function PosPage() {
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const { lines, total, dispatch } = useCart()

  const products = useLiveQuery(() => localDb.products.toArray(), [], [])
  const pendingCount = useLiveQuery(() => localDb.outbox.count(), [], 0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products.slice(0, 24)
    // Un lector de código de barras "teclea" el código y Enter: coincidencia exacta primero.
    return products.filter(p => p.sku.toLowerCase() === q || p.barcode === q ||
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 48)
  }, [products, query])

  const onSearchEnter = () => {
    const q = query.trim().toLowerCase()
    const exact = products.find(p => p.barcode === q || p.sku.toLowerCase() === q)
    if (exact) { dispatch({ type: 'addProduct', product: exact }); setQuery('') }
  }

  async function pay() {
    if (!lines.length) return
    await checkout(lines, method)
    dispatch({ type: 'clear' })
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[1fr_22rem]">
      <section>
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && onSearchEnter()}
               placeholder="Buscar o escanear (nombre, SKU, código de barras)"
               className="mb-3 w-full rounded border p-3" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {results.map(p => (
            <button key={p.id} onClick={() => dispatch({ type: 'addProduct', product: p })}
                    className="rounded-lg border bg-white p-3 text-left hover:border-amber-600">
              <div className="line-clamp-2 text-sm font-medium">{p.name}</div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="font-semibold">{money(p.price)}</span>
                <span className={p.stock <= p.min_stock ? 'text-red-600' : 'text-stone-500'}>{p.stock} {p.unit}</span>
              </div>
            </button>
          ))}
          {!results.length && <p className="col-span-full text-stone-500">Sin resultados. Usa “ítem libre” para impresiones o servicios.</p>}
        </div>
      </section>

      <aside className="h-fit space-y-3 rounded-xl bg-white p-4 shadow md:sticky md:top-4">
        <h2 className="font-semibold">Ticket {pendingCount > 0 && <span className="ml-2 rounded bg-amber-100 px-2 text-xs text-amber-800">{pendingCount} por sincronizar</span>}</h2>
        <ul className="divide-y">
          {lines.map(l => (
            <li key={l.key} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">{l.description}</span>
              <input type="number" min={0} step="any" value={l.qty} className="w-16 rounded border p-1"
                     onChange={e => dispatch({ type: 'setQty', key: l.key, qty: Number(e.target.value) })} />
              <span className="w-20 text-right">{money(l.qty * l.unit_price)}</span>
              <button aria-label="Quitar" onClick={() => dispatch({ type: 'remove', key: l.key })}>✕</button>
            </li>
          ))}
        </ul>

        <form className="flex gap-1" onSubmit={e => {
          e.preventDefault()
          const price = Number(customPrice)
          if (!customDesc || !(price >= 0)) return
          dispatch({ type: 'addCustom', description: customDesc, qty: 1, unit_price: price })
          setCustomDesc(''); setCustomPrice('')
        }}>
          <input value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Ítem libre" className="min-w-0 flex-1 rounded border p-1 text-sm" />
          <input value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="S/" inputMode="decimal" className="w-16 rounded border p-1 text-sm" />
          <button className="rounded border px-2 text-sm">+</button>
        </form>

        <div className="flex flex-wrap gap-1">
          {METHODS.map(m => (
            <button key={m.id} onClick={() => setMethod(m.id)}
                    className={`rounded border px-3 py-1 text-sm ${method === m.id ? 'bg-amber-700 text-white' : ''}`}>{m.label}</button>
          ))}
        </div>

        <dl className="space-y-0.5 text-sm text-stone-500">
          <div className="flex justify-between"><dt>Op. gravada</dt><dd>{money(igvBreakdown(total).base)}</dd></div>
          <div className="flex justify-between"><dt>IGV (18%)</dt><dd>{money(igvBreakdown(total).igv)}</dd></div>
        </dl>
        <div className="flex items-baseline justify-between text-lg font-semibold">
          <span>Total</span><span>{money(total)}</span>
        </div>
        <button disabled={!lines.length} onClick={pay}
                className="w-full rounded bg-amber-700 p-3 font-medium text-white disabled:opacity-40">Cobrar</button>
      </aside>
    </div>
  )
}
