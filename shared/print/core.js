// Lógica de impresiones y copias, sin backend ni DOM.
// La usan la app de impresiones (/index.html, Firebase) y el POS (web/, Supabase):
// cada una adapta sus productos a la forma `ProductoImpresion` y guarda las ventas a su manera.

/**
 * @typedef {'konica-copia' | 'pc-print'} Fuente
 *
 * Trabajo detectado por el agente local (collector-agent).
 * @typedef {object} Job
 * @property {string} id
 * @property {Fuente} fuente
 * @property {number} hojas        hojas físicas (doble cara = 1 hoja por cada 2 páginas)
 * @property {boolean} color
 * @property {boolean} [duplex]
 * @property {string} [documento]
 * @property {string} [impresora]
 * @property {string} [timestamp]   "YYYY-MM-DD HH:mm:ss" local (o ISO en trabajos viejos de la Konica)
 *
 * Producto del catálogo visto por esta lógica (cada backend mapea sus campos a esta forma).
 * @typedef {object} ProductoImpresion
 * @property {string} id
 * @property {string} nombre
 * @property {string} [categoria]
 * @property {number} precio
 * @property {boolean} [activo]
 * @property {Fuente[]} [origenes]        a qué trabajos se ofrece
 * @property {boolean | null} [color]     null = sirve para ambos
 * @property {boolean} [duplex]
 * @property {string[]} [palabrasClave]   se buscan en el nombre del documento
 *
 * Reparto de un trabajo: hojas (y precio opcional para esta venta) por producto.
 * @typedef {Record<string, { qty: number, precio?: number }>} Reparto
 */

export const COPIA = 'konica-copia'
export const PRINT = 'pc-print'

export const normNombre = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Configuración de los productos conocidos, por "categoría|nombre" normalizados. */
export const CONFIG_DEFECTO = {
  'fotocopia|simple':              { origenes: [COPIA], color: false },
  'fotocopia|duplex':              { origenes: [COPIA], color: false, duplex: true },
  'fotocopia|dni simple':          { origenes: [COPIA], color: false },
  'fotocopia|dni color':           { origenes: [COPIA], color: true },
  'fotocopia|dni ampliado b/n':    { origenes: [COPIA], color: false },
  'fotocopia|dni ampliado color':  { origenes: [COPIA], color: true },
  'impresion|simple - b/n':        { origenes: [PRINT], color: false },
  'impresion|doble cara':          { origenes: [PRINT], color: false, duplex: true },
  'impresion|color':               { origenes: [PRINT], color: true },
  'impresion|color(grande)':       { origenes: [PRINT], color: true },
  'impresion|record conductor':    { origenes: [PRINT], color: null, palabrasClave: ['record', 'conductor'] },
  'impresion|dni ampliado':        { origenes: [PRINT], color: false, palabrasClave: ['dni'] },
  'impresion|dni ampliado color':  { origenes: [PRINT], color: true, palabrasClave: ['dni'] },
}

/** @returns {Partial<ProductoImpresion> | undefined} */
export const configPorDefecto = (categoria, nombre) => CONFIG_DEFECTO[normNombre(categoria) + '|' + normNombre(nombre)]

export function describirJob(j) {
  const tipo = j.fuente === COPIA ? 'Copia' : 'Impresión'
  const modo = j.color ? 'Color' : 'B/N'
  return `${tipo} ${modo} · ${j.hojas} hoja${j.hojas !== 1 ? 's' : ''} · ${j.impresora || ''}`
}

// Los trabajos viejos de la Konica quedaron guardados como ISO en UTC ("...Z");
// los nuevos y los de PaperCut vienen en hora local "YYYY-MM-DD HH:mm:ss".
export function formatJobTimestamp(ts) {
  if (!ts) return ''
  if (/(Z|[+-]\d\d:?\d\d)$/.test(ts)) {
    const d = new Date(ts)
    if (isNaN(d)) return ts
    const p = n => String(n).padStart(2, '0')
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
 * @param {Job} job
 * @param {ProductoImpresion[]} catalogo
 * @returns {{ p: ProductoImpresion, sug: boolean, col: boolean }[]}
 */
export function productosParaJob(job, catalogo) {
  const doc = normNombre(job.documento)
  const colorOk = p => p.color == null || p.color === !!job.color
  const compat = catalogo.filter(p => p.activo !== false && (p.origenes || []).includes(job.fuente)
    && (job.fuente !== COPIA || colorOk(p)))
  const sugerido = p => !!((job.duplex && p.duplex === true) || (doc && (p.palabrasClave || []).some(k => doc.includes(normNombre(k)))))
  return compat.map(p => ({ p, sug: sugerido(p), col: colorOk(p) }))
    .sort((a, b) => (+b.sug - +a.sug) || (+b.col - +a.col) || a.p.nombre.localeCompare(b.p.nombre))
}

/** @param {Reparto} reparto */
export const hojasAsignadas = reparto => Object.values(reparto).reduce((s, x) => s + (x.qty || 0), 0)

export const precioEn = (reparto, p) => {
  const x = reparto[p.id]
  return x && Number.isFinite(x.precio) ? x.precio : p.precio
}

/**
 * Suma `delta` hojas a un producto sin pasar del total del trabajo.
 * @returns {Reparto | null} el reparto nuevo, o null si ya están todas las hojas asignadas.
 */
export function cambiarHojas(job, reparto, productoId, delta) {
  if (delta > 0 && hojasAsignadas(reparto) + delta > job.hojas) return null
  const x = reparto[productoId] || { qty: 0 }
  return { ...reparto, [productoId]: { ...x, qty: Math.max(0, (x.qty || 0) + delta) } }
}

/** Precio solo para esta venta; vacío o inválido vuelve al del catálogo. */
export function cambiarPrecio(reparto, productoId, valor) {
  const x = { ...(reparto[productoId] || { qty: 0 }) }
  const v = Number(String(valor).replace(',', '.'))
  if (valor === '' || valor == null || !Number.isFinite(v) || v < 0) delete x.precio
  else x.precio = v
  return { ...reparto, [productoId]: x }
}

export function totalReparto(reparto, catalogo) {
  return catalogo.reduce((s, p) => {
    const x = reparto[p.id]
    return s + (x && x.qty ? x.qty * precioEn(reparto, p) : 0)
  }, 0)
}

/**
 * Convierte el reparto en líneas de venta y calcula las hojas que quedan pendientes.
 * `mismoPrecio` indica si la línea puede sumarse al producto del catálogo (precio sin cambiar).
 * @returns {{ lineas: { producto: ProductoImpresion, qty: number, precio: number, mismoPrecio: boolean }[], usadas: number, resto: number }}
 */
export function lineasDeReparto(job, reparto, catalogo) {
  const lineas = []
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
