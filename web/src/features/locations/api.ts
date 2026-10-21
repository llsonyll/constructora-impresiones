import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { FurnitureType, Location } from '@/types/domain'

export const FURNITURE_LABEL: Record<FurnitureType, string> = { estante: 'Estante', vitrina: 'Vitrina', mostrador: 'Mostrador' }
export const LOCATION_RE = /^[A-Z]\d+(-[A-Z])?-N\d+(-[A-Z])?$/

/** Orden físico: mueble (E0, E1… E10), cuerpo, nivel de arriba hacia abajo, sección de izquierda a derecha. */
export function compareLocations(a: Location, b: Location) {
  const n = (f: string) => [f[0], Number(f.slice(1))] as const
  const [fa, na] = n(a.furniture), [fb, nb] = n(b.furniture)
  return fa.localeCompare(fb) || na - nb || (a.body ?? '').localeCompare(b.body ?? '')
    || a.level - b.level || (a.slot ?? '').localeCompare(b.slot ?? '')
}

/** "e2 n5", "E2N5" o "e2-n5" → "E2-N5" (para buscar escribiendo como sea). */
export function normalizeCode(s: string) {
  const compact = s.toUpperCase().replace(/[\s_.\-]+/g, '')
  const m = compact.match(/^([A-Z]\d+)([A-Z](?=N))?(N\d+)?([A-Z])?$/)
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join('-') : s.toUpperCase().trim().replace(/\s+/g, '-')
}

export const locationKeys = { all: ['locations'] as const }

export function useLocations() {
  return useQuery({
    queryKey: locationKeys.all,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Location[]> => {
      const { data, error } = await supabase.from('locations')
        .select('id, code, furniture, body, level, slot, furniture_type, description, active')
      if (error) throw error
      return (data as Location[]).sort(compareLocations)
    },
  })
}

export type LocationInput = Pick<Location, 'furniture' | 'body' | 'level' | 'slot' | 'furniture_type' | 'description' | 'active'> & { id?: number }

export function friendlyLocationError(e: unknown) {
  const err = e as { code?: string; message?: string }
  if (err.code === '23505') return 'Ya existe una ubicación con ese código.'
  if (err.code === '23503') return err.message?.startsWith('La ubicación') ? err.message : 'Tiene productos asignados: no se puede eliminar. Desactívala o quita los productos primero.'
  if (err.code === '23514') return 'Código inválido. Formato: MUEBLE[-CUERPO]-NIVEL[-SECCIÓN], p. ej. E2-N5 o E0-B-N2-F.'
  if (err.code === '42501') return 'No tienes permiso para esta acción.'
  return err.message ?? 'Error inesperado'
}

export function useSaveLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }: LocationInput) => {
      const q = id ? supabase.from('locations').update(fields).eq('id', id) : supabase.from('locations').insert(fields)
      const { data, error } = await q.select('id').single()
      if (error) throw error
      return data.id as number
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: locationKeys.all }); void qc.invalidateQueries({ queryKey: ['inventory'] }) },
  })
}

export function useDeleteLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('locations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: locationKeys.all }),
  })
}

type Assign =
  | { op: 'add'; productId: string; locationId: number; primary?: boolean }
  | { op: 'remove'; productId: string; locationId: number }
  | { op: 'primary'; productId: string; locationId: number }
  | { op: 'qty'; productId: string; locationId: number; qty: number | null }

/** Asignar, quitar, marcar principal o poner cantidad referencial. Los triggers mantienen una sola principal. */
export function useProductLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: Assign) => {
      const t = supabase.from('product_locations')
      const key = { product_id: a.productId, location_id: a.locationId }
      const { error } =
        a.op === 'add' ? await t.upsert({ ...key, ...(a.primary ? { is_primary: true } : {}) }, { onConflict: 'product_id,location_id', ignoreDuplicates: !a.primary })
        : a.op === 'remove' ? await t.delete().match(key)
        : a.op === 'primary' ? await t.update({ is_primary: true }).match(key)
        : await t.update({ qty: a.qty }).match(key)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  })
}

export interface ReshapeInput {
  furniture: string
  body: string | null
  levels: number          // 0 = eliminar el mueble (o cuerpo) completo
  slots: number           // 0 = niveles enteros; n = secciones A…
  new_furniture?: string
  furniture_type?: FurnitureType
}

/** Corrige un mueble entero en una transacción (RPC reshape_furniture); nunca borra casillas con productos. */
export function useReshapeFurniture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: ReshapeInput) => {
      const { data, error } = await supabase.rpc('reshape_furniture', { p })
      if (error) throw error
      return data as { creadas: number; eliminadas: number; modificadas: number; mueble: string }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: locationKeys.all }); void qc.invalidateQueries({ queryKey: ['inventory'] }) },
  })
}
