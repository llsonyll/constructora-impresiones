import { useEffect, useState } from 'react'
import type { Caja, Category, Product } from '@/types/domain'

export const CAJAS: Caja[] = ['ferreteria', 'copias']
export const CAJA_LABEL: Record<Caja, string> = { ferreteria: 'Ferretería', copias: 'Copias y librería' }
export const CAJA_ICON: Record<Caja, string> = { ferreteria: '🔧', copias: '🖨️' }

/** Color de cada caja: el POS cambia de color para que se note en cuál se está cobrando. */
export const CAJA_THEME: Record<Caja, { solid: string; soft: string; text: string; border: string }> = {
  ferreteria: { solid: 'bg-amber-700', soft: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-700' },
  copias:     { solid: 'bg-sky-700',   soft: 'bg-sky-50',   text: 'text-sky-800',   border: 'border-sky-700' },
}

/** Caja de un producto según su categoría; sin categoría (o categoría desconocida) → ferretería. */
export function cajaOf(p: Pick<Product, 'category_id'>, cats: Map<number, Category>): Caja {
  return (p.category_id != null && cats.get(p.category_id)?.caja) || 'ferreteria'
}

const KEY = 'pos.caja'
const read = (): Caja => { try { return localStorage.getItem(KEY) === 'copias' ? 'copias' : 'ferreteria' } catch { return 'ferreteria' } }

/** Caja elegida en este equipo (cada mostrador suele usar siempre la misma). */
export function useCajaPref() {
  const [caja, setCaja] = useState<Caja>(read)
  useEffect(() => { try { localStorage.setItem(KEY, caja) } catch { /* sin almacenamiento: solo en memoria */ } }, [caja])
  return [caja, setCaja] as const
}

/** Veces que se agregó cada producto en este equipo: ordena el catálogo con lo más vendido primero. */
const USE_KEY = 'pos.uso'
export function readUsage(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(USE_KEY) ?? '{}') as Record<string, number> } catch { return {} }
}
export function bumpUsage(id: string, by = 1) {
  try {
    const u = readUsage()
    u[id] = (u[id] ?? 0) + by
    localStorage.setItem(USE_KEY, JSON.stringify(u))
  } catch { /* opcional */ }
}
