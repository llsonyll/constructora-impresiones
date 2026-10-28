import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { dayRange } from '@/features/sales/api'

/** Qué se registra en la bitácora (ver la migración activity_log: la llenan triggers de la base). */
export type ActivityKind = 'venta' | 'producto' | 'compra' | 'stock'

export interface ActivityChange { antes: unknown; despues: unknown }
export interface StockLine { product_id: string; sku: string; name: string; unit: string; qty: number; stock: number }

export interface ActivityRow {
  id: number
  created_at: string
  actor_id: string | null
  actor_name: string | null      // nombre al momento; null = sin usuario (SQL directo)
  via: string | null             // 'claude' si lo cargó Claude
  kind: ActivityKind
  action: string
  entity_id: string | null
  summary: string
  details: {
    changes?: Record<string, ActivityChange>
    items?: StockLine[] | number
    note?: string | null
    sold_at?: string
    customer_name?: string | null
    invoice_ref?: string | null
    [k: string]: unknown
  }
}

export const KIND_LABEL: Record<ActivityKind, string> = {
  venta: 'Ventas', producto: 'Productos', compra: 'Compras', stock: 'Stock',
}

export interface ActivityFilters {
  from: string          // día local YYYY-MM-DD (inclusive)
  to: string            // día local YYYY-MM-DD (inclusive)
  kind: ActivityKind | ''
  actor: string         // actor_id, o '' = todos
  q: string             // texto dentro del resumen (nombre de producto, OC-0012, #venta…)
}

const PAGE = 100

/** Bitácora del período, lo más reciente primero, de a 100 líneas ("Cargar más"). Solo la lee el admin (RLS). */
export function useActivity(f: ActivityFilters) {
  return useInfiniteQuery({
    queryKey: ['activity', f],
    initialPageParam: 0,
    enabled: f.from <= f.to,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('activity_log').select('*')
        .gte('created_at', dayRange(f.from).from).lt('created_at', dayRange(f.to).to)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(pageParam * PAGE, pageParam * PAGE + PAGE - 1)
      if (f.kind) q = q.eq('kind', f.kind)
      if (f.actor) q = q.eq('actor_id', f.actor)
      // Comodines de ilike escapados: "50%" busca el texto literal.
      if (f.q.trim()) q = q.ilike('summary', `%${f.q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`)
      const { data, error } = await q
      if (error) throw error
      return data as ActivityRow[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length : undefined),
  })
}
