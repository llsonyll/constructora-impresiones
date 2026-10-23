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
  locations?: string[]   // códigos de ubicación física, la principal primero (sin datos en cachés viejas)
  presentations?: Presentation[]  // venta por docena, ciento, bolsa… (sin datos en cachés viejas)
}

/** Presentación de venta: `qty` unidades base (products.unit) a `price`. Ej. Docena: 12 und a S/3.00. */
export interface Presentation { name: string; qty: number; price: number }

export type FurnitureType = 'estante' | 'vitrina' | 'mostrador'

/** Ubicación física: código MUEBLE[-CUERPO]-NIVEL[-SECCIÓN], calculado en la BD a partir de las partes. */
export interface Location {
  id: number
  code: string
  furniture: string        // E0, E1… (V vitrina, M mostrador)
  body: string | null      // cuerpo de un mueble compuesto
  level: number            // N1 = repisa más alta
  slot: string | null      // sección de izquierda a derecha
  furniture_type: FurnitureType
  description: string | null
  active: boolean
}

/** Origen de los trabajos que detecta el agente local (ver features/print). */
export type JobSource = 'konica-copia' | 'pc-print'

export interface CartLine {
  key: string                 // id local de la línea
  product_id: string | null   // null = ítem libre (impresión, servicio)
  description: string
  qty: number
  unit_price: number
  factor?: number             // unidades base por cada unidad de la línea (presentación: docena = 12); sin dato = 1
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
  quote_id?: string       // cotización que se cobra: se enlaza a la venta al sincronizar (link_quote_sale)
  items: Omit<CartLine, 'key'>[]
  total: number
  status: 'pending' | 'error'
  error?: string
  attempts: number
}
