import { useEffect, useMemo, useState } from 'react'
import CategoryOptions from './CategoryOptions'
import { Link } from 'react-router-dom'
import { friendlyError, useBulkCount, useCategories, useInventory } from './api'

const DRAFT_KEY = 'conteo-borrador'

function loadDraft(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') } catch { return {} }
}

/** Conteo físico: se escribe lo contado; al guardar, cada diferencia queda como movimiento de ajuste. */
export default function StockCountPage() {
  const { data: products = [], isLoading } = useInventory()
  const { data: categories = [] } = useCategories()
  const bulk = useBulkCount()
  const [counts, setCounts] = useState<Record<string, string>>(loadDraft)
  const [category, setCategory] = useState<number | ''>('')
  const [query, setQuery] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [note, setNote] = useState('Conteo inicial')
  const [done, setDone] = useState<number | null>(null)

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(counts)) } catch { /* modo privado */ }
  }, [counts])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(p => p.track_stock && (category === '' || p.category_id === category)
      && (!onlyPending || !(p.id in counts))
      && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode === q))
  }, [products, category, query, onlyPending, counts])

  const entered = useMemo(() => Object.entries(counts)
    .map(([id, v]) => ({ id, v: Number(v.replace(',', '.')) }))
    .filter(x => x.v >= 0 && !Number.isNaN(x.v) && products.some(p => p.id === x.id)), [counts, products])

  const changes = entered.filter(x => products.find(p => p.id === x.id)!.stock !== x.v).length

  async function save() {
    if (!entered.length) return
    if (!confirm(`Se registrará el conteo de ${entered.length} productos (${changes} con diferencia). ¿Continuar?`)) return
    try {
      const n = await bulk.mutateAsync({ items: entered.map(x => ({ product_id: x.id, counted: x.v })), note })
      setDone(n); setCounts({})
    } catch { /* abajo */ }
  }

  return (
    <div className="space-y-3 p-4 pb-[calc(9rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2">
        <Link to="/inventario" className="-ml-1 flex min-h-11 items-center px-1 text-sm text-amber-800">← Inventario</Link>
        <h1 className="text-lg font-semibold">Conteo de stock</h1>
      </div>
      <p className="text-sm text-stone-600">
        Escribe la cantidad contada. Deja en blanco lo que no contaste (no se toca). El borrador se guarda en este navegador.
      </p>
      {done != null && <p className="rounded bg-green-50 p-2 text-sm text-green-800">Conteo guardado: {done} productos ajustados.</p>}

      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar o escanear" className="min-h-11 min-w-0 flex-1 rounded border px-2 text-base" />
        <select value={category} onChange={e => setCategory(e.target.value ? Number(e.target.value) : '')} className="min-h-11 rounded border px-2 text-base">
          <option value="">Todas las categorías</option>
          <CategoryOptions categories={categories} />
        </select>
        <label className="flex min-h-11 items-center gap-2 px-1 text-sm">
          <input type="checkbox" className="size-5" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} /> Solo sin contar
        </label>
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
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-stone-500">{p.sku} · sistema: {p.stock} {p.unit}</div>
              </div>
              {diff != null && diff !== 0 && (
                <span className={`text-xs tabular-nums ${diff < 0 ? 'text-red-600' : 'text-green-700'}`}>{diff > 0 ? '+' : ''}{diff}</span>
              )}
              <input inputMode="decimal" value={v} placeholder="—" aria-label={`Contado ${p.name}`}
                     onChange={e => setCounts(c => {
                       const next = { ...c }
                       if (e.target.value === '') delete next[p.id]; else next[p.id] = e.target.value
                       return next
                     })}
                     className="min-h-11 w-20 rounded border px-2 text-right text-base tabular-nums" />
            </li>
          )
        })}
      </ul>

      <div className="fixed inset-x-0 bottom-0 flex flex-wrap items-center gap-2 border-t bg-white px-safe-3 pt-3 pb-safe-3 shadow">
        <span className="text-sm">{entered.length} contados · {changes} con diferencia</span>
        <input value={note} onChange={e => setNote(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded border px-2 text-base" aria-label="Motivo" />
        <button onClick={() => { if (confirm('¿Borrar todo lo ingresado?')) setCounts({}) }} className="min-h-11 rounded border px-3 text-sm">Limpiar</button>
        <button onClick={save} disabled={!entered.length || bulk.isPending} className="min-h-11 rounded bg-amber-700 px-4 text-sm text-white disabled:opacity-50">
          {bulk.isPending ? 'Guardando…' : 'Guardar conteo'}
        </button>
        {bulk.error && <p className="w-full text-sm text-red-600">{friendlyError(bulk.error)}</p>}
      </div>
    </div>
  )
}
