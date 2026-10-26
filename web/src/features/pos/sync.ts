import { localDb } from '@/db/local'
import { supabase } from '@/lib/supabase'
import type { Category, PendingSale, Product, SynonymRow } from '@/types/domain'

/** Descarga el catálogo activo, las categorías (con su caja) y los sinónimos de búsqueda, y los guarda para uso offline. */
export async function refreshCatalog(): Promise<number> {
  const [prods, cats, syns] = await Promise.all([
    supabase.from('products')
      .select('id, sku, barcode, name, brand, category_id, unit, price, stock, min_stock, active, image_path, track_stock, job_sources, job_color, job_duplex, job_keywords, presentations, aliases, product_locations(is_primary, locations(code))')
      .eq('active', true),
    supabase.from('categories').select('id, name, caja'),
    supabase.from('search_synonyms').select('id, terms'),
  ])
  if (prods.error) throw prods.error
  if (cats.error) throw cats.error
  if (syns.error) throw syns.error
  type Row = Product & { product_locations: { is_primary: boolean; locations: { code: string } | null }[] }
  // Ubicaciones como lista de códigos, la principal primero (solo informativo en el POS).
  const data = (prods.data as unknown as Row[]).map(({ product_locations, ...p }) => ({
    ...p,
    locations: [...product_locations].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map(l => l.locations?.code).filter((c): c is string => !!c),
  }))
  await localDb.transaction('rw', localDb.products, localDb.categories, localDb.synonyms, async () => {
    await localDb.products.clear()
    await localDb.products.bulkPut(data as Product[])
    await localDb.categories.clear()
    await localDb.categories.bulkPut(cats.data as Category[])
    await localDb.synonyms.clear()
    await localDb.synonyms.bulkPut(syns.data as SynonymRow[])
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
      const { total: _t, status: _s, error: _e, attempts: _a, quote_id, ...payload } = sale
      const { error } = await supabase.rpc('create_sale', { p_sale: payload })
      if (!error) {
        // Venta de una cotización: queda marcada como vendida. Si falla, la venta ya está; solo no se enlaza.
        if (quote_id) await supabase.rpc('link_quote_sale', { p_quote: quote_id, p_sale: sale.id })
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
