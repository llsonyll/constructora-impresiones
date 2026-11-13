/**
 * Surtido: lee del nombre del producto su línea, su presentación (tamaño) y su color, para ver el stock de una
 * línea como tabla color × presentación ("ESMALTE CRONS": 1/32 · 1/16 · 1/8 · 1/4 GL por color).
 *
 * El catálogo no guarda esos datos aparte: se sacan del nombre ("ESMALTE CRONS 1/16 GL AZUL NAVAL" →
 * línea ESMALTE · CRONS, presentación 1/16 GL, color AZUL NAVAL). Si un producto sale mal agrupado, se corrige
 * su nombre en la ficha siguiendo el patrón de los demás (TIPO MARCA TAMAÑO COLOR).
 *
 * Pernos, tornillos y tirafones son una tabla diámetro × largo: "PERNO HEXAGONAL ZINCADO PILLKO 3/8 X 2"" → línea
 * PERNO HEXAGONAL ZINCADO PILLKO, fila 3/8, columna 2". Patrón: TIPO ACABADO MARCA DIÁMETRO X LARGO.
 */

/** Sin tildes y en mayúsculas ("Marrón" → "MARRON"). */
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()

/** Palabras con que empieza un color. Lo que sigue (CLARO, NAVAL, BRILLANTE #16…) es parte del mismo color. */
const COLORS = new Set(`
  BLANCO BLANCA NEGRO NEGRA ROJO ROJA AZUL VERDE AMARILLO AMARILLA GRIS PLOMO MARRON CAFE NARANJA ANARANJADO
  ROSA ROSADO ROSADA CELESTE MORADO MORADA VIOLETA LILA FUCSIA CREMA MARFIL BEIGE HUESO BAYO CAOBA NOGAL ROBLE
  CEDRO GRANATE GUINDA VINO DORADO DORADA ORO PLATEADO PLATEADA PLATA ALUMINIO CROMO COBRE BRONCE TURQUESA OCRE
  PIZARRA CITRON TRANSPARENTE INCOLORO CRISTAL PERLA MOSTAZA LADRILLO TERRACOTA CHOCOLATE MELON DURAZNO SALMON
  CARAMELO ARENA MENTA OLIVA JADE BERMELLON CARMESI MAGENTA CIAN INDIGO PURPURA CATERPILLAR CUERO MADERA
  BLACK WHITE RED BLUE GREEN YELLOW GREY GRAY SILVER GOLD
`.trim().split(/\s+/))

// Palabras que no cuentan para agrupar líneas ("PINTURA SPRAY" = "SPRAY"; "CINTA DE AISLAR" = "CINTA AISLAR").
const FILLER = new Set(['DE', 'DEL', 'LA', 'EL', 'PARA', 'P/', 'CON', 'X', 'Y', 'EN', 'PINTURA', 'LUZ', '-', ','])

// ---------- Presentación (tamaño) ----------

