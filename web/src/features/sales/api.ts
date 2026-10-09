import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { PaymentMethod, Shift } from '@/types/domain'

/** Tipo de línea para los totales: impresiones (servicios), ferretería (con stock) u otros (ítem libre). */
export type LineKind = 'impresion' | 'ferreteria' | 'otros'

export interface SaleLine {
  description: string
  qty: number
  unit_price: number
  subtotal: number
  kind: LineKind
  product_id?: string | null
  unit_cost?: number | null      // costo al momento de la venta (para margen; solo lo usa el admin)
}

export interface DaySale {
  id: string
  number: number | null          // null mientras está en la cola local
  cashier_id: string | null
  shift: Shift
  payment_method: PaymentMethod
  total: number
  status: 'completada' | 'anulada'
  sold_at: string
  customer_name: string | null
  note: string | null
  items: SaleLine[]
  pending?: boolean              // guardada en el equipo, aún sin sincronizar
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
}
export const SHIFT_LABEL: Record<Shift, string> = { manana: 'Mañana', tarde: 'Tarde' }
export const KIND_LABEL: Record<LineKind, string> = { ferreteria: 'Ferretería', impresion: 'Impresiones y fotocopias', otros: 'Otros' }

/** Rango [inicio, fin) del día local `YYYY-MM-DD`, en ISO (UTC) para comparar con `sold_at`. */
export function dayRange(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return { from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() }
}

/** Fecha local de hoy como `YYYY-MM-DD` (toISOString daría el día siguiente desde las 19:00 en Perú). */
export function todayLocal(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

type Row = Omit<DaySale, 'items' | 'pending'> & {
  sale_items: { description: string; qty: number; unit_price: number; subtotal: number; product_id: string | null;
                unit_cost: number | null; products: { track_stock: boolean } | null }[]
}

export const salesKeys = {
  day: (day: string) => ['sales', 'day', day] as const,
  range: (from: string, to: string) => ['sales', 'range', from, to] as const,
}

const SALE_COLS = 'id, number, cashier_id, shift, payment_method, total, status, sold_at, customer_name, note, ' +
  'sale_items(description, qty, unit_price, subtotal, product_id, unit_cost, products(track_stock))'
const PAGE = 1000   // tope de filas por consulta de PostgREST en Supabase

/** Ventas con `sold_at` en [from, to), más recientes primero, paginando de a 1000. */
export async function fetchSales(from: string, to: string): Promise<DaySale[]> {
  const rows: Row[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('sales').select(SALE_COLS)
      .gte('sold_at', from).lt('sold_at', to)
      .order('sold_at', { ascending: false }).order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    rows.push(...(data as unknown as Row[]))
    if (data.length < PAGE) break
  }
  return rows.map(({ sale_items, ...s }) => ({
    ...s,
    total: Number(s.total),
    items: sale_items.map(i => ({
      description: i.description, qty: Number(i.qty), unit_price: Number(i.unit_price), subtotal: Number(i.subtotal),
      product_id: i.product_id, unit_cost: i.unit_cost == null ? null : Number(i.unit_cost),
      kind: i.product_id == null ? 'otros' : i.products?.track_stock === false ? 'impresion' : 'ferreteria',
    })),
  }))
}

/** Ventas de un rango de días locales `YYYY-MM-DD` (ambos inclusive). */
export function useRangeSales(fromDay: string, toDay: string) {
  return useQuery({
    queryKey: salesKeys.range(fromDay, toDay),
    enabled: fromDay <= toDay,
    queryFn: () => fetchSales(dayRange(fromDay).from, dayRange(toDay).to),
  })
}

/** Ventas del día (RLS: el cajero ve solo las suyas; el admin, todas). Se refresca en vivo con Realtime. */
export function useDaySales(day: string) {
  const qc = useQueryClient()
  useEffect(() => {
    const ch = supabase.channel(`sales-${day}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' },
          () => { void qc.invalidateQueries({ queryKey: salesKeys.day(day) }) })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [day, qc])

  return useQuery({
    queryKey: salesKeys.day(day),
    refetchInterval: 60_000,
    queryFn: () => { const { from, to } = dayRange(day); return fetchSales(from, to) },
  })
}

/** Nombres de cajeros (el admin lee todos los perfiles; el cajero solo el suyo). */
export function useCashierNames() {
  return useQuery({
    queryKey: ['profiles', 'names'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name')
      if (error) throw error
      return Object.fromEntries(data.map(p => [p.id as string, (p.full_name as string) || 'Sin nombre'])) as Record<string, string>
    },
  })
}

/** Anular (solo admin): marca la venta y repone el stock de lo que se descontó. */
export function useVoidSale(day: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('void_sale', { p_sale_id: id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: salesKeys.day(day) }),
  })
}
