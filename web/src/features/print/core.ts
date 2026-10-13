// Lógica de los trabajos de impresión y copia detectados por el agente, sin UI ni base de datos:
// qué productos ofrecer por trabajo y cómo repartir sus hojas. `adapter.ts` traduce `products` a esta forma.

export type Fuente = 'konica-copia' | 'pc-print'

/** Trabajo detectado por el agente local (collector-agent). */
export interface Job {
  id: string
  fuente: Fuente
  hojas: number          // hojas físicas (doble cara = 1 hoja por cada 2 páginas)
  color: boolean
  duplex?: boolean
  documento?: string
  impresora?: string
  timestamp?: string     // "YYYY-MM-DD HH:mm:ss" local (o ISO en trabajos viejos de la Konica)
}

/** Producto del catálogo visto por esta lógica. */
export interface ProductoImpresion {
  id: string
  nombre: string
  precio: number
  activo?: boolean
  origenes?: Fuente[]        // a qué trabajos se ofrece
  color?: boolean | null     // null = sirve para ambos
  duplex?: boolean
  palabrasClave?: string[]   // se buscan en el nombre del documento
}

/** Reparto de un trabajo: hojas (y precio opcional para esta venta) por producto. */
export type Reparto = Record<string, { qty: number; precio?: number }>

export const COPIA: Fuente = 'konica-copia'
export const PRINT: Fuente = 'pc-print'

export const normNombre = (s?: string | null) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function describirJob(j: Job) {
  const tipo = j.fuente === COPIA ? 'Copia' : 'Impresión'
  const modo = j.color ? 'Color' : 'B/N'
  return `${tipo} ${modo} · ${j.hojas} hoja${j.hojas !== 1 ? 's' : ''} · ${j.impresora || ''}`
}

// Los trabajos viejos de la Konica quedaron guardados como ISO en UTC ("...Z");
// los nuevos y los de PaperCut vienen en hora local "YYYY-MM-DD HH:mm:ss".
export function formatJobTimestamp(ts?: string) {
  if (!ts) return ''
  if (/(Z|[+-]\d\d:?\d\d)$/.test(ts)) {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  return ts
}

/**
 * Productos que se ofrecen para un trabajo, sugeridos primero.
 * Konica: los contadores B/N y color son exactos, se filtra por color.
 * PaperCut: el campo de escala de grises depende de la configuración del
 * driver (suele marcar color aunque el documento sea B/N), así que solo
 * ordena, no oculta productos.
 */
export function productosParaJob(job: Job, catalogo: ProductoImpresion[]) {
  const doc = normNombre(job.documento)
  const colorOk = (p: ProductoImpresion) => p.color == null || p.color === !!job.color
  const compat = catalogo.filter(p => p.activo !== false && (p.origenes || []).includes(job.fuente)
    && (job.fuente !== COPIA || colorOk(p)))
  const sugerido = (p: ProductoImpresion) =>
    !!((job.duplex && p.duplex === true) || (doc && (p.palabrasClave || []).some(k => doc.includes(normNombre(k)))))
  return compat.map(p => ({ p, sug: sugerido(p), col: colorOk(p) }))
    .sort((a, b) => (+b.sug - +a.sug) || (+b.col - +a.col) || a.p.nombre.localeCompare(b.p.nombre))
}

export const hojasAsignadas = (reparto: Reparto) => Object.values(reparto).reduce((s, x) => s + (x.qty || 0), 0)

export const precioEn = (reparto: Reparto, p: ProductoImpresion) => {
  const x = reparto[p.id]
  return x && Number.isFinite(x.precio) ? x.precio! : p.precio
}

/** Suma `delta` hojas a un producto sin pasar del total del trabajo; null si ya están todas asignadas. */
export function cambiarHojas(job: Job, reparto: Reparto, productoId: string, delta: number): Reparto | null {
  if (delta > 0 && hojasAsignadas(reparto) + delta > job.hojas) return null
  const x = reparto[productoId] || { qty: 0 }
  return { ...reparto, [productoId]: { ...x, qty: Math.max(0, (x.qty || 0) + delta) } }
}

/** Precio solo para esta venta; vacío o inválido vuelve al del catálogo. */
export function cambiarPrecio(reparto: Reparto, productoId: string, valor: string): Reparto {
  const x: Reparto[string] = { ...(reparto[productoId] || { qty: 0 }) }
  const v = Number(String(valor).replace(',', '.'))
  if (valor === '' || valor == null || !Number.isFinite(v) || v < 0) delete x.precio
  else x.precio = v
  return { ...reparto, [productoId]: x }
}

export function totalReparto(reparto: Reparto, catalogo: ProductoImpresion[]) {
  return catalogo.reduce((s, p) => {
    const x = reparto[p.id]
    return s + (x && x.qty ? x.qty * precioEn(reparto, p) : 0)
  }, 0)
}

/**
 * Convierte el reparto en líneas de venta y calcula las hojas que quedan pendientes.
 * `mismoPrecio` indica si la línea puede sumarse al producto del catálogo (precio sin cambiar).
 */
export function lineasDeReparto(job: Job, reparto: Reparto, catalogo: ProductoImpresion[]) {
  const lineas: { producto: ProductoImpresion; qty: number; precio: number; mismoPrecio: boolean }[] = []
  for (const [id, x] of Object.entries(reparto)) {
    if (!x.qty) continue
    const producto = catalogo.find(c => c.id === id)
    if (!producto) continue
    const precio = precioEn(reparto, producto)
    lineas.push({ producto, qty: x.qty, precio, mismoPrecio: precio === producto.precio })
  }
  const usadas = lineas.reduce((s, l) => s + l.qty, 0)
  return { lineas, usadas, resto: Math.max(0, job.hojas - usadas) }
}
