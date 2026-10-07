import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface InventoryProduct {
  id: string
  sku: string
  barcode: string | null
  name: string
  brand: string | null
  category_id: number | null
  provider_id: string | null
  unit: string
  price: number | null
  stock: number
  min_stock: number
  active: boolean
  needs_review: boolean
  notes: string | null
  image_path: string | null    // ruta en el bucket product-images (ver lib/images.ts)
  updated_at: string           // cambia también con ventas/ajustes (el trigger de stock actualiza la fila)
  cost: number | null          // de product_costs (solo admin/almacén lo ven)
}

export interface Category { id: number; name: string }
export interface ProviderRef { id: string; name: string }

export interface StockMovement {
  id: number
  qty: number
  reason: 'venta' | 'compra' | 'ajuste' | 'devolucion' | 'anulacion_venta'
  note: string | null
  created_at: string
}

const PRODUCT_COLS =
  'id, sku, barcode, name, brand, category_id, provider_id, unit, price, stock, min_stock, active, needs_review, notes, image_path, updated_at, product_costs(cost)'

type Row = Omit<InventoryProduct, 'cost'> & { product_costs: { cost: number } | null }

export const inventoryKeys = {
  products: ['inventory', 'products'] as const,
  movements: (id: string) => ['inventory', 'movements', id] as const,
  costHistory: (ids: string[]) => ['inventory', 'cost-history', ...ids] as const,
}

/** Historial de costos (con IGV). product_costs.cost es solo la referencia: el último de aquí. */
export interface CostEntry {
  id: number
  product_id: string
  cost: number
  source: 'compra' | 'manual' | 'inicial'
  qty: number | null
  created_at: string
  provider_name: string | null
  po_id: string | null
  po_number: number | null
}

/** Historial de uno o varios productos, del más reciente al más antiguo. */
export function useCostHistory(productIds: string[], limit = 30) {
  const ids = [...new Set(productIds)].sort()
  return useQuery({
    queryKey: inventoryKeys.costHistory(ids),
    enabled: ids.length > 0,
    queryFn: async (): Promise<CostEntry[]> => {
      const { data, error } = await supabase.from('product_cost_history')
        .select('id, product_id, cost, source, qty, created_at, po_id, providers(name), purchase_orders(number)')
        .in('product_id', ids).order('created_at', { ascending: false }).limit(limit * ids.length)
      if (error) throw error
      type Row = Omit<CostEntry, 'provider_name' | 'po_number'> & { providers: { name: string } | null; purchase_orders: { number: number } | null }
      return (data as unknown as Row[]).map(({ providers, purchase_orders, ...e }) =>
        ({ ...e, cost: Number(e.cost), qty: e.qty == null ? null : Number(e.qty), provider_name: providers?.name ?? null, po_number: purchase_orders?.number ?? null }))
    },
  })
}

export function useInventory() {
  return useQuery({
    queryKey: inventoryKeys.products,
    queryFn: async (): Promise<InventoryProduct[]> => {
      const { data, error } = await supabase.from('products').select(PRODUCT_COLS).order('name')
      if (error) throw error
      return (data as unknown as Row[]).map(({ product_costs, ...p }) => ({ ...p, cost: product_costs?.cost ?? null }))
    },
  })
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from('categories').select('id, name').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useProviders() {
  return useQuery({
    queryKey: ['providers', 'refs'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProviderRef[]> => {
      const { data, error } = await supabase.from('providers').select('id, name').eq('active', true).order('name')
      if (error) throw error
      return data
    },
  })
}

export function useMovements(productId: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.movements(productId ?? ''),
    enabled: !!productId,
    queryFn: async (): Promise<StockMovement[]> => {
      const { data, error } = await supabase.from('stock_movements')
        .select('id, qty, reason, note, created_at')
        .eq('product_id', productId!).order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data
    },
  })
}

export type ProductInput = Omit<InventoryProduct, 'id' | 'stock' | 'updated_at' | 'image_path'> & { id?: string }

/** Crea o actualiza producto + costo. El stock NO se toca aquí (solo por movimientos). */
export function useSaveProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, cost, ...fields }: ProductInput) => {
      const row: Partial<typeof fields> = { ...fields, barcode: fields.barcode || null, brand: fields.brand || null, notes: fields.notes || null }
      if (!row.sku) delete row.sku   // nuevo sin SKU → la BD asigna NUE-0001, NUE-0002…
      const { data, error } = id
        ? await supabase.from('products').update(row).eq('id', id).select('id').single()
        : await supabase.from('products').insert(row).select('id').single()
      if (error) throw error
      if (cost != null) {
        const { error: e2 } = await supabase.from('product_costs')
          .upsert({ product_id: data.id, cost, updated_at: new Date().toISOString() })
        if (e2) throw e2
      }
      return data.id as string
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  })
}

/** Cambio parcial (precio, código, etc.) desde el celular. Con `cost` también actualiza product_costs. */
export function usePatchProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, cost, ...fields }: { id: string; cost?: number | null } & Partial<Omit<InventoryProduct, 'id' | 'cost'>>) => {
      if (Object.keys(fields).length) {
        const { error } = await supabase.from('products').update(fields).eq('id', id)
        if (error) throw error
      }
      if (cost != null) {
        const { error } = await supabase.from('product_costs').upsert({ product_id: id, cost, updated_at: new Date().toISOString() })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  })
}

export interface QuickProduct { name: string; price: number | null; barcode: string | null; category_id: number | null; unit: string }

/** Alta rápida: SKU automático y marcado "por revisar" para completar costo/categoría después. */
export async function quickCreateProduct(p: QuickProduct) {
  const { data, error } = await supabase.from('products')
    .insert({ ...p, active: p.price != null, needs_review: true })
    .select('id, sku, barcode, name, brand, category_id, unit, price, stock, min_stock, active, image_path')
    .single()
  if (error) throw error
  return data
}

export function useAdjustStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { productId: string; newStock: number; note: string }) => {
      const { error } = await supabase.rpc('adjust_stock',
        { p_product_id: a.productId, p_new_stock: a.newStock, p_note: a.note || 'Ajuste manual' })
      if (error) throw error
    },
    onSuccess: (_d, a) => {
      qc.invalidateQueries({ queryKey: inventoryKeys.products })
      qc.invalidateQueries({ queryKey: inventoryKeys.movements(a.productId) })
    },
  })
}

export function useBulkCount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { items: { product_id: string; counted: number }[]; note: string }) => {
      const { data, error } = await supabase.rpc('bulk_adjust_stock', { p_items: a.items, p_note: a.note || 'Conteo físico' })
      if (error) throw error
      return data as number
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  })
}

/** Mensaje legible para errores de Postgres/PostgREST comunes. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  if (msg.includes('products_sku_key')) return 'Ya existe un producto con ese SKU.'
  if (msg.includes('products_barcode_key')) return 'Ese código de barras ya está asignado a otro producto.'
  if (msg.includes('products_active_needs_price')) return 'Un producto activo necesita precio.'
  return msg
}
