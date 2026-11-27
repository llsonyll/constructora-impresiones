// Aviso al vender sin stock en el sistema. No bloquea la venta (lo que está en el mostrador se vende), pero el
// cajero se entera y el producto queda en negativo, que es la señal para contarlo (Inventario → Stock negativo).

interface StockLine { product_id?: string | null; qty: number; factor?: number; returns_item_id?: number | null }
interface StockProduct { id: string; name: string; unit: string; stock: number; track_stock?: boolean }

/** Unidades base de un producto ya en el ticket (sin contar lo devuelto en un cambio). */
export function inTicket(lines: StockLine[], productId: string) {
  return lines.filter(l => l.product_id === productId && l.returns_item_id == null)
    .reduce((s, l) => s + l.qty * (l.factor ?? 1), 0)
}

/**
 * Mensaje si al agregar `adding` unidades base el ticket pasa lo que hay en el sistema; null si alcanza o es un
 * servicio. Avisa una sola vez por producto: cuando se cruza el límite, no en cada toque siguiente.
 */
export function stockWarning(p: StockProduct, already: number, adding: number): string | null {
  if (p.track_stock === false || adding <= 0) return null
  const available = Math.max(p.stock, 0)
  if (already + adding <= p.stock || already > available) return null
  return available === 0
    ? `${p.name}: sin stock en el sistema. Se vende igual; queda para contar.`
    : `${p.name}: en el sistema solo hay ${fmt(available)} ${p.unit}. Se vende igual; queda para contar.`
}

/** El ticket lleva más de lo que hay en el sistema. */
export const overStock = (p: Pick<StockProduct, 'stock' | 'track_stock'>, qty: number) => p.track_stock !== false && qty > p.stock

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)
