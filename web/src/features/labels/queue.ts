import { useSyncExternalStore } from 'react'

/** Una línea de la lista: el producto y cuántas etiquetas suyas imprimir. Precio y nombre se leen al imprimir. */
export interface LabelItem { id: string; copies: number }

const KEY = 'etiquetas-lista'
export const MAX_COPIES = 50

function read(): LabelItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((x): x is LabelItem => typeof x?.id === 'string' && Number.isInteger(x?.copies) && x.copies > 0)
      : []
  } catch { return [] }
}

let items: LabelItem[] = read()
const listeners = new Set<() => void>()

function commit(next: LabelItem[]) {
  items = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* modo privado: queda solo en memoria */ }
  listeners.forEach(l => l())
}

// Otra pestaña del mismo equipo cambió la lista (p. ej. el inventario abierto en otra ventana).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === KEY) { items = read(); listeners.forEach(l => l()) }
  })
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** La lista de etiquetas por imprimir, guardada en este equipo y compartida por todas las pantallas. */
export function useLabelQueue() {
  return useSyncExternalStore(subscribe, () => items)
}

export const labelQueue = {
  get: () => items,
  has: (id: string) => items.some(i => i.id === id),
  /** Agrega al final los que no están; devuelve cuántos se agregaron (los repetidos no se duplican). */
  add(ids: string[]) {
    const fresh = [...new Set(ids)].filter(id => !items.some(i => i.id === id))
    if (fresh.length) commit([...items, ...fresh.map(id => ({ id, copies: 1 }))])
    return fresh.length
  },
  setCopies(id: string, copies: number) {
    const n = Math.min(MAX_COPIES, Math.max(1, Math.round(copies)))
    commit(items.map(i => (i.id === id ? { ...i, copies: n } : i)))
  },
  remove(id: string) { commit(items.filter(i => i.id !== id)) },
  /** Para *Deshacer*: vuelve a poner una lista anterior tal cual. */
  restore(list: LabelItem[]) { commit(list) },
  clear() { commit([]) },
}
