// Conteo por casillero (pantalla Contar casillero): lógica pura, sin React ni Supabase, para probarla con npm test.
// La regla que aplica el servidor (RPC count_location) es la misma; esto solo arma la vista previa y el envío.

/** Lo que se anotó de un producto: el texto escrito, cuándo se contó y si ya no va en este casillero. */
export interface CountEntry { v: string; at: string; remove?: boolean }
/** Borrador del conteo de un casillero, por id de producto. Se guarda en el equipo. */
export type CountDraft = Record<string, CountEntry>

/** Lo que el conteo necesita de cada producto. */
export interface CountProduct {
  id: string
  stock: number
  track_stock: boolean
  locations: { location_id: number; code: string; qty: number | null }[]
}

/** "12" → 12, "1,5" → 1.5, "" → null (sin contar); negativo o no numérico → NaN (inválido). */
export function parseQty(v: string): number | null {
  const t = v.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

export interface PlanLine {
  id: string
  counted: number           // lo contado aquí (0 si se quita)
  remove: boolean           // ya no va en este casillero
  isNew: boolean            // no estaba ubicado aquí: queda ubicado al guardar
  prevHere: number | null   // cantidad que tenía anotada aquí
  target: number | null     // stock con que quedaría (null: no se ajusta)
  diff: number | null       // target − stock actual (vista previa; el servidor usa el stock al momento de contar)
  pending: string[]         // otras ubicaciones sin cantidad: por eso no se ajusta el stock
}

export interface CountPlan {
  lines: PlanLine[]
  invalid: string[]         // ids con una cantidad que no se entiende
  placed: number            // productos que quedan ubicados aquí por primera vez
  removed: number
  adjusted: number          // con diferencia de stock
  skipped: number           // no se ajusta el stock (falta contar en otra ubicación)
}

/**
 * Qué hará el conteo: por cada producto contado, si queda ubicado aquí, la cantidad del casillero y el stock final.
 * Stock final = lo contado aquí + lo anotado en sus otras ubicaciones; si alguna no tiene cantidad, no se sabe el
 * total y el stock no se toca. Los servicios (sin stock) solo se ubican.
 */
export function planCount(locationId: number, products: CountProduct[], draft: CountDraft): CountPlan {
  const byId = new Map(products.map(p => [p.id, p]))
  const lines: PlanLine[] = []
  const invalid: string[] = []
  for (const [id, e] of Object.entries(draft)) {
    const p = byId.get(id)
    if (!p) continue
    const here = p.locations.find(l => l.location_id === locationId)
    const remove = !!e.remove
    const q = remove ? 0 : parseQty(e.v)
    if (q == null) continue                       // anotado sin cantidad: no se toca
    if (Number.isNaN(q)) { invalid.push(id); continue }
    if (remove && !here) continue                 // quitar algo que no estaba: nada que hacer
    const others = p.locations.filter(l => l.location_id !== locationId)
    const pending = others.filter(l => l.qty == null).map(l => l.code).sort()
    const target = !p.track_stock || pending.length ? null
      : round3(q + others.reduce((s, l) => s + (l.qty ?? 0), 0))
    lines.push({ id, counted: q, remove, isNew: !here, prevHere: here?.qty ?? null, target, pending: p.track_stock ? pending : [],
                 diff: target == null ? null : round3(target - p.stock) })
  }
  return {
    lines, invalid,
    placed: lines.filter(l => l.isNew).length,
    removed: lines.filter(l => l.remove).length,
    adjusted: lines.filter(l => l.diff != null && l.diff !== 0).length,
    skipped: lines.filter(l => l.pending.length > 0).length,
  }
}

/** Lo que se envía a la RPC count_location. */
export function countPayload(locationId: number, plan: CountPlan, draft: CountDraft, note = '') {
  return {
    location_id: locationId,
    ...(note.trim() ? { note: note.trim() } : {}),
    items: plan.lines.map(l => ({ product_id: l.id, counted: l.counted, counted_at: draft[l.id].at, ...(l.remove ? { remove: true } : {}) })),
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
