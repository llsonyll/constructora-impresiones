import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Provider {
  id: string
  name: string
  ruc: string | null
  contact: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  active: boolean
  product_count: number
}

export type PoStatus = 'borrador' | 'enviada' | 'recibida' | 'cancelada'

export interface PurchaseOrderRow {
  id: string
  number: number
  provider_id: string
  provider_name: string
  status: PoStatus
  invoice_ref: string | null
  total: number
  item_count: number
  created_at: string
  ordered_at: string | null
  received_at: string | null
}

/** unit_cost null = por cotizar (se completa con la cotización o la factura; para recibir es obligatorio). */
export interface PoItem { product_id: string; qty: number; unit_cost: number | null }

export interface PurchaseOrder extends Omit<PurchaseOrderRow, 'provider_name' | 'item_count'> {
  note: string | null
  costs_include_igv: boolean
  items: PoItem[]
}

/** Lo que devuelve receive_purchase_order: un renglón por producto, con el costo antes y después. */
export interface ReceiptLine {
  product_id: string
  name: string
  unit: string
  qty: number
  price: number | null
  old_cost: number | null
  new_cost: number
  stock: number
}

export const poLabel = (n: number) => `OC-${String(n).padStart(4, '0')}`

export const STATUS_LABEL: Record<PoStatus, string> = {
  borrador: 'Borrador', enviada: 'Enviada', recibida: 'Recibida', cancelada: 'Cancelada',
}
export const STATUS_STYLE: Record<PoStatus, string> = {
  borrador: 'bg-stone-200 text-stone-700', enviada: 'bg-blue-100 text-blue-800',
  recibida: 'bg-green-100 text-green-800', cancelada: 'bg-red-100 text-red-700',
}

export const providerKeys = {
  all: ['providers'] as const,
  list: ['providers', 'list'] as const,
  orders: ['purchase-orders'] as const,
  order: (id: string) => ['purchase-orders', id] as const,
}

export function useProviderList() {
  return useQuery({
    queryKey: providerKeys.list,
    queryFn: async (): Promise<Provider[]> => {
      const { data, error } = await supabase.from('providers')
        .select('id, name, ruc, contact, phone, email, address, notes, active, products(count)').order('name')
      if (error) throw error
      return (data as unknown as (Omit<Provider, 'product_count'> & { products: { count: number }[] })[])
        .map(({ products, ...p }) => ({ ...p, product_count: products[0]?.count ?? 0 }))
    },
  })
}

export type ProviderInput = Omit<Provider, 'id' | 'product_count'> & { id?: string }

export function useSaveProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }: ProviderInput) => {
      const row = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))
      const { data, error } = id
        ? await supabase.from('providers').update(row).eq('id', id).select('id').single()
        : await supabase.from('providers').insert(row).select('id').single()
      if (error) throw error
      return data.id as string
    },
    // También refresca el selector de proveedor del inventario (['providers', 'refs']).
    onSuccess: () => qc.invalidateQueries({ queryKey: providerKeys.all }),
  })
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: providerKeys.orders,
    queryFn: async (): Promise<PurchaseOrderRow[]> => {
      const { data, error } = await supabase.from('purchase_orders')
        .select('id, number, provider_id, status, invoice_ref, total, created_at, ordered_at, received_at, providers(name), purchase_order_items(count)')
        .order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      type Row = Omit<PurchaseOrderRow, 'provider_name' | 'item_count'> &
        { providers: { name: string } | null; purchase_order_items: { count: number }[] }
      return (data as unknown as Row[]).map(({ providers, purchase_order_items, ...o }) =>
        ({ ...o, provider_name: providers?.name ?? '—', item_count: purchase_order_items[0]?.count ?? 0 }))
    },
  })
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: providerKeys.order(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<PurchaseOrder> => {
      const { data, error } = await supabase.from('purchase_orders')
        .select('id, number, provider_id, status, invoice_ref, note, costs_include_igv, total, created_at, ordered_at, received_at, purchase_order_items(product_id, qty, unit_cost, id)')
        .eq('id', id!).order('id', { referencedTable: 'purchase_order_items' }).single()
      if (error) throw error
      const { purchase_order_items, ...o } = data as unknown as Omit<PurchaseOrder, 'items'> & { purchase_order_items: (PoItem & { id: number })[] }
      return { ...o, items: purchase_order_items.map(({ product_id, qty, unit_cost }) => ({ product_id, qty: Number(qty), unit_cost: unit_cost == null ? null : Number(unit_cost) })) }
    },
  })
}

export interface PoDraft {
  id?: string
  provider_id: string
  invoice_ref: string
  note: string
  costs_include_igv: boolean
  items: PoItem[]
}

