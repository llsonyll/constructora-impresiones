import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { Caja, CartLine, Product } from '@/types/domain'
import { round2 } from '@/lib/format'

type Action =
  | { type: 'addProduct'; product: Product }
  | { type: 'addCustom'; description: string; qty: number; unit_price: number }
  | { type: 'addLine'; product_id: string; description: string; qty: number; unit_price: number }
  | { type: 'setQty'; key: string; qty: number }
  | { type: 'undoAdd'; product_id: string; unit_price: number; qty: number }
  | { type: 'remove'; key: string }
  | { type: 'clear' }

function reducer(state: CartLine[], a: Action): CartLine[] {
  switch (a.type) {
    case 'addProduct': {
      const existing = state.find(l => l.product_id === a.product.id && l.unit_price === a.product.price)
      if (existing) return state.map(l => l === existing ? { ...l, qty: l.qty + 1 } : l)
      return [...state, { key: crypto.randomUUID(), product_id: a.product.id,
        description: a.product.name, qty: 1, unit_price: a.product.price }]
    }
    // Producto con cantidad y precio dados (impresiones del agente): se suma a la línea con el mismo precio.
    case 'addLine': {
      const existing = state.find(l => l.product_id === a.product_id && l.unit_price === a.unit_price)
      if (existing) return state.map(l => l === existing ? { ...l, qty: l.qty + a.qty } : l)
      return [...state, { key: crypto.randomUUID(), product_id: a.product_id,
        description: a.description, qty: a.qty, unit_price: a.unit_price }]
    }
    case 'addCustom':
      return [...state, { key: crypto.randomUUID(), product_id: null,
        description: a.description, qty: a.qty, unit_price: a.unit_price }]
    case 'setQty':
      return a.qty <= 0 ? state.filter(l => l.key !== a.key)
                        : state.map(l => l.key === a.key ? { ...l, qty: a.qty } : l)
    // "Deshacer" del aviso: resta lo que se acaba de sumar (y quita la línea si queda en 0).
    case 'undoAdd': {
      const line = state.find(l => l.product_id === a.product_id && l.unit_price === a.unit_price)
      if (!line) return state
      return line.qty - a.qty <= 0 ? state.filter(l => l !== line)
                                   : state.map(l => l === line ? { ...l, qty: round2(l.qty - a.qty) } : l)
    }
    case 'remove': return state.filter(l => l.key !== a.key)
    case 'clear': return []
  }
}

export type CartAction = Action
export interface Cart { lines: CartLine[]; total: number; dispatch: (a: Action) => void }

type Tickets = Record<Caja, CartLine[]>
const KEY = 'pos.tickets'
const EMPTY: Tickets = { ferreteria: [], copias: [] }

function loadTickets(): Tickets {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Tickets> | null
    return { ferreteria: t?.ferreteria ?? [], copias: t?.copias ?? [] }
  } catch { return EMPTY }
}

function ticketsReducer(state: Tickets, { caja, action }: { caja: Caja; action: Action }): Tickets {
  return { ...state, [caja]: reducer(state[caja], action) }
}

const CartsCtx = createContext<Record<Caja, Cart> | null>(null)

/**
 * Un ticket por caja, compartido por toda la app (el POS y, p. ej., Ubicaciones agregan al mismo) y guardado
 * en este equipo: cambiar de pantalla o recargar no lo pierde.
 */
export function CartsProvider({ children }: { children: ReactNode }) {
  const [tickets, dispatch] = useReducer(ticketsReducer, undefined, loadTickets)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(tickets)) } catch { /* sin almacenamiento */ } }, [tickets])
  const carts = useMemo(() => {
    const cart = (caja: Caja): Cart => ({
      lines: tickets[caja],
      total: round2(tickets[caja].reduce((s, l) => s + round2(l.qty * l.unit_price), 0)),
      dispatch: action => dispatch({ caja, action }),
    })
    return { ferreteria: cart('ferreteria'), copias: cart('copias') }
  }, [tickets])
  return <CartsCtx.Provider value={carts}>{children}</CartsCtx.Provider>
}

export function useCarts() {
  const carts = useContext(CartsCtx)
  if (!carts) throw new Error('useCarts fuera de CartsProvider')
  return carts
}
