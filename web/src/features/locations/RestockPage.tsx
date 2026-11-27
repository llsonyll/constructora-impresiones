import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import ProductImage from '@/components/ProductImage'
import { type InventoryProduct, useInventory } from '@/features/inventory/api'
import { depotIds, friendlyLocationError, useLocations, useMoveToLocation } from './api'
import { parseQty } from './count'
import { restockCandidates, suggestedMove } from './restock'

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * Reponer (`/inventario/reponer`): lo que se acabó en el estante (o está en su mínimo) y hay en el depósito.
 * Se escribe cuánto se baja (propuesta: el doble del mínimo, o todo lo del depósito si no tiene mínimo) y *Mover*
 * resta del depósito y suma al estante (RPC move_to_location). El stock no cambia: la mercadería solo cambia de lugar.
 */
export default function RestockPage() {
  const { data: products = [], isLoading } = useInventory()
  const { data: locations = [] } = useLocations()
  const move = useMoveToLocation()
  const depots = useMemo(() => depotIds(locations), [locations])
  const list = useMemo(() => restockCandidates<InventoryProduct>(products, depots), [products, depots])
  const [qty, setQty] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [error, setError] = useState<{ id: string; text: string } | null>(null)

  async function moveOne(c: (typeof list)[number]) {
    const n = parseQty(qty[c.product.id] ?? String(suggestedMove(c)))
    if (n == null || Number.isNaN(n) || n <= 0) { setError({ id: c.product.id, text: 'Escribe cuánto bajas.' }); return }
    setError(null); setBusy(c.product.id)
    try {
      await move.mutateAsync([{ product_id: c.product.id, from_location_id: c.depot.location_id, to_location_id: c.shelf.location_id, qty: n }])
      setDone(d => [...d, `${fmt(n)} ${c.product.unit} ${c.product.name} → ${c.shelf.code}`])
      setQty(q => { const next = { ...q }; delete next[c.product.id]; return next })
    } catch (e) { setError({ id: c.product.id, text: friendlyLocationError(e) }) } finally { setBusy(null) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-8 md:p-4">
      <PageHeader title="Reponer desde el depósito" back="/inventario/ubicaciones" backLabel="Ubicaciones" />
      <p className="text-sm text-stone-600">
        Lo que se acabó en el estante (o está en su mínimo) y hay en el depósito. Baja lo que indiques y toca
        <b> Mover</b>: se resta del depósito y se suma al estante. El stock no cambia.
      </p>
      {done.length > 0 && (
        <ul className="space-y-0.5 rounded-lg bg-green-50 p-2 text-sm text-green-800">
          {done.map((t, i) => <li key={i}>✓ {t}</li>)}
        </ul>
      )}
      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {!isLoading && !list.length && (
        <p className="rounded-lg bg-white p-6 text-center text-sm text-stone-500">
          Nada por reponer. Aquí aparecen los productos con cantidad anotada en un estante y en el depósito
          (se anotan con <i>Contar este casillero</i>).
        </p>
      )}
      <ul className="divide-y rounded-lg bg-white shadow">
        {list.map(c => {
          const p = c.product
          const v = qty[p.id] ?? String(suggestedMove(c))
          return (
            <li key={p.id} className="space-y-1.5 p-2">
              <div className="flex items-center gap-2">
                <ProductImage path={p.image_path} size="xs" className="size-10 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-stone-500">
                    <Link to={`/inventario/ubicaciones?ir=${encodeURIComponent(c.depot.code)}`} className="font-mono underline">{c.depot.code}</Link> ~{fmt(c.depot.qty ?? 0)}
                    <ArrowRight className="mx-1 inline size-3.5" aria-label="a" />
                    <Link to={`/inventario/ubicaciones?ir=${encodeURIComponent(c.shelf.code)}`} className="font-mono underline">{c.shelf.code}</Link> ~{fmt(c.shelfQty)}
                    {p.min_stock > 0 && ` (mín. ${fmt(p.min_stock)})`} · {p.unit}
                  </div>
                </div>
                <input inputMode="decimal" value={v} onChange={e => setQty(q => ({ ...q, [p.id]: e.target.value }))}
                       aria-label={`Cuánto bajar de ${p.name}`} className="min-h-11 w-16 shrink-0 rounded border px-2 text-right text-base tabular-nums" />
                <button onClick={() => moveOne(c)} disabled={busy === p.id}
                        className="min-h-11 shrink-0 rounded-lg bg-amber-700 px-3 text-sm text-white disabled:opacity-50">{busy === p.id ? '…' : 'Mover'}</button>
              </div>
              {error?.id === p.id && <p className="text-sm text-red-600">{error.text}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
