import Dexie, { type Table } from 'dexie'
import type { Category, PendingSale, Product } from '@/types/domain'

/** Base local (IndexedDB): catálogo y categorías en caché + cola de ventas por sincronizar. */
class LocalDB extends Dexie {
  products!: Table<Product, string>
  outbox!: Table<PendingSale, string>
  categories!: Table<Category, number>

  constructor() {
    super('la-constructora')
    this.version(1).stores({
      products: 'id, sku, barcode, name, category_id',
      outbox: 'id, status, sold_at',
    })
    this.version(2).stores({ categories: 'id' })
  }
}

export const localDb = new LocalDB()
