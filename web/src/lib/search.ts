/**
 * Búsqueda de productos que entiende cómo pide la gente:
 * - sin mayúsculas ni tildes ("tuberia" = "TUBERÍA") y con las palabras en cualquier orden ("amarra negra");
 * - por la raíz de cada palabra: "amarra", "amarre" y "amarras" buscan "amarr"; "cintillos", "cintill";
 * - con otros nombres del producto (products.aliases) y sinónimos compartidos (search_synonyms):
 *   "cintillo" también encuentra "AMARRA PLASTICA…".
 * Todo en el equipo (catálogo offline): no consulta al servidor.
 */

/** Grupo de palabras o frases equivalentes ("amarra", "cintillo", "cable tie"). */
export type SynonymGroup = string[]

/** Lo que se mira de un producto. `aliases`: "También se conoce como". */
export interface Searchable { name: string; brand?: string | null; sku?: string | null; aliases?: string[] | null }

/** Palabras que no aportan al buscar ("cinta de aislar" = "cinta aislar"). */
const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'para', 'por', 'con', 'y', 'en', 'a', 'al', 'x'])

/** Minúsculas, sin tildes ni signos. El punto y la barra quedan solo entre números (4.8, 1/2); "AUTOP." → "autop". */
export function normalize(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(\d)\.(?=\d)/g, '$1\u0001').replace(/(\d)\/(?=\d)/g, '$1\u0002')   // . y / entre números se quedan
    .replace(/[^a-z0-9\u0001\u0002]+/g, ' ')
    .replace(/\u0001/g, '.').replace(/\u0002/g, '/')
    .trim()
}

/** Raíz: sin la s del plural y, en palabras largas, sin la vocal final. Solo palabras de letras. */
export function stem(w: string) {
  if (!/^[a-z]+$/.test(w)) return w
  if (w.length >= 4 && w.endsWith('s')) w = w.slice(0, -1)        // focos → foco, interruptores → interruptore
  if (w.length >= 6 && /[aeo]$/.test(w)) w = w.slice(0, -1)       // amarra/amarre → amarr, interruptore → interruptor
  return w
}

const words = (s: string) => normalize(s).split(' ').filter(w => w && !STOP.has(w))

/** Índice de sinónimos: término (raíces) → grupos donde aparece. Se arma una vez por lista de grupos. */
export interface SynonymIndex { single: Map<string, number[]>; multi: { words: string[]; group: number }[]; groups: string[][][] }

export function buildSynonymIndex(groups: SynonymGroup[]): SynonymIndex {
  const single = new Map<string, number[]>()
  const multi: SynonymIndex['multi'] = []
  const compiled = groups.map((terms, g) => terms.map(t => words(t).map(stem)).filter(ws => {
    if (ws.length === 1) single.set(ws[0], [...(single.get(ws[0]) ?? []), g])
    else if (ws.length > 1) multi.push({ words: ws, group: g })
    return ws.length > 0
  }))
  multi.sort((a, b) => b.words.length - a.words.length)   // la frase más larga primero
  return { single, multi, groups: compiled }
}

const EMPTY_INDEX = buildSynonymIndex([])

/** Una parte de la búsqueda: lo que se escribió y sus equivalentes (cada uno, una lista de raíces). */
interface Unit { original: string[]; synonyms: string[][] }

function parse(query: string, index: SynonymIndex): Unit[] {
  const ws = words(query).map(stem)
  const units: Unit[] = []
  for (let i = 0; i < ws.length;) {
    const phrase = index.multi.find(m => m.words.every((w, k) => ws[i + k] === w))
    const original = phrase ? phrase.words : [ws[i]]
    const groups = phrase ? [phrase.group] : index.single.get(ws[i]) ?? []
    const key = original.join(' ')
    const synonyms = groups.flatMap(g => index.groups[g]).filter(t => t.join(' ') !== key)
    units.push({ original, synonyms })
    i += original.length
  }
  return units
}

// Texto normalizado de cada producto (se calcula una vez por objeto; el catálogo cambia de objetos al refrescarse).
const cache = new WeakMap<Searchable, { main: string; alias: string }>()
function haystack(p: Searchable) {
  let h = cache.get(p)
  if (!h) {
    h = { main: ` ${normalize([p.name, p.brand, p.sku].filter(Boolean).join(' '))}`, alias: ` ${normalize((p.aliases ?? []).join(' '))}` }
    cache.set(p, h)
  }
  return h
}

// Lo escrito se busca en cualquier parte (como antes: "flex" encuentra "SIKAFLEX").
const has = (text: string, ws: string[]) => ws.every(w => text.includes(w))
// Un sinónimo, como palabra entera (su raíz + plural o vocal: "amarr" → amarre, amarras); "toma" no entra en "tomatierra".
const ENDING = /^(s|es|a|e|o|as|os)?$/
function hasWord(text: string, w: string) {
  for (let i = text.indexOf(` ${w}`); i >= 0; i = text.indexOf(` ${w}`, i + 1)) {
    const end = text.indexOf(' ', i + 1)
    if (ENDING.test(text.slice(i + 1 + w.length, end < 0 ? undefined : end))) return true
  }
  return false
}
const hasWords = (text: string, ws: string[]) => ws.every(w => hasWord(text, w))

/**
 * Prepara la búsqueda y devuelve una función de puntaje: 0 = no coincide; más alto = mejor
 * (lo escrito en el nombre > en otro nombre del producto > por sinónimo). `null` si la búsqueda está vacía.
 */
export function productMatcher(query: string, index: SynonymIndex = EMPTY_INDEX): ((p: Searchable) => number) | null {
  const units = parse(query, index)
  if (!units.length) return null
  return p => {
    const { main, alias } = haystack(p)
    let score = 0
    for (const u of units) {
      const s = has(main, u.original) ? (hasWords(main, u.original) ? 4 : 3)
        : has(alias, u.original) ? 2
        : u.synonyms.some(t => hasWords(main, t) || hasWords(alias, t)) ? 1
        : 0
      if (!s) return 0
      score += s
    }
    return score
  }
}

/** Puntaje con el código de barras o el SKU exacto primero (escáner o tecleado) y, si no, el del texto. */
export function withCode(query: string, text: ((p: Searchable) => number) | null) {
  const q = query.trim().toLowerCase()
  return (p: Searchable & { barcode?: string | null }) =>
    q && (p.barcode === q || p.sku?.toLowerCase() === q) ? 100 : text?.(p) ?? 0
}

/** Filtra y ordena por puntaje (a igual puntaje, se respeta el orden de entrada: más usados, alfabético…). */
export function rankBy<T>(items: T[], score: (t: T) => number): T[] {
  return items.map((t, i) => ({ t, s: score(t), i })).filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.t)
}
