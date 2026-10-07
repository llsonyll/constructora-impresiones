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

export interface PoItem { product_id: string; qty: number; unit_cost: number }

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
      return { ...o, items: purchase_order_items.map(({ product_id, qty, unit_cost }) => ({ product_id, qty: Number(qty), unit_cost: Number(unit_cost) })) }
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
    onSuccess: () => qc.invalidateQueries({ queryKey: providerKeys.orders }),
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
    },
  })
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
