import { useState } from 'react'
import type { InventoryProduct } from '@/features/inventory/api'
import { friendlyLocationError, useProductLocation } from './api'
import LocationPicker from './LocationPicker'

/** Mercadería recién recibida: cuánto entró y si ya se anotó en alguna ubicación (lo guarda quien llama). */
export interface ReceivedPlacement { qty: number; placed: boolean; onPlaced: () => void }

/**
 * Ubicaciones de un producto: agregar (autocompletado), marcar la principal, cantidad referencial y quitar.
 * Con `received`, la primera ubicación que se agrega (o el botón "+N aquí") suma lo recibido a su cantidad.
 */
export default function ProductLocations({ product, received, className = 'mt-6 border-t pt-4' }: {
  product: InventoryProduct; received?: ReceivedPlacement; className?: string
}) {
  const mut = useProductLocation()
  const [error, setError] = useState('')
  const run = async (a: Parameters<typeof mut.mutateAsync>[0]) => {
    setError('')
    try { await mut.mutateAsync(a); return true } catch (e) { setError(friendlyLocationError(e)); return false }
  }
  const placeHere = async (locationId: number, current: number | null) => {
    if (!received || received.placed) return
    if (await run({ op: 'qty', productId: product.id, locationId, qty: (current ?? 0) + received.qty })) received.onPlaced()
  }
  const add = async (locationId: number) => {
    if (await run({ op: 'add', productId: product.id, locationId }) && received && !received.placed) await placeHere(locationId, null)
  }

  return (
    <section className={className}>
      <h3 className="mb-1 font-semibold">Ubicación en tienda</h3>
      <p className="mb-2 text-xs text-stone-500">★ = principal (la que se muestra en Ventas). La cantidad es solo referencial.</p>
      <ul className="mb-2 divide-y rounded-lg border">
        {product.locations.map(l => (
          <li key={l.location_id} className="flex items-center gap-2 px-1">
            <button onClick={() => !l.is_primary && run({ op: 'primary', productId: product.id, locationId: l.location_id })}
                    aria-pressed={l.is_primary} aria-label={l.is_primary ? `${l.code} es la principal` : `Marcar ${l.code} como principal`}
                    className={`grid size-11 shrink-0 place-items-center text-xl ${l.is_primary ? 'text-amber-600' : 'text-stone-300'}`}>★</button>
            <span className="flex-1 font-mono font-medium">{l.code}</span>
            {received && !received.placed && (
              <button onClick={() => placeHere(l.location_id, l.qty)} disabled={mut.isPending}
                      className="min-h-11 shrink-0 rounded border border-amber-300 bg-amber-50 px-2 text-xs text-amber-900 disabled:opacity-50">
                +{received.qty} aquí
              </button>
            )}
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
                      onPick={loc => void add(loc.id)} />
      {mut.isPending && <p className="mt-1 text-xs text-stone-500">Guardando…</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </section>
  )
}
