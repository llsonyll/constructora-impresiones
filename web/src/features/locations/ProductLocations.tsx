import { useState } from 'react'
import type { InventoryProduct } from '@/features/inventory/api'
import { friendlyLocationError, useProductLocation } from './api'
import LocationPicker from './LocationPicker'

/** Ubicaciones de un producto: agregar (autocompletado), marcar la principal, cantidad referencial y quitar. */
export default function ProductLocations({ product }: { product: InventoryProduct }) {
  const mut = useProductLocation()
  const [error, setError] = useState('')
  const run = async (a: Parameters<typeof mut.mutateAsync>[0]) => {
    setError('')
    try { await mut.mutateAsync(a) } catch (e) { setError(friendlyLocationError(e)) }
  }

  return (
    <section className="mt-6 border-t pt-4">
      <h3 className="mb-1 font-semibold">Ubicación en tienda</h3>
      <p className="mb-2 text-xs text-stone-500">★ = principal (la que se muestra en Ventas). La cantidad es solo referencial.</p>
      <ul className="mb-2 divide-y rounded-lg border">
        {product.locations.map(l => (
          <li key={l.location_id} className="flex items-center gap-2 px-1">
            <button onClick={() => !l.is_primary && run({ op: 'primary', productId: product.id, locationId: l.location_id })}
                    aria-pressed={l.is_primary} aria-label={l.is_primary ? `${l.code} es la principal` : `Marcar ${l.code} como principal`}
                    className={`grid size-11 shrink-0 place-items-center text-xl ${l.is_primary ? 'text-amber-600' : 'text-stone-300'}`}>★</button>
            <span className="flex-1 font-mono font-medium">{l.code}</span>
            <input inputMode="decimal" placeholder="cant." aria-label={`Cantidad referencial en ${l.code}`}
                   defaultValue={l.qty ?? ''} key={`${l.location_id}:${l.qty}`}
                   onBlur={e => {
                     const v = e.target.value.trim().replace(',', '.')
                     const qty = v === '' ? null : Number(v)
                     if (qty !== l.qty && (qty == null || (!Number.isNaN(qty) && qty >= 0)))
                       void run({ op: 'qty', productId: product.id, locationId: l.location_id, qty })
                   }}
                   className="min-h-11 w-20 rounded border px-2 text-right text-base tabular-nums sm:text-sm" />
            <button onClick={() => run({ op: 'remove', productId: product.id, locationId: l.location_id })}
                    aria-label={`Quitar ${l.code}`} className="grid size-11 shrink-0 place-items-center text-stone-500">✕</button>
          </li>
        ))}
        {!product.locations.length && <li className="p-3 text-sm text-stone-500">Sin ubicación todavía.</li>}
      </ul>
      <LocationPicker exclude={product.locations.map(l => l.location_id)}
                      onPick={loc => run({ op: 'add', productId: product.id, locationId: loc.id })} />
      {mut.isPending && <p className="mt-1 text-xs text-stone-500">Guardando…</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </section>
  )
}
