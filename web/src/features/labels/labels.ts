// Etiquetas de precio para la tienda: lógica sin React (se prueba con `npm test`).

/** Disposición de la hoja A4: siempre 12 etiquetas, anchas (2 × 6) o casi cuadradas (3 × 4). */
export type LabelFormat = 'ancha' | 'cuadrada'
export const FORMATS: Record<LabelFormat, { cols: number; rows: number; label: string; size: string }> = {
  ancha: { cols: 2, rows: 6, label: '2 × 6', size: '97 × 47 mm' },
  cuadrada: { cols: 3, rows: 4, label: '3 × 4', size: '65 × 70 mm' },
}
export const PER_PAGE = 12

/** Datos que se imprimen en una etiqueta (sin costos ni stock: la ve el cliente). */
export interface LabelData {
  id: string
  name: string
  brand: string | null
  sku: string
  unit: string
  price: number | null
  presentations: { name: string; qty: number; price: number }[]
}

/** Repite cada producto según sus copias y reparte en hojas de 12, en el orden de la lista. */
export function paginate<T>(items: { data: T; copies: number }[], perPage = PER_PAGE): T[][] {
  const flat = items.flatMap(i => Array<T>(Math.max(0, i.copies)).fill(i.data))
  const pages: T[][] = []
  for (let i = 0; i < flat.length; i += perPage) pages.push(flat.slice(i, i + perPage))
  return pages
}

const UNIT_TEXT: Record<string, string> = {
  und: 'c/u', hoja: 'la hoja', m: 'el metro', kg: 'el kilo', par: 'el par', juego: 'el juego',
  paquete: 'el paquete', bolsa: 'la bolsa', caja: 'la caja', rollo: 'el rollo', galón: 'el galón', litro: 'el litro',
}
/** Lo que va junto al precio: "c/u", "el metro", "el kilo"… */
export const unitText = (unit: string) => UNIT_TEXT[unit.trim().toLowerCase()] ?? `x ${unit.trim()}`

const AMOUNT = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Monto sin el "S/" (va aparte, más chico): 12.5 → "12.50", 1250 → "1,250.00". */
export const amount = (n: number) => AMOUNT.format(n)

/** Cuánto achicar el nombre para que entre: 0 = normal, 1 = largo, 2 = muy largo. */
export const nameTier = (name: string): 0 | 1 | 2 => (name.length > 90 ? 2 : name.length > 55 ? 1 : 0)

/** La marca solo se agrega si el nombre no la dice ya ("ESMALTE CPP…" con marca CPP no la repite). */
export function brandLine(name: string, brand: string | null) {
  const b = brand?.trim()
  if (!b) return null
  const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  return plain(name).includes(plain(b)) ? null : b
}

/** Presentación como se lee en la etiqueta: "Docena (12)", "Bolsa (5 kg)". */
export function presentationText(p: { name: string; qty: number }, unit: string) {
  const qty = String(Number(p.qty.toFixed(3)))
  return `${p.name} (${unit === 'und' ? qty : `${qty} ${unit}`})`
}
