// Tickets abiertos compartidos entre los equipos (tabla `open_tickets`). Lógica pura, sin React ni Supabase:
// cada equipo edita su copia local al instante (funciona sin internet) y `useCart.tsx` la guarda en el servidor;
// lo que llega del servidor (consulta o Realtime) se mezcla aquí con `applyRemote`.
import type { Caja, CartLine } from '@/types/domain'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// ---------- Líneas de un ticket ----------

export type CartAction =
  | { type: 'addProduct'; product: { id: string; name: string; price: number } }
  | { type: 'addCustom'; description: string; qty: number; unit_price: number }
  | { type: 'addLine'; product_id: string; description: string; qty: number; unit_price: number; factor?: number }
  | { type: 'setQty'; key: string; qty: number }
  | { type: 'undoAdd'; product_id: string; unit_price: number; qty: number; factor?: number }
  | { type: 'remove'; key: string }
  | { type: 'clear' }

/** Misma línea: mismo producto, precio y presentación (factor; sin dato = unidad base). */
const sameLine = (l: CartLine, product_id: string, unit_price: number, factor = 1) =>
  l.product_id === product_id && l.unit_price === unit_price && (l.factor ?? 1) === factor

export function linesReducer(state: CartLine[], a: CartAction): CartLine[] {
  switch (a.type) {
    case 'addProduct': {
      const existing = state.find(l => sameLine(l, a.product.id, a.product.price))
      if (existing) return state.map(l => l === existing ? { ...l, qty: l.qty + 1 } : l)
      return [...state, { key: crypto.randomUUID(), product_id: a.product.id,
        description: a.product.name, qty: 1, unit_price: a.product.price }]
    }
    // Producto con cantidad y precio dados (impresiones del agente, presentaciones): se suma a la línea igual.
    case 'addLine': {
      const existing = state.find(l => sameLine(l, a.product_id, a.unit_price, a.factor))
      if (existing) return state.map(l => l === existing ? { ...l, qty: l.qty + a.qty } : l)
      return [...state, { key: crypto.randomUUID(), product_id: a.product_id, description: a.description, qty: a.qty,
        unit_price: a.unit_price, ...(a.factor != null && a.factor !== 1 ? { factor: a.factor } : {}) }]
    }
    case 'addCustom':
      return [...state, { key: crypto.randomUUID(), product_id: null,
        description: a.description, qty: a.qty, unit_price: a.unit_price }]
    case 'setQty':
      return a.qty <= 0 ? state.filter(l => l.key !== a.key)
                        : state.map(l => l.key === a.key ? { ...l, qty: a.qty } : l)
    // "Deshacer" del aviso: resta lo que se acaba de sumar (y quita la línea si queda en 0).
    case 'undoAdd': {
      const line = state.find(l => sameLine(l, a.product_id, a.unit_price, a.factor))
      if (!line) return state
      return line.qty - a.qty <= 0 ? state.filter(l => l !== line)
                                   : state.map(l => l === line ? { ...l, qty: round2(l.qty - a.qty) } : l)
    }
    case 'remove': return state.filter(l => l.key !== a.key)
    case 'clear': return []
  }
}

export const linesTotal = (lines: CartLine[]) => round2(lines.reduce((s, l) => s + round2(l.qty * l.unit_price), 0))

// ---------- Tickets ----------

/** Cotización que se está cobrando en un ticket: al cobrar, la venta queda enlazada a ella (y lleva sus datos de cliente). */
export interface TicketQuote { id: string; label: string; customer_name: string | null; customer_doc: string | null }

export interface Ticket {
  id: string                  // también será el id de la venta
  caja: Caja
  label: string | null
  lines: CartLine[]
  quote: TicketQuote | null
  version: number             // última versión del servidor que conoce este equipo; 0 = todavía no está en el servidor
  rev: number                 // contador de cambios locales (para saber si lo guardado sigue siendo lo último)
  dirty: boolean              // hay cambios locales sin guardar en el servidor
  created_by_name: string | null
  updated_by_name: string | null
  created_at: string
}

