export type Role = 'admin' | 'cajero' | 'almacen'
export type PaymentMethod = 'efectivo' | 'yape' | 'plin' | 'tarjeta' | 'transferencia'
export type Shift = 'manana' | 'tarde'
/** Caja a la que pertenece una venta: ferretería o copias y librería (fotocopias, impresiones, librería). */
export type Caja = 'ferreteria' | 'copias'

export interface Category { id: number; name: string; caja: Caja }

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
  track_stock: boolean   // false = servicio (impresión, fotocopia): no descuenta stock
  job_sources: JobSource[]
  job_color: boolean | null
  job_duplex: boolean
  job_keywords: string[]
}

/** Origen de los trabajos que detecta el agente local (ver shared/print). */
export type JobSource = 'konica-copia' | 'pc-print'

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
  caja?: Caja             // opcional: ventas en cola de antes de las dos cajas (el servidor asume ferretería)
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
