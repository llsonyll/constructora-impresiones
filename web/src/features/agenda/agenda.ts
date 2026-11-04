/**
 * Agenda: fechas de cada evento (una vez o repetidas) y su estado. Todo en fechas `YYYY-MM-DD` locales,
 * sin horas, para que un día nunca se corra por la zona horaria.
 */
import { Receipt, StickyNote, Truck, Wrench, Zap, type LucideIcon } from 'lucide-react'

export type AgendaKind = 'servicio' | 'pedido' | 'pago' | 'mantenimiento' | 'otro'
export type RepeatUnit = 'week' | 'month' | 'year'

export interface AgendaEvent {
  id: string
  kind: AgendaKind
  title: string
  start_date: string
  repeat_unit: RepeatUnit | null
  repeat_every: number
  repeat_until: string | null
  amount: number | null
  provider_id: string | null
  provider_name: string | null
  provider_phone: string | null
  purchase_order_id: string | null
  po_number: number | null
  po_status: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

/** Lo que pasó en una fecha del evento: hecho/pagado o cambiada de día. */
export interface OccurrenceRow {
  event_id: string
  occurrence: string
  moved_to: string | null
  done_at: string | null
  done_by: string | null
  amount: number | null
  note: string | null
}

export interface Occurrence {
  event: AgendaEvent
  /** Fecha calculada (la clave en `agenda_occurrences`). */
  occurrence: string
  /** Fecha en la que se muestra: la calculada o a la que se movió. */
  date: string
  row: OccurrenceRow | null
  done: boolean
  overdue: boolean
  /** Fecha repetida anterior a la creación del evento: no se cuenta como vencida. */
  history: boolean
  /** Número de vez (1, 2, 3…) y total si la serie tiene fin (p. ej. cuota 3 de 12). */
  index: number
  total: number | null
}

export const KIND: Record<AgendaKind, {
  label: string; short: string; icon: LucideIcon; dot: string; soft: string; text: string
  /** Repetición sugerida al elegir el tipo. */
  repeat: string
  suggestions: string[]
}> = {
  servicio: {
    label: 'Servicios (luz, agua…)', short: 'Servicio', icon: Zap, dot: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-800',
    repeat: 'month:1', suggestions: ['Luz (electricidad)', 'Agua', 'Internet', 'Teléfono', 'Alquiler del local', 'Arbitrios'],
  },
  pedido: {
    label: 'Pedidos y materiales', short: 'Pedido', icon: Truck, dot: 'bg-sky-600', soft: 'bg-sky-50', text: 'text-sky-800',
    repeat: '', suggestions: ['Recepción de pedido', 'Llegada de materiales', 'Recoger pedido'],
  },
  pago: {
    label: 'Cuotas y facturas', short: 'Pago', icon: Receipt, dot: 'bg-violet-600', soft: 'bg-violet-50', text: 'text-violet-800',
    repeat: 'month:1', suggestions: ['Cuota del préstamo', 'Factura de proveedor', 'Letra', 'Impuestos SUNAT'],
  },
  mantenimiento: {
    label: 'Mantenimiento (copiadora e impresora)', short: 'Mantenimiento', icon: Wrench, dot: 'bg-teal-600', soft: 'bg-teal-50', text: 'text-teal-800',
    repeat: '', suggestions: ['Mantenimiento de la fotocopiadora', 'Mantenimiento de la impresora', 'Cambio de tóner', 'Visita del técnico'],
  },
  otro: {
    label: 'Otro', short: 'Otro', icon: StickyNote, dot: 'bg-stone-500', soft: 'bg-stone-100', text: 'text-stone-700',
    repeat: '', suggestions: [],
  },
}
export const KINDS = Object.keys(KIND) as AgendaKind[]

export const REPEAT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No se repite' },
  { value: 'week:1', label: 'Cada semana' },
  { value: 'week:2', label: 'Cada 2 semanas' },
  { value: 'month:1', label: 'Cada mes' },
  { value: 'month:2', label: 'Cada 2 meses' },
  { value: 'month:3', label: 'Cada 3 meses' },
  { value: 'month:6', label: 'Cada 6 meses' },
  { value: 'year:1', label: 'Cada año' },
]

// ---------- Fechas ----------

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const parts = (key: string) => key.split('-').map(Number) as [number, number, number]
export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate()

/** Fecha de hoy (o de `d`) como `YYYY-MM-DD` local. */
export function dayKey(d = new Date()) { return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()) }

export function addDays(key: string, n: number) {
  const [y, m, d] = parts(key)
  const t = new Date(y, m - 1, d + n)
  return dayKey(t)
}

/** Suma meses conservando el día; si el mes es más corto, el último día (31 → 30 de abril, 28/29 de febrero). */
export function addMonths(key: string, n: number, day = parts(key)[2]) {
  const [y, m] = parts(key)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = total % 12 + 1
  return ymd(ny, nm, Math.min(day, daysInMonth(ny, nm)))
}

const utc = (key: string) => { const [y, m, d] = parts(key); return Date.UTC(y, m - 1, d) }
export const diffDays = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86_400_000)
const diffMonths = (a: string, b: string) => { const [ya, ma] = parts(a), [yb, mb] = parts(b); return (yb - ya) * 12 + (mb - ma) }

