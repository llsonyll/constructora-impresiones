import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SaleReceipt } from '@/features/documents/api'
import type { ReturnableSale } from '@/features/pos/returns'
import type { Caja, PaymentMethod, Shift } from '@/types/domain'

/** Categoría para los totales de líneas sin producto o sin categoría. */
export const FREE_ITEM = 'Ítem libre'
export const NO_CATEGORY = 'Sin categoría'

export interface SaleLine {
  description: string
  qty: number
  unit_price: number
  subtotal: number
  category: string               // nombre de la categoría del producto, o FREE_ITEM / NO_CATEGORY
  product_id?: string | null
  unit_cost?: number | null      // costo al momento de la venta (para margen; solo lo usa el admin)
  returns_item_id?: number | null // línea devuelta en un cambio (qty negativa)
  returned_qty?: number          // cuánto de esta línea ya se devolvió en cambios vigentes
}

export interface DaySale {
  id: string
  number: number | null          // null mientras está en la cola local
  cashier_id: string | null
  caja: Caja
  shift: Shift
  payment_method: PaymentMethod
  total: number
  status: 'completada' | 'anulada'
  sold_at: string
  customer_name: string | null
  customer_doc?: string | null
  note: string | null
  items: SaleLine[]
  pending?: boolean              // guardada en el equipo, aún sin sincronizar
  receipt?: SaleReceipt | null   // boleta o factura emitida en SOL y anotada en la venta
  returns_sale_id?: string | null // cambio o devolución: venta de la que se devolvieron productos
}

/** ¿Es un cambio o devolución? (también las que siguen en la cola: lo dicen sus líneas devueltas). */
export const isChange = (s: Pick<DaySale, 'returns_sale_id' | 'items'>) =>
  s.returns_sale_id != null || s.items.some(i => i.returns_item_id != null)

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
}
export const SHIFT_LABEL: Record<Shift, string> = { manana: 'Mañana', tarde: 'Tarde' }

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

type Row = Omit<DaySale, 'items' | 'pending' | 'receipt'> & {
  sale_items: { description: string; qty: number; unit_price: number; subtotal: number; product_id: string | null;
                unit_cost: number | null; returns_item_id: number | null; returned_qty: number;
                products: { categories: { name: string } | null } | null }[]
  documents: (SaleReceipt & { type: string; voided_at: string | null })[]
}

export const salesKeys = {
  day: (day: string) => ['sales', 'day', day] as const,
  range: (from: string, to: string) => ['sales', 'range', from, to] as const,
}

const SALE_COLS = 'id, number, cashier_id, caja, shift, payment_method, total, status, sold_at, customer_name, customer_doc, note, returns_sale_id, ' +
  'sale_items(description, qty, unit_price, subtotal, product_id, unit_cost, returns_item_id, returned_qty, products(categories(name))), ' +
  'documents(id, type, series, number, voided_at)'
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
  return rows.map(({ sale_items, documents, ...s }) => ({
    ...s,
    total: Number(s.total),
    receipt: documents.filter(d => (d.type === 'boleta' || d.type === 'factura') && !d.voided_at)
      .map(({ voided_at: _v, ...d }) => ({ ...d, number: Number(d.number) }))[0] ?? null,
    items: sale_items.map(i => ({
      description: i.description, qty: Number(i.qty), unit_price: Number(i.unit_price), subtotal: Number(i.subtotal),
      product_id: i.product_id, unit_cost: i.unit_cost == null ? null : Number(i.unit_cost),
      returns_item_id: i.returns_item_id, returned_qty: Number(i.returned_qty ?? 0),
      category: i.product_id == null ? FREE_ITEM : i.products?.categories?.name ?? NO_CATEGORY,
    })),
  }))
}

/** Ventas de un rango de días locales `YYYY-MM-DD` (ambos inclusive). */
export function useRangeSales(fromDay: string, toDay: string) {
  return useQuery({
    queryKey: salesKeys.range(fromDay, toDay),
    enabled: fromDay <= toDay,
    meta: { silent: true },
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
    meta: { silent: true },
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

/**
 * Ventas de los últimos 7 días con algo por devolver, de cualquier cajero (el cliente puede volver en otro turno).
 * `search`: número (`1234` o `#1234`) o palabras del producto; vacío = las más recientes. Solo con internet.
 */
export async function fetchSalesForReturn(search: string): Promise<ReturnableSale[]> {
  const { data, error } = await supabase.rpc('sales_for_return', { p_search: search })
  if (error) throw error
  return (data as ReturnableSale[]).map(s => ({
    ...s, number: Number(s.number), total: Number(s.total),
    items: (s.items ?? []).map(i => ({ ...i, id: Number(i.id), qty: Number(i.qty), unit_price: Number(i.unit_price),
                                       factor: Number(i.factor), returned_qty: Number(i.returned_qty) })),
  }))
}
