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
                products: { track_stock: boolean } | null }[]
}

export const salesKeys = { day: (day: string) => ['sales', 'day', day] as const }

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
    queryFn: async (): Promise<DaySale[]> => {
      const { from, to } = dayRange(day)
      const { data, error } = await supabase.from('sales')
        .select('id, number, cashier_id, shift, payment_method, total, status, sold_at, customer_name, note, ' +
                'sale_items(description, qty, unit_price, subtotal, product_id, products(track_stock))')
        .gte('sold_at', from).lt('sold_at', to)
        .order('sold_at', { ascending: false })
      if (error) throw error
      return (data as unknown as Row[]).map(({ sale_items, ...s }) => ({
        ...s,
        total: Number(s.total),
        items: sale_items.map(i => ({
          description: i.description, qty: Number(i.qty), unit_price: Number(i.unit_price), subtotal: Number(i.subtotal),
          kind: i.product_id == null ? 'otros' : i.products?.track_stock === false ? 'impresion' : 'ferreteria',
        })),
      }))
    },
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
