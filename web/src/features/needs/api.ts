import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Faltante: algo que se necesita y aún no se consiguió (tabla product_needs, ver migración 20261104000000_faltantes). */
export type NeedStatus = 'pendiente' | 'atendido' | 'descartado'
export type NeedSource = 'pedido' | 'cliente' | 'stock_bajo' | 'manual'

export interface Need {
  id: number
  product_id: string | null
  description: string
  qty: number | null
  unit: string | null
  source: NeedSource
  provider_id: string | null
  reference: string | null
  notes: string | null
  status: NeedStatus
  po_id: string | null
  po_number: number | null
  po_status: 'borrador' | 'enviada' | 'recibida' | 'cancelada' | null
  created_at: string
  resolved_at: string | null
}

export const SOURCE_LABEL: Record<NeedSource, string> = {
  pedido: 'No atendido por el proveedor', cliente: 'Lo pidió un cliente', stock_bajo: 'Stock bajo', manual: 'Anotado a mano',
}
export const SOURCE_SHORT: Record<NeedSource, string> = {
  pedido: 'No atendido', cliente: 'Cliente', stock_bajo: 'Stock bajo', manual: 'Manual',
}

export const needKeys = { all: ['needs'] as const }

const COLS = 'id, product_id, description, qty, unit, source, provider_id, reference, notes, status, po_id, created_at, resolved_at, purchase_orders(number, status)'

/** Pendientes (todos) y los cerrados de los últimos 60 días. */
export function useNeeds() {
  return useQuery({
    queryKey: needKeys.all,
    queryFn: async (): Promise<Need[]> => {
      const since = new Date(Date.now() - 60 * 86400_000).toISOString()
      const { data, error } = await supabase.from('product_needs').select(COLS)
        .or(`status.eq.pendiente,resolved_at.gte.${since}`)
        .order('created_at', { ascending: false }).limit(1000)
      if (error) throw error
      type Row = Omit<Need, 'po_number' | 'po_status' | 'qty'> & { qty: string | number | null; purchase_orders: { number: number; status: Need['po_status'] } | null }
      return (data as unknown as Row[]).map(({ purchase_orders, qty, ...n }) => ({
        ...n, qty: qty == null ? null : Number(qty),
        po_number: purchase_orders?.number ?? null, po_status: purchase_orders?.status ?? null,
      }))
    },
  })
}

export interface NeedInput {
  id?: number
  product_id: string | null
  description: string
  qty: number | null
  unit: string | null
  source: NeedSource
  provider_id: string | null
  reference: string | null
  notes: string | null
}

export function useSaveNeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }: NeedInput) => {
      const row = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))
      const { error } = id
        ? await supabase.from('product_needs').update(row).eq('id', id)
        : await supabase.from('product_needs').insert(row)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: needKeys.all }),
  })
}

export function useSetNeedStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: NeedStatus }) => {
      // Reabrir suelta la orden con la que se había atendido.
      const patch = status === 'pendiente' ? { status, po_id: null } : { status }
      const { error } = await supabase.from('product_needs').update(patch).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: needKeys.all }),
  })
}

/** Enlaza un faltante a un producto del catálogo (p. ej. recién registrado desde la lista). */
export function useLinkNeedProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, product_id }: { id: number; product_id: string }) => {
      const { error } = await supabase.from('product_needs').update({ product_id }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: needKeys.all }),
  })
}

/** Marca los faltantes como pedidos en una orden (solo los que siguen pendientes). */
export async function linkNeedsToOrder(ids: number[], poId: string) {
  if (!ids.length) return
  const { error } = await supabase.from('product_needs').update({ po_id: poId }).in('id', ids).eq('status', 'pendiente')
  if (error) throw error
}

export async function fetchNeedsByIds(ids: number[]) {
  const { data, error } = await supabase.from('product_needs')
    .select('id, product_id, qty, unit, status').in('id', ids)
  if (error) throw error
  return (data as { id: number; product_id: string | null; qty: string | number | null; unit: string | null; status: NeedStatus }[])
    .map(n => ({ ...n, qty: n.qty == null ? null : Number(n.qty) }))
}

export const fmtNeedQty = (n: Pick<Need, 'qty' | 'unit'>) =>
  n.qty == null ? '' : `${Number(n.qty.toFixed(3))}${n.unit ? ` ${n.unit}` : ''}`