/** Fila de `open_tickets` tal como la devuelve Supabase. */
export interface RemoteTicket {
  id: string; caja: Caja; label: string | null; lines: CartLine[]; quote: TicketQuote | null
  status: 'abierto' | 'cobrado' | 'descartado'; version: number
  created_by_name: string | null; updated_by_name: string | null; created_at: string
}

export interface TicketsState {
  tickets: Ticket[]
  /** Ticket en el que trabaja ESTE equipo en cada caja (cada equipo elige el suyo). */
  active: Record<Caja, string | null>
  /** Tickets que este equipo cerró (cobró o descartó) y el servidor quizá todavía muestra abiertos: id → cuándo. */
  closed: Record<string, string>
  /** Tickets descartados aquí que falta avisar al servidor (p. ej. se descartaron sin internet). */
  discards: string[]
}

export const EMPTY_STATE: TicketsState = { tickets: [], active: { ferreteria: null, copias: null }, closed: {}, discards: [] }

export type TicketsAction =
  | { type: 'edit'; caja: Caja; action: CartAction; me: string | null }
  | { type: 'setQuote'; caja: Caja; quote: TicketQuote | null; me: string | null }
  | { type: 'setLabel'; id: string; label: string }
  | { type: 'new'; caja: Caja; me: string | null }
  | { type: 'select'; caja: Caja; id: string }
  | { type: 'close'; id: string; discard: boolean }
  | { type: 'discarded'; id: string }
  | { type: 'saved'; id: string; rev: number; row: RemoteTicket }
  | { type: 'remote'; rows: RemoteTicket[]; snapshot: boolean; inflight?: ReadonlySet<string> }

/** Un ticket no está en el servidor ni tiene nada: se puede tirar sin avisar a nadie. */
const disposable = (t: Ticket) => t.version === 0 && !t.lines.length && !t.label && !t.quote

export function newTicket(caja: Caja, me: string | null, id: string = crypto.randomUUID()): Ticket {
  return { id, caja, label: null, lines: [], quote: null, version: 0, rev: 0, dirty: false,
           created_by_name: me, updated_by_name: me, created_at: new Date().toISOString() }
}

const fromRemote = (r: RemoteTicket): Ticket => ({
  id: r.id, caja: r.caja, label: r.label, lines: r.lines ?? [], quote: r.quote, version: r.version, rev: 0,
  dirty: false, created_by_name: r.created_by_name, updated_by_name: r.updated_by_name, created_at: r.created_at,
})

/** Tickets de una caja, del más antiguo al más nuevo (el orden de llegada de los clientes). */
export const ticketsOf = (s: TicketsState, caja: Caja) =>
  s.tickets.filter(t => t.caja === caja).sort((a, b) => a.created_at.localeCompare(b.created_at))

export const activeTicket = (s: TicketsState, caja: Caja) => s.tickets.find(t => t.id === s.active[caja]) ?? null

/** Deja `id` como ticket activo de su caja y tira el que estaba si quedó vacío y nunca se guardó. */
function activate(s: TicketsState, caja: Caja, id: string | null): TicketsState {
  const prev = activeTicket(s, caja)
  const tickets = prev && prev.id !== id && disposable(prev) ? s.tickets.filter(t => t !== prev) : s.tickets
  return { ...s, tickets, active: { ...s.active, [caja]: id } }
}

/** El ticket activo de la caja; si no hay, crea uno nuevo. */
function ensureActive(s: TicketsState, caja: Caja, me: string | null): [TicketsState, Ticket] {
  const t = activeTicket(s, caja)
  if (t) return [s, t]
  const fresh = newTicket(caja, me)
  return [{ ...s, tickets: [...s.tickets, fresh], active: { ...s.active, [caja]: fresh.id } }, fresh]
}

