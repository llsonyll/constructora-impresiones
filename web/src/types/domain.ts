export type Role = 'admin' | 'cajero' | 'almacen'
export type PaymentMethod = 'efectivo' | 'yape' | 'plin' | 'tarjeta' | 'transferencia'
export type Shift = 'manana' | 'tarde'

export interface Profile { id: string; full_name: string; role: Role; active: boolean }

export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  brand: string | null
  category_id: number | null
  unit: string
  price: number          // solo se sincronizan productos activos, que siempre tienen precio
  stock: number
  min_stock: number
  active: boolean
  image_path: string | null
}

export interface CartLine {
  key: string                 // id local de la línea
  product_id: string | null   // null = ítem libre (impresión, servicio)
  description: string
  qty: number
  unit_price: number
}

/** Venta pendiente de sincronizar. `id` se genera en el cliente => create_sale es idempotente. */
export interface PendingSale {
  id: string
  shift: Shift
  payment_method: PaymentMethod
  sold_at: string
  customer_name?: string
  customer_doc?: string
  note?: string
  items: Omit<CartLine, 'key'>[]
  total: number
  status: 'pending' | 'error'
  error?: string
  attempts: number
}
