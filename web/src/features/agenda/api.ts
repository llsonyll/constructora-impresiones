import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { type AgendaEvent, type AgendaKind, type OccurrenceRow, type RepeatUnit, alerts, dayKey } from './agenda'

export const agendaKeys = { all: ['agenda'] as const }

const num = (v: unknown) => (v == null ? null : Number(v))

interface Data { events: AgendaEvent[]; rows: OccurrenceRow[] }

/**
 * Todos los eventos y lo anotado en sus fechas. Son pocos (decenas), así que se traen enteros y las fechas se
 * calculan en la app para cualquier mes. El proveedor y la OC solo llegan a admin y almacén (RLS).
 */
export function useAgenda(enabled = true) {
  return useQuery({
    queryKey: agendaKeys.all,
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<Data> => {
      const [ev, oc] = await Promise.all([
        supabase.from('agenda_events')
          .select('id, kind, title, start_date, repeat_unit, repeat_every, repeat_until, amount, provider_id, purchase_order_id, notes, created_by, created_at, providers(name, phone), purchase_orders(number, status)')
          .order('start_date'),
        supabase.from('agenda_occurrences').select('event_id, occurrence, moved_to, done_at, done_by, amount, note'),
      ])
      if (ev.error) throw ev.error
      if (oc.error) throw oc.error
      type Row = Omit<AgendaEvent, 'provider_name' | 'provider_phone' | 'po_number' | 'po_status'> & {
        providers: { name: string; phone: string | null } | null
        purchase_orders: { number: number; status: string } | null
      }
      return {
        events: (ev.data as unknown as Row[]).map(({ providers, purchase_orders, ...e }) => ({
          ...e, amount: num(e.amount), provider_name: providers?.name ?? null, provider_phone: providers?.phone ?? null,
          po_number: purchase_orders?.number ?? null, po_status: purchase_orders?.status ?? null,
        })),
        rows: (oc.data as OccurrenceRow[]).map(r => ({ ...r, amount: num(r.amount) })),
      }
    },
  })
}

/** Vencidos y de hoy sin hacer: para el aviso en el menú. */
export function useAgendaAlerts(enabled = true) {
  const { data } = useAgenda(enabled)
  const today = dayKey()
  return useMemo(() => (data ? alerts(data.events, data.rows, today) : { overdue: [], today: [] }), [data, today])
}

export interface EventInput {
  id?: string
  kind: AgendaKind
  title: string
  start_date: string
  repeat_unit: RepeatUnit | null
  repeat_every: number
  repeat_until: string | null
  amount: number | null
  provider_id: string | null
  purchase_order_id: string | null
  notes: string | null
}

export function useSaveEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...row }: EventInput) => {
      const { data, error } = id
        ? await supabase.from('agenda_events').update(row).eq('id', id).select('id')
        : await supabase.from('agenda_events').insert(row).select('id')
      if (error) throw error
      if (!data?.length) throw { code: '42501' }  // RLS: no es suyo
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: agendaKeys.all }),
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('agenda_events').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw { code: '42501' }  // RLS: no es suyo
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: agendaKeys.all }),
  })
}

type Key = { event_id: string; occurrence: string }

/** Cambia lo anotado en una fecha (solo las columnas que se pasan) y actualiza la caché al instante. */
export function useSetOccurrence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: Key & Partial<Omit<OccurrenceRow, 'event_id' | 'occurrence'>>) => {
      const { error } = await supabase.from('agenda_occurrences').upsert(r, { onConflict: 'event_id,occurrence' })
      if (error) throw error
    },
    onMutate: r => {
      qc.setQueryData<Data>(agendaKeys.all, d => {
        if (!d) return d
        const i = d.rows.findIndex(x => x.event_id === r.event_id && x.occurrence === r.occurrence)
        const base: OccurrenceRow = i >= 0 ? d.rows[i] : { ...r, moved_to: null, done_at: null, done_by: null, amount: null, note: null }
        const next = { ...base, ...r }
        return { ...d, rows: i >= 0 ? d.rows.map((x, j) => (j === i ? next : x)) : [...d.rows, next] }
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: agendaKeys.all }),
  })
}

export function friendlyAgendaError(e: unknown) {
  const err = e as { code?: string; message?: string }
  if (err.code === '42501' || /row-level security/i.test(err.message ?? '')) return 'No tienes permiso: solo quien lo creó o el administrador puede cambiarlo.'
  if (err.code === '23514') return 'Revisa los datos: la fecha final no puede ser antes de la primera.'
  return err.message ?? 'Error inesperado'
}
