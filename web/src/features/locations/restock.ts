// Reponer desde el depósito y ubicar compras recibidas: lógica pura (sin React ni Supabase) para probarla con npm test.
// El movimiento lo hace la RPC move_to_location; el stock no cambia, solo la cantidad anotada en cada ubicación.

interface Loc { location_id: number; code: string; is_primary: boolean; qty: number | null }
export interface RestockProduct {
  id: string
  name: string
  unit: string
  stock: number
  min_stock: number
  track_stock: boolean
  locations: Loc[]
}

export interface RestockCandidate<P extends RestockProduct = RestockProduct> {
  product: P
  shelf: Loc          // a dónde va: la principal de la tienda, o la primera de la tienda
  shelfQty: number    // lo anotado en todas sus ubicaciones de la tienda
  depot: Loc          // de dónde sale: el depósito con más cantidad
  depotQty: number    // lo anotado en todos sus depósitos
}

/**
 * Para reponer: productos con ubicación en la tienda (con cantidad anotada) que ahí están en su mínimo o menos
 * (sin mínimo: agotados en el estante) y que tienen cantidad en un depósito. Ordenados por nombre.
 */
export function restockCandidates<P extends RestockProduct>(products: P[], depotIds: Set<number>): RestockCandidate<P>[] {
  const out: RestockCandidate<P>[] = []
  for (const p of products) {
    if (!p.track_stock) continue
    const shelves = p.locations.filter(l => !depotIds.has(l.location_id))
    const depots = p.locations.filter(l => depotIds.has(l.location_id) && (l.qty ?? 0) > 0)
    if (!shelves.length || !depots.length || shelves.every(l => l.qty == null)) continue
    const shelfQty = sum(shelves)
    if (shelfQty > p.min_stock) continue
    out.push({
      product: p,
      shelf: shelves.find(l => l.is_primary) ?? shelves[0],
      shelfQty,
      depot: [...depots].sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))[0],
      depotQty: sum(depots),
    })
  }
  return out.sort((a, b) => a.product.name.localeCompare(b.product.name))
}

/**
 * Cuánto proponer bajar: con mínimo, lo que falta para llegar al doble del mínimo; sin mínimo, todo lo de ese
 * depósito. Nunca más de lo que hay en el depósito (se corrige a mano antes de mover).
 */
export function suggestedMove(c: RestockCandidate): number {
  const depot = c.depot.qty ?? 0
  const want = c.product.min_stock > 0 ? Math.max(c.product.min_stock * 2 - c.shelfQty, 1) : depot
  return round3(Math.min(want, depot))
}

/**
 * Ubicar lo recibido de una compra, todo de una vez: cada producto a su ubicación principal (`principal`; los que no
 * tienen ubicación van al depósito) o todo al depósito (`deposito`). Devuelve las líneas para move_to_location.
 */
export function placementItems(lines: { product_id: string; qty: number }[], products: Map<string, Pick<RestockProduct, 'locations'>>,
                               mode: 'principal' | 'deposito', depotId: number) {
  return lines.filter(l => l.qty > 0).map(l => {
    const primary = products.get(l.product_id)?.locations.find(x => x.is_primary)
    return { product_id: l.product_id, qty: l.qty, to_location_id: mode === 'principal' && primary ? primary.location_id : depotId }
  })
}

const sum = (ls: Loc[]) => round3(ls.reduce((s, l) => s + (l.qty ?? 0), 0))
const round3 = (n: number) => Math.round(n * 1000) / 1000