/** Fechas del evento entre `from` y `to` (inclusive), con su número de vez (1 = la primera). */
export function eventDates(ev: Pick<AgendaEvent, 'start_date' | 'repeat_unit' | 'repeat_every' | 'repeat_until'>, from: string, to: string) {
  const out: { date: string; index: number }[] = []
  const start = ev.start_date
  const last = ev.repeat_until && ev.repeat_until < to ? ev.repeat_until : to
  if (!ev.repeat_unit) {
    if (start >= from && start <= to) out.push({ date: start, index: 1 })
    return out
  }
  const every = Math.max(1, ev.repeat_every || 1)
  if (ev.repeat_unit === 'week') {
    const step = 7 * every
    let k = Math.max(0, Math.floor(diffDays(start, from) / step))
    for (let d = addDays(start, k * step); d <= last; k++, d = addDays(start, k * step)) if (d >= from) out.push({ date: d, index: k + 1 })
    return out
  }
  const step = every * (ev.repeat_unit === 'year' ? 12 : 1)
  const day = parts(start)[2]
  let k = Math.max(0, Math.floor(diffMonths(start, from) / step) - 1)
  for (let d = addMonths(start, k * step, day); d <= last; k++, d = addMonths(start, k * step, day)) if (d >= from) out.push({ date: d, index: k + 1 })
  return out
}

/** Cuántas veces tiene una serie con fin (null = sin fin). */
export function seriesCount(ev: AgendaEvent) {
  if (!ev.repeat_unit) return 1
  if (!ev.repeat_until) return null
  const all = eventDates(ev, ev.start_date, ev.repeat_until)
  return all.length
}

/** Fecha de la vez número `n` (1 = la primera): sirve para "termina después de N cuotas". */
export function nthDate(ev: Pick<AgendaEvent, 'start_date' | 'repeat_unit' | 'repeat_every'>, n: number) {
  const k = Math.max(0, Math.floor(n) - 1)
  const every = Math.max(1, ev.repeat_every || 1)
  if (!ev.repeat_unit || k === 0) return ev.start_date
  if (ev.repeat_unit === 'week') return addDays(ev.start_date, k * 7 * every)
  return addMonths(ev.start_date, k * every * (ev.repeat_unit === 'year' ? 12 : 1))
}

// Un día movido puede caer lejos de su fecha original: se calcula con margen y se filtra por la fecha final.
const MOVE_MARGIN = 92

/** Todas las fechas de los eventos que se ven entre `from` y `to`, ordenadas. */
export function expand(events: AgendaEvent[], rows: OccurrenceRow[], from: string, to: string, today = dayKey()): Occurrence[] {
  const byKey = new Map(rows.map(r => [`${r.event_id}|${r.occurrence}`, r]))
  const out: Occurrence[] = []
  for (const event of events) {
    const created = dayKey(new Date(event.created_at))
    const total = seriesCount(event)
    for (const { date: occurrence, index } of eventDates(event, addDays(from, -MOVE_MARGIN), addDays(to, MOVE_MARGIN))) {
      const row = byKey.get(`${event.id}|${occurrence}`) ?? null
      const date = row?.moved_to ?? occurrence
      if (date < from || date > to) continue
      const done = !!row?.done_at
      const history = !done && !!event.repeat_unit && occurrence < created && !row?.moved_to
      out.push({ event, occurrence, date, row, done, history, overdue: !done && !history && date < today, index, total })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || KINDS.indexOf(a.event.kind) - KINDS.indexOf(b.event.kind)
                            || a.event.title.localeCompare(b.event.title))
}

/** Pendientes vencidos (hasta un año atrás) y los de hoy. */
export function alerts(events: AgendaEvent[], rows: OccurrenceRow[], today = dayKey()) {
  const list = expand(events, rows, addDays(today, -365), today, today).filter(o => !o.done && !o.history)
  return { overdue: list.filter(o => o.date < today), today: list.filter(o => o.date === today) }
}

// ---------- Textos ----------

export function repeatValue(ev: Pick<AgendaEvent, 'repeat_unit' | 'repeat_every'>) {
  return ev.repeat_unit ? `${ev.repeat_unit}:${ev.repeat_every}` : ''
}

export function repeatLabel(ev: Pick<AgendaEvent, 'repeat_unit' | 'repeat_every' | 'repeat_until'>) {
  if (!ev.repeat_unit) return ''
  const n = ev.repeat_every
  const unit = ev.repeat_unit === 'week' ? (n === 1 ? 'semana' : 'semanas') : ev.repeat_unit === 'month' ? (n === 1 ? 'mes' : 'meses') : (n === 1 ? 'año' : 'años')
  return `Cada ${n === 1 ? '' : `${n} `}${unit}${ev.repeat_until ? ` hasta el ${shortDate(ev.repeat_until, true)}` : ''}`
}

const toDate = (key: string) => { const [y, m, d] = parts(key); return new Date(y, m - 1, d) }

export function shortDate(key: string, withYear = false) {
  return toDate(key).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}
export function longDate(key: string) {
  return toDate(key).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
export function monthTitle(y: number, m: number) {
  return new Date(y, m - 1, 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })
}

/** "Hoy", "Mañana", "Ayer", "En 5 días", "Hace 3 días". */
export function relativeDay(key: string, today = dayKey()) {
  const d = diffDays(today, key)
  if (d === 0) return 'Hoy'
  if (d === 1) return 'Mañana'
  if (d === -1) return 'Ayer'
  return d > 0 ? `En ${d} días` : `Hace ${-d} días`
}

/** "Cuota 3 de 12", "Vez 4" o vacío para un evento de una sola vez. */
export function indexLabel(o: Occurrence) {
  if (!o.event.repeat_unit) return ''
  const word = o.event.kind === 'pago' ? 'Cuota' : 'Vez'
  return o.total ? `${word} ${o.index} de ${o.total}` : (o.event.kind === 'pago' ? `${word} ${o.index}` : '')
}
