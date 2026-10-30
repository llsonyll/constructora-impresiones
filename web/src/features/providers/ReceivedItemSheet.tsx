import { useState } from 'react'
import Sheet from '@/components/Sheet'
import { friendlyError, type InventoryProduct, usePatchProduct } from '@/features/inventory/api'
import { PhotoSection } from '@/features/inventory/ProductEditor'
import ProductLocations, { type ReceivedPlacement } from '@/features/locations/ProductLocations'
import type { ReceiptLine } from './api'

/**
 * Detalle de un producto recién recibido: dónde se guardó (sumando lo que entró a esa ubicación),
 * descripción / notas y foto. Cada parte se guarda al momento; "Ficha completa" abre el editor del inventario.
 */
export default function ReceivedItemSheet({ line, product, received, onEdit, onClose }: {
  line: ReceiptLine; product: InventoryProduct; received: ReceivedPlacement; onEdit: () => void; onClose: () => void
}) {
  return (
    <Sheet onClose={onClose} label={product.name} className="space-y-4 sm:max-w-lg">
      <div>
        <h2 className="font-semibold leading-snug">{product.name}</h2>
        <p className="text-xs text-stone-500">
          {product.sku}{product.brand && ` · ${product.brand}`} · entraron {Number(line.qty)} {line.unit} · stock {Number(product.stock)}
        </p>
      </div>
      <ProductLocations product={product} received={received} className="" />
      {received.placed && <p className="-mt-2 text-xs text-green-700">✓ Lo recibido ya se sumó a una ubicación.</p>}
      <NotesSection product={product} />
      <PhotoSection product={product} className="" />
      <div className="flex justify-between gap-2 border-t pt-3">
        <button onClick={onEdit} className="min-h-11 rounded border px-3 text-sm">Ficha completa</button>
        <button onClick={onClose} className="min-h-11 rounded bg-amber-700 px-5 text-sm text-white">Listo</button>
      </div>
    </Sheet>
  )
}

function NotesSection({ product }: { product: InventoryProduct }) {
  const patch = usePatchProduct()
  const [notes, setNotes] = useState(product.notes ?? '')
  const [error, setError] = useState('')
  const changed = notes.trim() !== (product.notes ?? '')

  async function save() {
    setError('')
    try { await patch.mutateAsync({ id: product.id, notes: notes.trim() || null }) } catch (e) { setError(friendlyError(e)) }
  }

  return (
    <section>
      <h3 className="mb-1 font-semibold">Descripción / notas</h3>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} aria-label="Descripción o notas"
                placeholder="Medidas, color, para qué sirve, cómo viene empacado…"
                className="w-full rounded border px-2 py-2 text-base sm:text-sm" />
      <div className="flex items-center justify-end gap-2">
        {error && <p className="flex-1 text-sm text-red-600">{error}</p>}
        {!changed && !!product.notes && patch.isSuccess && <span className="text-xs text-green-700">✓ Guardado</span>}
        {changed && (
          <button onClick={save} disabled={patch.isPending} className="min-h-11 rounded border px-3 text-sm disabled:opacity-50">
            {patch.isPending ? 'Guardando…' : 'Guardar nota'}
          </button>
        )}
      </div>
    </section>
  )
}
