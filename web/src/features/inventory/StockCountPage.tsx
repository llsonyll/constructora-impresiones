import { useEffect, useMemo, useState } from 'react'
import { rankBy, withCode } from '@/lib/search'
import { useProductMatcher } from '@/hooks/use-product-search'
import { Search } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import CategoryOptions from './CategoryOptions'
import { friendlyError, useBulkCount, useCategories, useInventory } from './api'

const DRAFT_KEY = 'conteo-borrador'
const TIMES_KEY = 'conteo-borrador-horas'   // hora en que se contó cada producto (ver bulk_adjust_stock)

function load(key: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') } catch { return {} }
}

/** Conteo físico: se escribe lo contado; al guardar, cada diferencia queda como movimiento de ajuste. */
export default function StockCountPage() {
  const { data: products = [], isLoading } = useInventory()
  const { data: categories = [] } = useCategories()
  const bulk = useBulkCount()
  const [counts, setCounts] = useState<Record<string, string>>(() => load(DRAFT_KEY))
  const [times, setTimes] = useState<Record<string, string>>(() => load(TIMES_KEY))
  const [bulkError, setBulkError] = useState('')
  const [category, setCategory] = useState<number | ''>('')
  const [query, setQuery] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [note, setNote] = useState('Conteo inicial')
  const [done, setDone] = useState<number | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(counts))
      localStorage.setItem(TIMES_KEY, JSON.stringify(times))
    } catch { /* modo privado */ }
  }, [counts, times])

  const textScore = useProductMatcher(query)
  const rows = useMemo(() => {
    const list = products.filter(p => p.track_stock && (category === '' || p.category_id === category)
      && (!onlyPending || !(p.id in counts)))
    return query.trim() ? rankBy(list, withCode(query, textScore)) : list
  }, [products, category, query, onlyPending, counts, textScore])

  const entered = useMemo(() => Object.entries(counts)
    .map(([id, v]) => ({ id, v: Number(v.replace(',', '.')) }))
    .filter(x => x.v >= 0 && !Number.isNaN(x.v) && products.some(p => p.id === x.id)), [counts, products])

  const changes = entered.filter(x => products.find(p => p.id === x.id)!.stock !== x.v).length

  async function save() {
    if (!entered.length) return
    if (!confirm(`Se registrará el conteo de ${entered.length} productos (${changes} con diferencia). ¿Continuar?`)) return
    setBulkError('')
    try {
      const n = await bulk.mutateAsync({ items: entered.map(x => ({ product_id: x.id, counted: x.v, ...(times[x.id] ? { counted_at: times[x.id] } : {}) })), note })
      setDone(n); setCounts({}); setTimes({})
    } catch (e) { setBulkError(friendlyError(e)) }
  }

  return (
    <div className="space-y-3 p-4 pb-[calc(9rem+env(safe-area-inset-bottom))]">
      <PageHeader title="Conteo de stock" back="/inventario" backLabel="Inventario" />
      <p className="text-sm text-stone-600">
        Escribe la cantidad contada. Deja en blanco lo que no contaste (no se toca). El borrador se guarda en este navegador,
        con la hora de cada cantidad: si lo registras más tarde, las ventas hechas desde que contaste se respetan.
      </p>
      {done != null && <p className="rounded bg-green-50 p-2 text-sm text-green-800">Conteo guardado: {done} productos ajustados.</p>}

      <div className="sticky top-below-header z-[5] -mx-4 space-y-2 bg-stone-100 px-4 py-2">
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-stone-400"><Search className="size-5" /></span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar o escanear" aria-label="Buscar producto"
                 className="min-h-12 w-full rounded-lg border bg-white pl-10 pr-11 text-base [&::-webkit-search-cancel-button]:hidden" />
          {query && <button onClick={() => setQuery('')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-500" aria-label="Limpiar búsqueda">✕</button>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={category} onChange={e => setCategory(e.target.value ? Number(e.target.value) : '')} aria-label="Categoría"
                  className="min-h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm">
            <option value="">Todas las categorías</option>
            <CategoryOptions categories={categories} />
          </select>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border bg-white px-2 text-sm">
            <input type="checkbox" className="size-5 shrink-0" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} /> Solo sin contar
          </label>
        </div>
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      <ul className="divide-y rounded-lg bg-white shadow">
        {rows.map(p => {
          const v = counts[p.id] ?? ''
          const n = Number(v.replace(',', '.'))
          const diff = v !== '' && !Number.isNaN(n) ? n - p.stock : null
          return (
            <li key={p.id} className="flex items-center gap-3 p-2">
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium break-words">{p.name}</div>
                <div className="text-xs text-stone-500">{p.sku} · sistema: {p.stock} {p.unit}</div>
              </div>
              {diff != null && diff !== 0 && (
                <span className={`text-xs tabular-nums ${diff < 0 ? 'text-red-600' : 'text-green-700'}`}>{diff > 0 ? '+' : ''}{diff}</span>
              )}
              <input inputMode="decimal" value={v} placeholder="—" aria-label={`Contado ${p.name}`}
                     onChange={e => {
                       const v = e.target.value
                       setCounts(c => { const next = { ...c }; if (v === '') delete next[p.id]; else next[p.id] = v; return next })
                       // Se guarda la hora: al registrar, las ventas hechas después de contar se respetan.
                       setTimes(t => { const next = { ...t }; if (v === '') delete next[p.id]; else next[p.id] = new Date().toISOString(); return next })
                     }}
                     className="min-h-11 w-20 rounded border px-2 text-right text-base tabular-nums" />
            </li>
          )
        })}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-[1fr_auto] items-center gap-2 border-t bg-white px-safe-3 pt-2 pb-safe-3 shadow
                      md:flex">
        <span className="text-sm">{entered.length} contados · {changes} con diferencia</span>
        <button onClick={() => { if (confirm('¿Borrar todo lo ingresado?')) { setCounts({}); setTimes({}) } }} className="min-h-11 rounded-lg border px-3 text-sm md:order-last">Limpiar</button>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Motivo" className="min-h-11 min-w-0 rounded-lg border px-2 text-base md:flex-1" aria-label="Motivo" />
        <button onClick={save} disabled={!entered.length || bulk.isPending} className="min-h-11 rounded-lg bg-amber-700 px-4 text-sm text-white disabled:opacity-50">
          {bulk.isPending ? 'Guardando…' : 'Guardar conteo'}
        </button>
        {bulkError && <p className="w-full text-sm text-red-600">{bulkError}</p>}
      </div>
    </div>
  )
}
