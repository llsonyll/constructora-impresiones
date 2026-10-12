import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Caja, PaymentMethod, Shift } from '@/types/domain'

export interface CashExpense {
  id: number
  caja: Caja
  day: string          // YYYY-MM-DD (hora de Lima)
  shift: Shift
  amount: number
  description: string
  created_by: string
  created_at: string
}

/** Foto de los totales al cerrar (no cambia si después se anula una venta). */
export interface CashClosure {
  id: number
  caja: Caja
  day: string
  shift: Shift
  sales_count: number
  total_sales: number
  by_method: Partial<Record<PaymentMethod, number>>
  cash_sales: number
  expenses: number
  expected_cash: number
  counted_cash: number
  difference: number   // + sobra, − falta
  note: string | null
  closed_by: string
  closed_at: string
}

export const cashKeys = {
  expenses: (day: string) => ['cash', 'expenses', day] as const,
  closures: (from: string, to: string) => ['cash', 'closures', from, to] as const,
}

const n = (v: unknown) => Number(v ?? 0)
const toClosure = (r: CashClosure): CashClosure => ({
  ...r, total_sales: n(r.total_sales), cash_sales: n(r.cash_sales), expenses: n(r.expenses), expected_cash: n(r.expected_cash),
  counted_cash: n(r.counted_cash), difference: n(r.difference),
  by_method: Object.fromEntries(Object.entries(r.by_method ?? {}).map(([k, v]) => [k, n(v)])),
})

export function friendlyCashError(e: unknown) {
  const err = e as { code?: string; message?: string }
  if (err.code === '42501') return 'No tienes permiso para esta acción.'
  if (err.code === '23505') return 'Ese turno ya está cerrado.'
  return err.message ?? 'Error inesperado'
}

export function useExpenses(day: string) {
  return useQuery({
    queryKey: cashKeys.expenses(day),
    queryFn: async (): Promise<CashExpense[]> => {
      const { data, error } = await supabase.from('cash_expenses')
        .select('id, caja, day, shift, amount, description, created_by, created_at').eq('day', day).order('created_at')
      if (error) throw error
      return (data as CashExpense[]).map(x => ({ ...x, amount: n(x.amount) }))
    },
  })
}

/** Cierres entre dos días (inclusive), más recientes primero. */
export function useClosures(from: string, to: string) {
  return useQuery({
    queryKey: cashKeys.closures(from, to),
    queryFn: async (): Promise<CashClosure[]> => {
      const { data, error } = await supabase.from('cash_closures').select('*')
        .gte('day', from).lte('day', to).order('day', { ascending: false }).order('shift', { ascending: false }).order('caja')
      if (error) throw error
      return (data as CashClosure[]).map(toClosure)
    },
  })
}

export function useAddExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: Pick<CashExpense, 'caja' | 'day' | 'shift' | 'amount' | 'description'>) => {
      const { error } = await supabase.from('cash_expenses').insert(e)
      if (error) throw error
    },
    onSuccess: (_d, e) => qc.invalidateQueries({ queryKey: cashKeys.expenses(e.day) }),
  })
}

export function useDeleteExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: Pick<CashExpense, 'id' | 'day'>) => {
      const { error } = await supabase.from('cash_expenses').delete().eq('id', e.id)
      if (error) throw error
    },
    onSuccess: (_d, e) => qc.invalidateQueries({ queryKey: cashKeys.expenses(e.day) }),
  })
}

/** Cerrar: el servidor suma todas las ventas de esa caja y turno (de cualquier usuario) y los gastos. */
export function useCloseCash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { caja: Caja; day: string; shift: Shift; counted: number; note: string }) => {
      const { data, error } = await supabase.rpc('close_cash',
        { p_caja: a.caja, p_day: a.day, p_shift: a.shift, p_counted: a.counted, p_note: a.note })
      if (error) throw error
      return toClosure(data as CashClosure)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash', 'closures'] }),
  })
}

/** Reabrir (solo admin): borra el cierre para corregir gastos o volver a contar. */
export function useReopenCash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('cash_closures').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash', 'closures'] }),
  })
}