export function useSavePurchaseOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: PoDraft) => {
      const { data, error } = await supabase.rpc('save_purchase_order', { p: d })
      if (error) throw error
      return data as string
    },
    onSuccess: id => {
      qc.invalidateQueries({ queryKey: providerKeys.orders })
      qc.invalidateQueries({ queryKey: providerKeys.order(id) })
    },
  })
}

export function useSetPoStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'enviada' | 'cancelada' | 'borrador' }) => {
      const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: providerKeys.orders })
      qc.invalidateQueries({ queryKey: providerKeys.order(id) })
      qc.invalidateQueries({ queryKey: ['needs'] })   // cancelar suelta los faltantes enlazados (trigger)
    },
  })
}

/** Única edición permitida en una orden recibida (lo hace cumplir el trigger po_guard). */
export function useUpdateInvoiceRef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, invoice_ref }: { id: string; invoice_ref: string }) => {
      const { error } = await supabase.from('purchase_orders').update({ invoice_ref: invoice_ref.trim() || null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: providerKeys.orders })
      qc.invalidateQueries({ queryKey: providerKeys.order(id) })
    },
  })
}

export function useDeletePurchaseOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('purchase_orders').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerKeys.orders })
      qc.invalidateQueries({ queryKey: ['needs'] })
    },
  })
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('receive_purchase_order', { p_po_id: id })
      if (error) throw error
      return (data ?? []) as ReceiptLine[]
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: providerKeys.orders })
      qc.invalidateQueries({ queryKey: providerKeys.order(id) })
      qc.invalidateQueries({ queryKey: ['inventory'] })   // stock y costos cambiaron
      qc.invalidateQueries({ queryKey: ['needs'] })       // los faltantes de esos productos quedan atendidos (trigger)
    },
  })
}

/**
 * Rearma el resumen de una orden ya recibida (el que sale al recibir), para volver a poner precios y ubicar
 * si se cerró la pantalla antes de terminar (refresco, corte de internet…). Costo nuevo y cantidad salen del
 * historial de costos de esa orden; el costo anterior, de la entrada previa de cada producto. Stock y precio son
 * los actuales.
 */
export async function fetchReceiptLines(
  order: Pick<PurchaseOrder, 'id' | 'items' | 'costs_include_igv' | 'received_at'>,
  products: Map<string, { name: string; unit: string; price: number | null; stock: number }>,
): Promise<ReceiptLine[]> {
  const ids = [...new Set(order.items.map(i => i.product_id))]
  const { data: mine, error: e1 } = await supabase.from('product_cost_history')
    .select('product_id, cost, qty, created_at').eq('po_id', order.id).eq('source', 'compra')
  if (e1) throw e1
  const byProduct = new Map(mine.map(h => [h.product_id as string, h]))
  const receivedAt = mine[0]?.created_at ?? order.received_at
  const before = new Map<string, number>()
  if (receivedAt && ids.length) {
    const { data: prev, error: e2 } = await supabase.from('product_cost_history')
      .select('product_id, cost').in('product_id', ids).lt('created_at', receivedAt)
      .order('created_at', { ascending: false }).limit(20 * ids.length)
    if (e2) throw e2
    for (const h of prev) if (!before.has(h.product_id)) before.set(h.product_id, Number(h.cost))
  }
  const factor = order.costs_include_igv ? 1 : 1.18
  const lines: ReceiptLine[] = []
  for (const id of ids) {
    const p = products.get(id)
    const items = order.items.filter(i => i.product_id === id)
    const h = byProduct.get(id)
    const qty = h?.qty != null ? Number(h.qty) : items.reduce((s, i) => s + i.qty, 0)
    // Sin historial (no debería pasar): el mismo cálculo que receive_purchase_order.
    const cost = h ? Number(h.cost)
      : qty ? Math.round(items.reduce((s, i) => s + i.qty * (i.unit_cost ?? 0), 0) / qty * factor * 10000) / 10000 : 0
    lines.push({
      product_id: id, name: p?.name ?? 'Producto', unit: p?.unit ?? '', qty, price: p?.price ?? null,
      old_cost: before.get(id) ?? null, new_cost: cost, stock: p?.stock ?? 0,
    })
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name))
}

/** Enlace de WhatsApp (Perú: 9 dígitos → +51). */
export function whatsappUrl(phone: string | null, text = '') {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 9) return null
  const full = digits.length === 9 ? `51${digits}` : digits
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function friendlyPoError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  if (msg.includes('providers_ruc_key')) return 'Ya existe un proveedor con ese RUC.'
  if (msg.includes('providers_ruc_check')) return 'El RUC debe tener 11 dígitos.'
  return msg
}
