import { localDb } from '@/db/local'
import { currentShift, round2 } from '@/lib/format'
import type { CartLine, PaymentMethod, PendingSale } from '@/types/domain'
import { flushOutbox } from './sync'

/** Guarda SIEMPRE primero en local (funciona sin internet) y luego intenta sincronizar. */
export async function checkout(lines: CartLine[], payment_method: PaymentMethod,
                               extra: Pick<PendingSale, 'customer_name' | 'customer_doc' | 'note'> = {}) {
  const sale: PendingSale = {
    id: crypto.randomUUID(),
    shift: currentShift(),
    payment_method,
    sold_at: new Date().toISOString(),
    items: lines.map(({ key: _k, ...l }) => l),
    total: round2(lines.reduce((s, l) => s + round2(l.qty * l.unit_price), 0)),
    status: 'pending',
    attempts: 0,
    ...extra,
  }
  await localDb.outbox.add(sale)
  // Descuento optimista del stock local para no vender de más mientras no hay conexión.
  await localDb.transaction('rw', localDb.products, async () => {
    for (const l of lines) if (l.product_id) await localDb.products.where('id').equals(l.product_id)
      .modify(p => { p.stock -= l.qty })
  })
  void flushOutbox()
  return sale
}
