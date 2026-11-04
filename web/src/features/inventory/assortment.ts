/**
 * Surtido: lee del nombre del producto su línea, su presentación (tamaño) y su color, para ver el stock de una
 * línea como tabla color × presentación ("ESMALTE CRONS": 1/32 · 1/16 · 1/8 · 1/4 GL por color).
 *
 * El catálogo no guarda esos datos aparte: se sacan del nombre ("ESMALTE CRONS 1/16 GL AZUL NAVAL" →
 * línea ESMALTE · CRONS, presentación 1/16 GL, color AZUL NAVAL). Si un producto sale mal agrupado, se corrige
 * su nombre en la ficha siguiendo el patrón de los demás (TIPO MARCA TAMAÑO COLOR).
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

// ---------- Análisis del nombre ----------

export interface Parsed {
  /** Clave de la línea: tipo + marca ("ESMALTE|CRONS"). */
  key: string
  /** Tipo de producto sin marca, tamaño ni color ("ESMALTE", "CINTA MASKING"). */
  line: string
  /** Marca de la línea: la que aparece en el nombre o, si no, la de la ficha. */
  brand: string
  size: Size | null
  color: string    // '' = sin color
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

  const size = findSize(name, brands)
  const rest = size ? `${name.slice(0, size.start)} | ${name.slice(size.end)}` : name   // '|' = corte donde estaba el tamaño
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
  let colorFrom = -1, colorTo = -1
  for (let i = 0; i < words.length; i++) {
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
  const color = colorFrom >= 0 ? words.slice(colorFrom, colorTo).join(' ') : ''

  // Línea: lo que queda, sin la marca ni las palabras de relleno.
  const lineWords = words.filter((w, i) => w && w !== '|' && !isPunct(w)
    && !(i >= colorFrom && i < colorTo) && !(brandAt && i >= brandAt[0] && i < brandAt[1]))
  const meaningful = lineWords.filter(w => !FILLER.has(w))
  const line = (meaningful.length ? meaningful : lineWords).join(' ') || color || name
  return { key: `${line}|${brand}`, line, brand, size, color }
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
  colors: string[]                  // filas ('' = sin color)
  cells: Map<string, P[]>           // `${color}\u0000${size.label}` → productos (más de uno = repetido)
  products: P[]
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
    const colors = [...new Set(items.map(it => it.parsed.color))]
      .sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    const { line, brand } = items[0].parsed
    lines.push({ key, line, brand, sizes, colors, cells, products: items.map(it => it.p) })
  }
  return lines.sort((a, b) => a.line.localeCompare(b.line) || a.brand.localeCompare(b.brand))
}

/** Stock en o bajo el mínimo (sin stock cuenta siempre). */
export const isLow = (p: AssortmentProduct) => p.track_stock && (p.stock <= 0 || p.stock <= p.min_stock)
