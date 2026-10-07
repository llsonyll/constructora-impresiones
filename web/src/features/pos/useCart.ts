import { useMemo, useReducer } from 'react'
import type { CartLine, Product } from '@/types/domain'
import { round2 } from '@/lib/format'

type Action =
  | { type: 'addProduct'; product: Product }
  | { type: 'addCustom'; description: string; qty: number; unit_price: number }
  | { type: 'addLine'; product_id: string; description: string; qty: number; unit_price: number }
  | { type: 'setQty'; key: string; qty: number }
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
    case 'remove': return state.filter(l => l.key !== a.key)
    case 'clear': return []
  }
}

export function useCart() {
  const [lines, dispatch] = useReducer(reducer, [])
  const total = useMemo(() => round2(lines.reduce((s, l) => s + round2(l.qty * l.unit_price), 0)), [lines])
  return { lines, total, dispatch }
}
