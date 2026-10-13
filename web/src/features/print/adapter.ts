import type { ProductoImpresion } from './core'
import type { Product } from '@/types/domain'

/** `products` (columnas `job_*`) → la forma que usa la lógica de trabajos (core.ts). */
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
