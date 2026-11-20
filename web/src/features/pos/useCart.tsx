import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Caja, CartLine } from '@/types/domain'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_STATE, activeTicket, applyRemote, linesTotal, migrateLegacy, ticketTitle, ticketsOf, ticketsReducer, toSave,
  type CartAction, type RemoteTicket, type Ticket, type TicketQuote, type TicketsAction, type TicketsState,
} from './tickets'

export type { CartAction, Ticket, TicketQuote }

/** El ticket activo de una caja en este equipo. */
export interface Cart {
  /** Id del ticket activo (será el id de la venta); null si todavía no hay ticket. */
  id: string | null
  lines: CartLine[]; total: number; dispatch: (a: CartAction) => void
  quote: TicketQuote | null; setQuote: (q: TicketQuote | null) => void
  /** Abre un ticket nuevo vacío en la caja (el anterior sigue abierto para todos). */
  newTicket: () => void
  /** Cierra el ticket activo: cobrado (lo confirma la venta en el servidor) o descartado. */
  finish: (how: 'cobrado' | 'descartado') => void
}

export interface OpenTickets {
  /** Tickets abiertos de cada caja (de todos los equipos), del más antiguo al más nuevo. */
  byCaja: Record<Caja, Ticket[]>
  active: Record<Caja, string | null>
  select: (caja: Caja, id: string) => void
  setLabel: (id: string, label: string) => void
  discard: (id: string) => void
  /** Este usuario comparte tickets con el servidor (admin y cajero); almacén solo usa el ticket local. */
  shared: boolean
}

const KEY = 'pos.shared_tickets'
const SAVE_DELAY = 600
const POLL = 30_000

function load(me: string | null): TicketsState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<TicketsState>
      return { ...EMPTY_STATE, ...s, active: { ...EMPTY_STATE.active, ...s.active } }
    }
    // Versión anterior: un ticket por caja solo en este equipo. Se convierte y se sube.
    const old = JSON.parse(localStorage.getItem('pos.tickets') ?? 'null')
    const quotes = JSON.parse(localStorage.getItem('pos.quotes') ?? 'null')
    return migrateLegacy(old, quotes, me)
  } catch { return EMPTY_STATE }
}

const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))

const CartsCtx = createContext<Record<Caja, Cart> | null>(null)
const TicketsCtx = createContext<OpenTickets | null>(null)

/**
 * Tickets abiertos compartidos por los equipos de la tienda (tabla `open_tickets`, ver tickets.ts).
 * Se editan al instante en este equipo (guardados en localStorage, funciona sin internet) y se suben al servidor
 * poco después; los de los demás llegan por Realtime. Cada equipo trabaja en un ticket activo por caja.
 */