const touch = (s: TicketsState, id: string, f: (t: Ticket) => Ticket): TicketsState =>
  ({ ...s, tickets: s.tickets.map(t => t.id === id ? { ...f(t), rev: t.rev + 1, dirty: true } : t) })

export function ticketsReducer(s: TicketsState, a: TicketsAction): TicketsState {
  switch (a.type) {
    case 'edit': {
      const [s1, t] = ensureActive(s, a.caja, a.me)
      return touch(s1, t.id, x => ({ ...x, lines: linesReducer(x.lines, a.action) }))
    }
    case 'setQuote': {
      if (!a.quote && !activeTicket(s, a.caja)) return s
      const [s1, t] = ensureActive(s, a.caja, a.me)
      return touch(s1, t.id, x => ({ ...x, quote: a.quote }))
    }
    case 'setLabel': {
      const label = a.label.trim() || null
      return touch(s, a.id, x => ({ ...x, label }))
    }
    case 'new': {
      // Si el activo ya está vacío, se reutiliza: tocar "+ Nuevo" varias veces no llena la lista de tickets vacíos.
      const cur = activeTicket(s, a.caja)
      if (cur && disposable(cur)) return s
      const fresh = newTicket(a.caja, a.me)
      const s1 = activate(s, a.caja, fresh.id)
      return { ...s1, tickets: [...s1.tickets, fresh] }
    }
    case 'select':
      return s.tickets.some(t => t.id === a.id && t.caja === a.caja) ? activate(s, a.caja, a.id) : s
    case 'close': {
      const t = s.tickets.find(x => x.id === a.id)
      if (!t) return s
      const active = t.id === s.active[t.caja] ? { ...s.active, [t.caja]: null } : s.active
      // Puede estar (o estar llegando) al servidor: se recuerda para que no reaparezca y, si se descartó, para avisarle.
      const known = t.version > 0 || t.dirty
      const closed = known ? { ...s.closed, [t.id]: new Date().toISOString() } : s.closed
      const discards = known && a.discard ? [...s.discards, t.id] : s.discards
      return { tickets: s.tickets.filter(x => x !== t), active, closed, discards }
    }
    case 'discarded': return { ...s, discards: s.discards.filter(id => id !== a.id) }
    case 'saved': {
      // Si se siguió editando mientras se guardaba, queda pendiente otro guardado (con la versión nueva).
      return { ...s, tickets: s.tickets.map(t => t.id !== a.id ? t
        : { ...t, version: a.row.version, dirty: t.rev !== a.rev, created_by_name: a.row.created_by_name,
            updated_by_name: a.row.updated_by_name, created_at: a.row.created_at }) }
    }
    case 'remote': return applyRemote(s, a.rows, a.snapshot, a.inflight).state
  }
}

export interface RemoteChanges {
  state: TicketsState
  /** Tickets que este equipo tenía abiertos y se cerraron en otro (cobrados o descartados). */
  gone: Ticket[]
  /** Tickets con cambios locales que otro equipo modificó antes: se cargó la versión del otro equipo. */
  overwritten: Ticket[]
}

/**
 * Mezcla filas del servidor con el estado local. `snapshot` = las filas son TODOS los tickets abiertos (consulta
 * completa): lo que este equipo ya había guardado y no viene, se cerró en otro equipo. Sin `snapshot` (Realtime) solo
 * se aplican las filas recibidas.
 * - Una versión del servidor más nueva que la local gana (si había cambios locales, se avisa en `overwritten`).
 * - Los tickets que este equipo cerró no reaparecen aunque el servidor todavía no se entere.
 * - Los tickets que nunca llegaron al servidor (version 0) no se tocan.
 * - `inflight`: tickets que este equipo está guardando ahora. La fila que llega con la versión siguiente es el eco de
 *   ese mismo guardado (Realtime puede llegar antes que la respuesta): no es un cambio de otro equipo.
 */
