import { localDb } from '@/db/local'
import { currentShift, round2 } from '@/lib/format'
import type { CartLine, PaymentMethod, PendingSale } from '@/types/domain'
import { flushOutbox } from './sync'

/**
 * Guarda SIEMPRE primero en local (funciona sin internet) y luego intenta sincronizar.
 * `id` identifica el ticket: repetir la llamada con el mismo id no crea una segunda venta
 * ni vuelve a descontar stock (create_sale en el servidor también es idempotente por id).
 */
export async function checkout(lines: CartLine[], payment_method: PaymentMethod,
                               extra: Pick<PendingSale, 'customer_name' | 'customer_doc' | 'note'> = {},
                               id: string = crypto.randomUUID()) {
  const sale: PendingSale = {
    id,
    shift: currentShift(),
    payment_method,
    sold_at: new Date().toISOString(),
    items: lines.map(({ key: _k, ...l }) => l),
    total: round2(lines.reduce((s, l) => s + round2(l.qty * l.unit_price), 0)),
    status: 'pending',
    attempts: 0,
    ...extra,
  }
  // Alta en outbox y descuento optimista del stock local en una sola transacción:
  // si el ticket ya estaba en la cola, no se toca nada.
  const added = await localDb.transaction('rw', localDb.outbox, localDb.products, async () => {
    if (await localDb.outbox.get(id)) return false
    await localDb.outbox.add(sale)
    for (const l of lines) if (l.product_id) await localDb.products.where('id').equals(l.product_id)
      .modify(p => { if (p.track_stock !== false) p.stock -= l.qty })
    return true
  })
  if (added) void flushOutbox()
  return sale
}
