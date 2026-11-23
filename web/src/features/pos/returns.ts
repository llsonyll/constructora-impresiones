// Cambios y devoluciones: lógica pura (sin React ni Supabase), probada en returns.test.ts.
// Un cambio es una venta con líneas devueltas en negativo (`returns_item_id` = línea de la venta original).
// El servidor (create_sale) valida todo de nuevo: plazo, caja, cantidad pendiente y precio original.

/** Días después de la venta (fechas de Lima) en que todavía se acepta un cambio o devolución. */
export const RETURN_WINDOW_DAYS = 7

/** Línea de una venta que se puede devolver (de `sales_for_return`). `qty` y `returned_qty` en unidades de la línea. */
export interface ReturnableItem {
  id: number
  product_id: string | null
  description: string
  qty: number
  unit_price: number
  factor: number
  returned_qty: number
}

export interface ReturnableSale {
  id: string
  number: number
  sold_at: string
  caja: 'ferreteria' | 'copias'
  total: number
  payment_method: string
  customer_name: string | null
  cashier_name: string | null
  items: ReturnableItem[]
}

/** Línea devuelta lista para el ticket (sin `key`): cantidad negativa, al precio y presentación de la venta. */
export interface ReturnLine {
  product_id: string | null
  description: string
  qty: number
  unit_price: number
  factor?: number
  returns_item_id: number
  returns_sale_number: number
}

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Fecha `YYYY-MM-DD` en hora de Lima (la tienda), sin importar la zona del equipo. */
export function limaDay(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(typeof d === 'string' ? new Date(d) : d)
}

/** Días de calendario (Lima) entre la venta y `now`: 0 = el mismo día. */
export function daysSince(soldAt: string, now: Date = new Date()): number {
  const [a, b] = [limaDay(soldAt), limaDay(now)].map(s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

/** ¿La venta todavía admite cambios? Hasta 7 días después (la del lunes, hasta el lunes siguiente). */
export function withinReturnWindow(soldAt: string, now: Date = new Date()): boolean {
  const d = daysSince(soldAt, now)
  return d >= 0 && d <= RETURN_WINDOW_DAYS
}

/** Lo que queda por devolver de una línea. */
export const remaining = (i: Pick<ReturnableItem, 'qty' | 'returned_qty'>) => Math.max(0, round3(i.qty - i.returned_qty))

/** Descripción de la línea devuelta: la misma que guarda el servidor. */
export const returnDescription = (description: string, saleNumber: number) =>
  `${description} · devuelto de venta #${saleNumber}`

/** Líneas devueltas para el ticket a partir de lo elegido (`id de línea → cantidad`), sin pasar lo pendiente. */
export function returnLines(sale: Pick<ReturnableSale, 'number' | 'items'>, picks: Record<number, number>): ReturnLine[] {
  return sale.items.flatMap(i => {
    const n = Math.min(picks[i.id] ?? 0, remaining(i))
    if (!(n > 0)) return []
    return [{
      product_id: i.product_id, description: returnDescription(i.description, sale.number), qty: -n,
      unit_price: i.unit_price, ...(i.factor !== 1 ? { factor: i.factor } : {}),
      returns_item_id: i.id, returns_sale_number: sale.number,
    }]
  })
}

/** Valor de lo devuelto (positivo): lo que se descuenta del ticket. */
export const returnedValue = (lines: { qty: number; unit_price: number }[]) =>
  round2(lines.reduce((s, l) => s + round2(-l.qty * l.unit_price), 0))

/**
 * Qué es el ticket: venta normal, cambio (devuelve algo y se lleva algo) o devolución (solo devuelve; solo admin).
 * Una línea es devuelta si tiene `returns_item_id`.
 */
export type TicketKind = 'venta' | 'cambio' | 'devolucion'
export function ticketKind(lines: { returns_item_id?: number | null }[]): TicketKind {
  const back = lines.some(l => l.returns_item_id != null)
  if (!back) return 'venta'
  return lines.some(l => l.returns_item_id == null) ? 'cambio' : 'devolucion'
}
