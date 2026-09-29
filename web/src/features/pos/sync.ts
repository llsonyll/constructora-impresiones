import { localDb } from '@/db/local'
import { supabase } from '@/lib/supabase'
import type { PendingSale, Product } from '@/types/domain'

/** Descarga el catálogo activo y lo guarda para uso offline. */
export async function refreshCatalog(): Promise<number> {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, barcode, name, category_id, unit, price, stock, min_stock, active')
    .eq('active', true)
  if (error) throw error
  await localDb.transaction('rw', localDb.products, async () => {
    await localDb.products.clear()
    await localDb.products.bulkPut(data as Product[])
  })
  return data.length
}

let syncing = false

/** Envía las ventas pendientes en orden. Idempotente: reintentar es seguro. */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  if (syncing || !navigator.onLine) return { sent: 0, failed: 0 }
  syncing = true
  let sent = 0, failed = 0
  try {
    const pending = await localDb.outbox.orderBy('sold_at').toArray()
    for (const sale of pending) {
      const { total: _t, status: _s, error: _e, attempts: _a, ...payload } = sale
      const { error } = await supabase.rpc('create_sale', { p_sale: payload })
      if (!error) {
        await localDb.outbox.delete(sale.id)
        sent++
      } else {
        failed++
        await localDb.outbox.update(sale.id, {
          status: 'error', error: error.message, attempts: sale.attempts + 1,
        } satisfies Partial<PendingSale>)
        // Error de red: cortar; error de negocio: seguir con las demás.
        if (error.message.includes('Failed to fetch')) break
      }
    }
  } finally {
    syncing = false
  }
  return { sent, failed }
}

export function startAutoSync(onDone?: () => void) {
  const run = () => flushOutbox().then(onDone)
  window.addEventListener('online', run)
  const t = setInterval(run, 30_000)
  run()
  return () => { window.removeEventListener('online', run); clearInterval(t) }
}