const NUM = String.raw`(\d+(?:[ .-]\d+\/\d+)|\d+\/\d+|\d+(?:[.,]\d+)?)`
/** Unidades por familia; en la tabla se ordena por familia y luego por cantidad (en la unidad base de la familia). */
const UNITS: { re: RegExp; unit: string; family: number; factor: number }[] = [
  { re: /^(GALONES|GALON|GAL|GLS|GL)$/, unit: 'GL', family: 0, factor: 3785.41 },
  { re: /^(LITROS|LITRO|LTS|LT|L)$/, unit: 'LT', family: 0, factor: 1000 },
  { re: /^(ML|CC)$/, unit: 'ML', family: 0, factor: 1 },
  { re: /^(OZ|ONZ)$/, unit: 'OZ', family: 0, factor: 29.57 },
  { re: /^(KILOS|KILO|KGS|KG)$/, unit: 'KG', family: 1, factor: 1000 },
  { re: /^(GR|GRS|G)$/, unit: 'G', family: 1, factor: 1 },
  { re: /^W$/, unit: 'W', family: 2, factor: 1 },
  { re: /^(MTS|MT|M)$/, unit: 'M', family: 3, factor: 1000 },
  { re: /^CM$/, unit: 'CM', family: 3, factor: 10 },
  { re: /^MM$/, unit: 'MM', family: 3, factor: 1 },
]
const UNIT_WORDS = 'GALONES|GALON|GAL|GLS|GL|LITROS|LITRO|LTS|LT|L|ML|CC|OZ|ONZ|KILOS|KILO|KGS|KG|GRS|GR|G|W|MTS|MT|M|CM|MM'
const MEASURE = new RegExp(String.raw`(?<![\w/.,#])${NUM}\s?(${UNIT_WORDS})(?![A-Z0-9])`, 'g')
const INCHES = new RegExp(String.raw`(?<![\w/.,#])${NUM}\s?(?:"|”|''|PULG(?:ADAS?)?\b)`, 'g')
/** Fracción suelta sin unidad ("ESMALTE 1/8 CELESTE"): se completa con la unidad de la línea si la hay. */
const FRACTION = /(?<![\w/.,#])(\d+\/\d+)(?![\w/"”])/

/** "1 1/2", "1.1/2", "1-1/2" → 1.5; "0,5" → 0.5. */
function toNumber(s: string) {
  const mixed = s.match(/^(\d+)[ .-](\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = s.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  return Number(s.replace(',', '.'))
}
const tidyNum = (s: string) => s.replace(/^(\d+)[.-](\d+\/\d+)$/, '$1 $2').replace(',', '.')

export interface Size {
  label: string    // "1/4 GL", "400 ML", '2"'
  family: number   // para ordenar: volumen, peso, potencia, largo, pulgadas, sin unidad
  value: number    // cantidad en la unidad base de la familia
  unit: string     // '' = sin unidad
}

interface SizeHit extends Size { start: number; end: number }

function findSize(name: string, brands: Set<string>): SizeHit | null {
  const hits: SizeHit[] = []
  for (const m of name.matchAll(MEASURE)) {
    const u = UNITS.find(x => x.re.test(m[2]))!
    if (brands.has(m[0].replace(/\s/g, ''))) continue          // "3M" es marca, no 3 metros
    hits.push({ label: `${tidyNum(m[1])} ${u.unit}`, family: u.family, value: toNumber(m[1]) * u.factor, unit: u.unit, start: m.index!, end: m.index! + m[0].length })
  }
  if (hits.length) return hits.sort((a, b) => a.family - b.family || a.start - b.start)[0]
  const inch = name.matchAll(INCHES).next().value
  if (inch) return { label: `${tidyNum(inch[1])}"`, family: 4, value: toNumber(inch[1]), unit: '"', start: inch.index!, end: inch.index! + inch[0].length }
  // "GALON" o "LITRO" sin número: uno.
  const one = name.match(/(?<![\w/])(GALON|LITRO)(?![A-Z])/)
  if (one) {
    const u = UNITS.find(x => x.re.test(one[1]))!
    return { label: `1 ${u.unit}`, family: u.family, value: u.factor, unit: u.unit, start: one.index!, end: one.index! + one[0].length }
  }
  const frac = name.match(FRACTION)
  if (frac) return { label: frac[1], family: 5, value: toNumber(frac[1]), unit: '', start: frac.index!, end: frac.index! + frac[0].length }
  // Número suelto al final ("BROCHA KINTI 3"), que no sea un código (#16, N°10).
  const last = name.match(/(?<=\s)(\d+(?:[.,]\d+)?)$/)
  if (last) return { label: last[1], family: 5, value: toNumber(last[1]), unit: '', start: last.index!, end: name.length }
  return null
}

// ---------- Pernos, tornillos y tirafones: DIÁMETRO X LARGO ----------

/** Productos que se piden por diámetro y largo. Solo en estos se lee "3/8 X 2"" (no en "CABLE 2X1.5MM" ni "LIJA 9X11"). */
const FASTENER = /(?<![A-Z])(PERNOS?|TORNILLOS?|TIRAF[A-Z]*|AUTOP[A-Z]*|ESPARRAGOS?|STOVE|PIJAS?|REMACHES?|BULON[A-Z]*)(?![A-Z])/
/** Diámetro (3/8, M8, calibre 8) X largo (2", 1 1/2", 1.1/2", 50 MM). */
const DIAM_X_LONG = new RegExp(String.raw`(?<![\w/.,#])(M?\d+(?:\/\d+|[.,]\d+)?)\s?X\s?${NUM}\s?(MM|"|”|''|PULG(?:ADAS?)?\b)?(?![\w/])`)
/** "SIN TUERCA" / "CON TUERCA" no separa líneas: el perno de 1/4 sin tuerca va en la misma tabla que los demás. */
const NUT = /\s(SIN|CON|C\/|S\/)\s?TUERCAS?\b/g

interface Fastener { diameter: string; diameterValue: number; size: Size; start: number; end: number }

function findFastener(name: string): Fastener | null {
  if (!FASTENER.test(name)) return null
  const m = name.match(DIAM_X_LONG)
  if (!m) return null
  const d = m[1]
  // Para ordenar las filas, todo en pulgadas: M8 = 8 mm; calibre 8 = 0.060 + 0.013 × 8 (≈ 5/32").
  const diameterValue = d.startsWith('M') ? Number(d.slice(1).replace(',', '.')) / 25.4
    : d.includes('/') ? toNumber(d)
    : 0.06 + 0.013 * Number(d.replace(',', '.'))
  const len = toNumber(m[2])
  const size: Size = m[3] === 'MM'
    ? { label: `${tidyNum(m[2])} MM`, family: 3, value: len, unit: 'MM' }
    : { label: `${tidyNum(m[2])}"`, family: 4, value: len, unit: '"' }
  return { diameter: d.replace(',', '.'), diameterValue, size, start: m.index!, end: m.index! + m[0].length }
}

// ---------- Análisis del nombre ----------

export interface Parsed {
  /** Clave de la línea: tipo + marca ("ESMALTE|CRONS"). */
  key: string
  /** Tipo de producto sin marca, tamaño ni color ("ESMALTE", "CINTA MASKING"). */
  line: string
  /** Marca de la línea: la que aparece en el nombre o, si no, la de la ficha. */
  brand: string
  size: Size | null
  /** El tamaño tal como está escrito en el nombre ("1/4GL", "400ml"), para armar el nombre de otro tamaño. */
  sizeText: string
  color: string    // '' = sin color. En pernos y tornillos, el diámetro ("3/8", "M8", "8"): es la fila de la tabla.
  /** Pernos y tornillos: diámetro en pulgadas, para ordenar las filas de menor a mayor. */
  diameterValue?: number
  /** Pernos y tornillos: "DIÁMETRO X LARGO" tal como está escrito en el nombre ('3/8 X2"'), para armar otra medida. */
  measureText?: string
}

/** Marcas conocidas (de la ficha de cada producto), en mayúsculas sin tildes. */
export function brandSet(brands: (string | null)[]): Set<string> {
  return new Set(brands.filter((b): b is string => !!b?.trim()).map(b => plain(b.trim())))
}

const isPunct = (t: string) => /^[-–,.;:/()]+$/.test(t)
const clean = (t: string) => t.replace(/^[,(]+|[,;:)]+$/g, '')

export function parseName(rawName: string, rawBrand: string | null, brands: Set<string>): Parsed {
  const name = plain(rawName).replace(/\s+/g, ' ').trim()
  const own = rawBrand?.trim() ? plain(rawBrand.trim()) : ''

  const fastener = findFastener(name)
  const size = fastener ?? findSize(name, brands)
  let rest = size ? `${name.slice(0, size.start)} | ${name.slice(size.end)}` : name   // '|' = corte donde estaba el tamaño
  if (fastener) rest = rest.replace(NUT, ' ')
  const tokens = rest.split(' ').filter(Boolean)

  // Marca: una marca conocida escrita en el nombre (palabra o frase completa) o, si no, la de la ficha.
  const words = tokens.map(clean)
  let brand = ''
  let brandAt: [number, number] | null = null
  const candidates = [own, ...brands].filter(Boolean)
  for (const b of candidates) {
    const bw = b.split(' ')
    for (let i = 0; i + bw.length <= words.length; i++) {
      if (bw.every((w, k) => words[i + k] === w)) { brand = b; brandAt = [i, i + bw.length]; break }
    }
    if (brand) break
  }
  if (!brand) brand = own

  const isBrandWord = (i: number) => (brandAt && i >= brandAt[0] && i < brandAt[1]) || brands.has(words[i])

  // Color: desde la primera palabra de color hasta una marca, el tamaño, un guion o una coma.
  // En pernos y tornillos la fila es el diámetro, no un color.
  let colorFrom = -1, colorTo = -1
  for (let i = 0; i < words.length && !fastener; i++) {
    if (COLORS.has(words[i]) && !isBrandWord(i)) { colorFrom = i; break }
  }
  if (colorFrom >= 0) {
    colorTo = colorFrom + 1
    while (colorTo < words.length) {
      const t = tokens[colorTo], w = words[colorTo]
      if (t === '|' || isPunct(t) || w === 'X' || isBrandWord(colorTo) || /^\d/.test(w)) break
      colorTo++
      if (t.endsWith(',')) break
    }
  }
  const color = fastener ? fastener.diameter : colorFrom >= 0 ? words.slice(colorFrom, colorTo).join(' ') : ''

  // Línea: lo que queda, sin la marca ni las palabras de relleno.
  const lineWords = words.filter((w, i) => w && w !== '|' && !isPunct(w)
    && !(i >= colorFrom && i < colorTo) && !(brandAt && i >= brandAt[0] && i < brandAt[1]))
  const meaningful = lineWords.filter(w => !FILLER.has(w))
  const line = (meaningful.length ? meaningful : lineWords).join(' ') || color || name
  const sizeText = size ? name.slice(size.start, size.end) : ''
  const parsed: Parsed = { key: `${line}|${brand}`, line, brand, size: fastener?.size ?? (size as SizeHit | null), sizeText, color }
  if (fastener) { parsed.diameterValue = fastener.diameterValue; parsed.measureText = sizeText }
  return parsed
}

// ---------- Tablas por línea ----------

export interface AssortmentProduct {
  id: string
  name: string
  brand: string | null
  stock: number
  min_stock: number
  track_stock: boolean
}

export interface Line<P extends AssortmentProduct> {
  key: string
  line: string
  brand: string
  sizes: Size[]                     // columnas, de menor a mayor
  colors: string[]                  // filas ('' = sin color); en pernos y tornillos, los diámetros
  /** Qué son las filas: colores (pinturas, sprays…) o diámetros (pernos, tornillos, tirafones: diámetro × largo). */
  rows: 'color' | 'diametro'
  cells: Map<string, P[]>           // `${color}\u0000${size.label}` → productos (más de uno = repetido)
  products: P[]
  parsed: Map<string, Parsed>       // producto → lo leído de su nombre (con el tamaño ya unificado)
}

export const cellKey = (color: string, size: string) => `${color}\u0000${size}`
export const NO_SIZE = '—'

const sizeOrder = (a: Size, b: Size) => a.family - b.family || a.value - b.value || a.label.localeCompare(b.label)

/** Agrupa los productos por línea; cada línea, con sus presentaciones (columnas) y colores (filas). */
export function buildLines<P extends AssortmentProduct>(products: P[], brands: Set<string>): Line<P>[] {
  const groups = new Map<string, { parsed: Parsed; p: P }[]>()
  for (const p of products) {
    const parsed = parseName(p.name, p.brand, brands)
    const g = groups.get(parsed.key)
    if (g) g.push({ parsed, p }); else groups.set(parsed.key, [{ parsed, p }])
  }

  const lines: Line<P>[] = []
  for (const [key, items] of groups) {
    // Una fracción sin unidad ("1/8") toma la unidad de la línea si ese tamaño ya existe con unidad ("1/8 GL").
    const byLabel = new Map<string, Size>()
    for (const it of items) {
      const s = it.parsed.size
      if (s && !s.unit) {
        const match = items.map(x => x.parsed.size).find(x => x?.unit && x.label.startsWith(`${s.label} `))
        if (match) it.parsed.size = match
      }
      if (it.parsed.size) byLabel.set(it.parsed.size.label, it.parsed.size)
    }
    const sizes = [...byLabel.values()].sort(sizeOrder)
    if (items.some(it => !it.parsed.size)) sizes.push({ label: NO_SIZE, family: 9, value: 0, unit: '' })

    const cells = new Map<string, P[]>()
    for (const { parsed, p } of items) {
      const k = cellKey(parsed.color, parsed.size?.label ?? NO_SIZE)
      cells.set(k, [...(cells.get(k) ?? []), p])
    }
    const rows: Line<P>['rows'] = items.some(it => it.parsed.measureText) ? 'diametro' : 'color'
    const diameter = new Map(items.map(it => [it.parsed.color, it.parsed.diameterValue ?? Infinity]))
    const colors = [...new Set(items.map(it => it.parsed.color))]
      .sort(rows === 'diametro'
        ? (a, b) => diameter.get(a)! - diameter.get(b)! || a.localeCompare(b)       // 1/4 · 5/16 · 3/8 · 1/2
        : (a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    const { line, brand } = items[0].parsed
    lines.push({ key, line, brand, sizes, colors, rows, cells, products: items.map(it => it.p), parsed: new Map(items.map(it => [it.p.id, it.parsed])) })
  }
  return lines.sort((a, b) => a.line.localeCompare(b.line) || a.brand.localeCompare(b.brand))
}

/** Stock en o bajo el mínimo (sin stock cuenta siempre). */
export const isLow = (p: AssortmentProduct) => p.track_stock && (p.stock <= 0 || p.stock <= p.min_stock)

/** Reemplaza `find` por `put` en `text` solo si aparece una vez como palabra(s) completa(s). */
function replaceOnce(text: string, find: string, put: string): string | null {
  if (!find) return null
  const esc = find.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const re = new RegExp(`(^|\\s)${esc}(?=\\s|$)`, 'g')
  const hits = [...text.matchAll(re)]
  if (hits.length !== 1) return null
  return text.replace(re, (_m, pre: string) => `${pre}${put}`).replace(/\s+/g, ' ').trim()
}

/**
 * Nombre para un producto que falta en la tabla (ese color en ese tamaño), copiando cómo están escritos los de la
 * línea: otro color del mismo tamaño con el color cambiado ("ESMALTE CRONS 1/4 GL BLANCO" → "… AMARILLO LIMON"), o el
 * mismo color en otro tamaño con el tamaño cambiado. Si no hay de dónde copiar: TIPO MARCA TAMAÑO COLOR.
 * En pernos y tornillos, otra medida con "DIÁMETRO X LARGO" cambiado ("PERNO … 3/8 X 1"" → "PERNO … 1/2 X 2 1/2"").
 */
export function suggestName<P extends AssortmentProduct>(line: Line<P>, color: string, sizeLabel: string): { name: string; template: P | null } {
  const size = sizeLabel === NO_SIZE ? '' : sizeLabel
  const entries = line.products.map(p => ({ p, x: line.parsed.get(p.id)!, name: plain(p.name).replace(/\s+/g, ' ').trim() }))
  if (line.rows === 'diametro') {
    const measure = [color, size].filter(Boolean).join(' X ')
    // Primero uno del mismo diámetro (copia "SIN TUERCA" y demás), luego cualquiera.
    const sorted = [...entries].sort((a, b) => Number(b.x.color === color) - Number(a.x.color === color))
    for (const { p, x, name } of sorted) {
      const out = x.measureText && measure ? replaceOnce(name, x.measureText, measure) : null
      if (out) return { name: out, template: p }
    }
    const brand = line.brand && !line.line.split(' ').includes(line.brand) ? line.brand : ''
    return { name: [line.line, brand, measure].filter(Boolean).join(' '), template: null }
  }
  // Otro color, mismo tamaño.
  for (const { p, x, name } of entries) {
    if ((x.size?.label ?? NO_SIZE) !== sizeLabel || !x.color || !color) continue
    const out = replaceOnce(name, x.color, color)
    if (out) return { name: out, template: p }
  }
  // Mismo color, otro tamaño.
  for (const { p, x, name } of entries) {
    if (x.color !== color || !x.sizeText || !size) continue
    const out = replaceOnce(name, x.sizeText, size)
    if (out) return { name: out, template: p }
  }
  const brand = line.brand && !line.line.split(' ').includes(line.brand) ? line.brand : ''
  return { name: [line.line, brand, size, color].filter(Boolean).join(' '), template: null }
}
