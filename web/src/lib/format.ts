export const money = (n: number) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n)

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Turno según la hora local (mismo criterio que la app actual: corte configurable). */
export const CORTE_TARDE_HORA = 14
export const currentShift = (d = new Date()) => (d.getHours() < CORTE_TARDE_HORA ? 'manana' : 'tarde')

/** IGV Perú. Los precios del catálogo YA incluyen IGV: se desglosa, no se suma. */
export const IGV_RATE = 0.18
export function igvBreakdown(totalWithIgv: number) {
  const base = round2(totalWithIgv / (1 + IGV_RATE))
  return { base, igv: round2(totalWithIgv - base), total: round2(totalWithIgv) }
}
