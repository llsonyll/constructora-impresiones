// Etiquetas de precio para la tienda: lógica sin React (se prueba con `npm test`).

/** Disposición de la hoja A4: anchas (2 × 6, la de siempre) o angostas (3 × 6, de la misma altura). */
export type LabelFormat = 'ancha' | 'angosta'
export const FORMATS: Record<LabelFormat, { cols: number; rows: number; label: string; size: string; maxPres: number }> = {
  ancha: { cols: 2, rows: 6, label: '2 × 6', size: '97 × 47 mm', maxPres: 3 },
  angosta: { cols: 3, rows: 6, label: '3 × 6', size: '65 × 47 mm', maxPres: 2 },
}
export const perPage = (f: LabelFormat) => FORMATS[f].cols * FORMATS[f].rows

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

/** Repite cada producto según sus copias y reparte en hojas de `size` (12 o 18), en el orden de la lista. */
export function paginate<T>(items: { data: T; copies: number }[], size: number): T[][] {
  const flat = items.flatMap(i => Array<T>(Math.max(0, i.copies)).fill(i.data))
  const pages: T[][] = []
  for (let i = 0; i < flat.length; i += size) pages.push(flat.slice(i, i + size))
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
