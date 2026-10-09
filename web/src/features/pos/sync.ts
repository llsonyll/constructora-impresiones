import { localDb } from '@/db/local'
import { supabase } from '@/lib/supabase'
import type { Category, PendingSale, Product } from '@/types/domain'

/** Descarga el catálogo activo y las categorías (con su caja) y los guarda para uso offline. */
export async function refreshCatalog(): Promise<number> {
  const [prods, cats] = await Promise.all([
    supabase.from('products')
      .select('id, sku, barcode, name, brand, category_id, unit, price, stock, min_stock, active, image_path, track_stock, job_sources, job_color, job_duplex, job_keywords')
      .eq('active', true),
    supabase.from('categories').select('id, name, caja'),
  ])
  if (prods.error) throw prods.error
  if (cats.error) throw cats.error
  const data = prods.data
  await localDb.transaction('rw', localDb.products, localDb.categories, async () => {
    await localDb.products.clear()
    await localDb.products.bulkPut(data as Product[])
    await localDb.categories.clear()
    await localDb.categories.bulkPut(cats.data as Category[])
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