export function CartsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const me = profile?.full_name?.trim() || null
  const shared = profile?.role === 'admin' || profile?.role === 'cajero'
  const [state, dispatch] = useReducer(ticketsReducer, me, load)
  const stateRef = useRef(state)
  stateRef.current = state
  const inflight = useRef(new Set<string>())

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* sin almacenamiento */ } }, [state])
  useEffect(() => { try { localStorage.removeItem('pos.tickets'); localStorage.removeItem('pos.quotes') } catch { /* nada */ } }, [])

  /** Aplica filas del servidor y avisa lo que cambió por otro equipo. */
  const receive = useCallback((rows: RemoteTicket[], snapshot: boolean) => {
    const set = new Set(inflight.current)
    const { gone, overwritten } = applyRemote(stateRef.current, rows, snapshot, set)
    dispatch({ type: 'remote', rows, snapshot, inflight: set })
    for (const t of gone) if (t.lines.length) toast.info(`El ticket «${ticketTitle(t)}» se cerró en otro equipo`, { id: `ticket-${t.id}` })
    for (const t of overwritten) toast.warning(`«${ticketTitle(t)}» lo cambió otro equipo: se cargó su versión`, { id: `ticket-${t.id}` })
  }, [])

  const fetchOpen = useCallback(async () => {
    if (!shared || !navigator.onLine) return
    const { data, error } = await supabase.from('open_tickets').select('*').eq('status', 'abierto')
    if (!error && data) receive(data as RemoteTicket[], true)
  }, [shared, receive])

  /** Sube los tickets con cambios y los descartes pendientes. */
  const flush = useCallback(async () => {
    if (!shared || !navigator.onLine) return
    const s = stateRef.current
    for (const t of toSave(s)) {
      if (inflight.current.has(t.id)) continue
      inflight.current.add(t.id)
      const sent = { rev: t.rev, version: t.version }
      try {
        const { data, error } = await supabase.rpc('ticket_save', { p: {
          id: t.id, caja: t.caja, label: t.label, lines: t.lines, quote: t.quote, expected_version: sent.version,
        } })
        if (!error) { dispatch({ type: 'saved', id: t.id, rev: sent.rev, row: data as RemoteTicket }); continue }
        const msg = errText(error)
        if (msg.includes('ticket_cerrado')) {
          dispatch({ type: 'close', id: t.id, discard: false })
          if (t.lines.length) toast.info(`El ticket «${ticketTitle(t)}» ya se cobró o descartó en otro equipo`, { id: `ticket-${t.id}` })
        } else if (msg.includes('ticket_conflicto')) {
          const { data: row } = await supabase.from('open_tickets').select('*').eq('id', t.id).maybeSingle()
          inflight.current.delete(t.id)
          if (row) receive([row as RemoteTicket], false)
        }
        // Otros errores (red, sin la migración): queda con cambios y se reintenta.
      } finally {
        inflight.current.delete(t.id)
      }
    }
    for (const id of stateRef.current.discards) {
      if (inflight.current.has(id)) continue   // su primer guardado sigue en camino: se descarta después
      const { error } = await supabase.rpc('ticket_discard', { p_id: id })
      if (!error) dispatch({ type: 'discarded', id })
    }
  }, [shared, receive])

  // Guardar poco después de cada cambio (no en cada toque).
  useEffect(() => {
    if (!toSave(state).length && !state.discards.length) return
    const t = setTimeout(() => { void flush() }, SAVE_DELAY)
    return () => clearTimeout(t)
  }, [state, flush])

  // Tickets de los demás: en vivo por Realtime, y una consulta completa al conectar, al volver internet y cada 30 s.
  useEffect(() => {
    if (!shared) return
    const ch = supabase.channel('open-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_tickets' }, payload => {
        if (payload.eventType !== 'DELETE') receive([payload.new as RemoteTicket], false)
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') void fetchOpen() })
    const tick = () => { void fetchOpen().then(flush) }
    window.addEventListener('online', tick)
    const iv = setInterval(tick, POLL)
    return () => { void supabase.removeChannel(ch); window.removeEventListener('online', tick); clearInterval(iv) }
  }, [shared, fetchOpen, flush, receive])

  const act = useCallback((a: TicketsAction) => dispatch(a), [])

  const carts = useMemo(() => {
    const cart = (caja: Caja): Cart => {
      const t = activeTicket(state, caja)
      const lines = t?.lines ?? []
      return {
        id: t?.id ?? null,
        lines,
        total: linesTotal(lines),
        quote: t?.quote ?? null,
        dispatch: action => act({ type: 'edit', caja, action, me }),
        setQuote: quote => act({ type: 'setQuote', caja, quote, me }),
        newTicket: () => act({ type: 'new', caja, me }),
        finish: how => { if (t) act({ type: 'close', id: t.id, discard: how === 'descartado' }) },
      }
    }
    return { ferreteria: cart('ferreteria'), copias: cart('copias') }
  }, [state, act, me])

  const open = useMemo<OpenTickets>(() => ({
    byCaja: { ferreteria: ticketsOf(state, 'ferreteria'), copias: ticketsOf(state, 'copias') },
    active: state.active,
    select: (caja, id) => act({ type: 'select', caja, id }),
    setLabel: (id, label) => act({ type: 'setLabel', id, label }),
    discard: id => act({ type: 'close', id, discard: true }),
    shared,
  }), [state, act, shared])

  return (
    <CartsCtx.Provider value={carts}>
      <TicketsCtx.Provider value={open}>{children}</TicketsCtx.Provider>
    </CartsCtx.Provider>
  )
}

export function useCarts() {
  const carts = useContext(CartsCtx)
  if (!carts) throw new Error('useCarts fuera de CartsProvider')
  return carts
}

export function useOpenTickets() {
  const t = useContext(TicketsCtx)
  if (!t) throw new Error('useOpenTickets fuera de CartsProvider')
  return t
}
