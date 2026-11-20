/**
 * Botones de filtro (chips) y pestañas: un solo lugar para sus colores, con respuesta al pasar el mouse y al tocar.
 *
 * - `hover:` solo se aplica en pantallas con mouse (Tailwind 4 lo envuelve en `@media (hover: hover)`), así que
 *   en el celular no queda "pegado" tras un toque.
 * - `active:` es la respuesta al toque: en el celular y la tablet es la única señal de que el toque se registró
 *   (el resaltado nativo está apagado en index.css).
 * - El elegido no cambia con el hover, para que no se confunda cuál está activo; solo se oscurece al presionarlo.
 *
 * Las clases van escritas completas (nada de `bg-${color}`) para que Tailwind las encuentre.
 */
const TONE = {
  amber: {
    on: 'border-amber-700 bg-amber-700 text-white active:bg-amber-800',
    off: 'bg-white hover:border-amber-600 hover:bg-amber-50 active:bg-amber-100',
  },
  sky: {
    on: 'border-sky-700 bg-sky-700 text-white active:bg-sky-800',
    off: 'bg-white hover:border-sky-600 hover:bg-sky-50 active:bg-sky-100',
  },
} as const

export type ChipTone = keyof typeof TONE

/** Solo los colores del chip (elegido o no), para botones con otra forma. */
export const chipColors = (on: boolean, tone: ChipTone = 'amber') => TONE[tone][on ? 'on' : 'off']

/** Chip de filtro en forma de píldora. */
export const chip = (on: boolean, tone: ChipTone = 'amber') => `min-h-11 rounded-full border px-4 text-sm ${chipColors(on, tone)}`

/** Desplegable con forma de chip, junto a los chips de filtro. */
export const chipSelect = 'min-h-11 rounded-full border bg-white px-3 text-sm hover:border-amber-600 hover:bg-amber-50'

/** Pestaña segmentada no elegida, sobre el fondo gris del grupo (`bg-stone-200`): se aclara al pasar el mouse. */
export const segmentIdle = 'text-stone-600 hover:bg-white/60 hover:text-stone-900 active:bg-white'

/** Chip o botón neutro (blanco, sin color de marca): sugerencias, opciones sin elegir. */
export const neutralIdle = 'bg-white hover:bg-stone-50 active:bg-stone-100'