export function applyRemote(s: TicketsState, rows: RemoteTicket[], snapshot: boolean,
                            inflight: ReadonlySet<string> = new Set()): RemoteChanges {
  const gone: Ticket[] = [], overwritten: Ticket[] = []
  const byId = new Map(s.tickets.map(t => [t.id, t]))
  const seen = new Set<string>()
  let tickets = [...s.tickets]
  for (const r of rows) {
    seen.add(r.id)
    const local = byId.get(r.id)
    if (r.status !== 'abierto') {
      if (local) { tickets = tickets.filter(t => t.id !== r.id); gone.push(local) }
      continue
    }
    if (s.closed[r.id]) continue
    if (!local) { tickets.push(fromRemote(r)); continue }
    if (inflight.has(r.id) && r.version === local.version + 1) continue
    if (r.version > local.version) {
      if (local.dirty) overwritten.push(local)
      tickets = tickets.map(t => t.id === r.id ? { ...fromRemote(r), rev: local.rev } : t)
    }
  }
  if (snapshot) {
    const stale = tickets.filter(t => t.version > 0 && !seen.has(t.id))
    gone.push(...stale)
    tickets = tickets.filter(t => !stale.includes(t))
  }
  // Ya no hace falta recordar los cerrados que el servidor dejó de mostrar (o de hace más de dos días). Los de los
  // últimos minutos se guardan igual: su primer guardado pudo seguir en camino y aparecer después.
  const now = Date.now()
  const limit = new Date(now - 2 * 86_400_000).toISOString(), recent = new Date(now - 5 * 60_000).toISOString()
  const closed = snapshot
    ? Object.fromEntries(Object.entries(s.closed).filter(([id, at]) =>
        at > limit && (seen.has(id) || s.discards.includes(id) || at > recent)))
    : s.closed
  const ids = new Set(tickets.map(t => t.id))
  const active = { ferreteria: s.active.ferreteria && ids.has(s.active.ferreteria) ? s.active.ferreteria : null,
                   copias: s.active.copias && ids.has(s.active.copias) ? s.active.copias : null }
  return { state: { ...s, tickets, active, closed }, gone, overwritten }
}

/** Tickets que hay que guardar en el servidor: con cambios, y que ya tienen algo (los vacíos nuevos no se suben). */
export const toSave = (s: TicketsState) => s.tickets.filter(t => t.dirty && (t.version > 0 || !disposable(t)))

/** Nombre corto para la lista: la etiqueta, el cliente de la cotización o, si no, quién lo abrió y a qué hora. */
export function ticketTitle(t: Pick<Ticket, 'label' | 'created_by_name' | 'created_at'> & { quote?: TicketQuote | null }): string {
  const named = t.label || t.quote?.customer_name || t.quote?.label
  if (named) return named
  const who = t.created_by_name?.trim().split(/\s+/)[0]
  const d = new Date(t.created_at)
  const hhmm = Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' })
  return [who, hhmm].filter(Boolean).join(' ') || 'Ticket'
}

/**
 * Pasa los tickets guardados por la versión anterior (uno por caja, solo en este equipo) a la nueva forma:
 * quedan como tickets nuevos que se suben al servidor. Así nadie pierde el ticket que dejó a medias.
 */
export function migrateLegacy(old: Partial<Record<Caja, CartLine[]>> | null, quotes: Partial<Record<Caja, TicketQuote | null>> | null,
                              me: string | null): TicketsState {
  const s: TicketsState = { ...EMPTY_STATE, active: { ...EMPTY_STATE.active }, tickets: [], closed: {}, discards: [] }
  for (const caja of ['ferreteria', 'copias'] as Caja[]) {
    const lines = old?.[caja] ?? []
    if (!lines.length) continue
    const t = { ...newTicket(caja, me), lines, quote: quotes?.[caja] ?? null, rev: 1, dirty: true }
    s.tickets.push(t)
    s.active[caja] = t.id
  }
  return s
}
