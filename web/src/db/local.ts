import Dexie, { type Table } from 'dexie'
import type { PendingSale, Product } from '@/types/domain'

/** Base local (IndexedDB): catálogo en caché + cola de ventas por sincronizar. */
class LocalDB extends Dexie {
  products!: Table<Product, string>
  outbox!: Table<PendingSale, string>

  constructor() {
    super('la-constructora')
    this.version(1).stores({
      products: 'id, sku, barcode, name, category_id',
      outbox: 'id, status, sold_at',
    })
  }
}

export const localDb = new LocalDB()
