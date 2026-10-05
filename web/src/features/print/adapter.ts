import type { ProductoImpresion } from '@shared/print/core.js'
import type { Product } from '@/types/domain'

/**
 * Adaptador Supabase → shared/print: el POS guarda la configuración de trabajos en columnas
 * `job_*` de `products`; la app de impresiones (Firebase) usa los mismos campos en español.
 */
export const toProductoImpresion = (p: Product): ProductoImpresion => ({
  id: p.id,
  nombre: p.name,
  precio: p.price,
  activo: p.active,
  origenes: p.job_sources ?? [],
  color: p.job_color ?? null,
  duplex: p.job_duplex ?? false,
  palabrasClave: p.job_keywords ?? [],
})
