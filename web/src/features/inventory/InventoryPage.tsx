import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { money } from '@/lib/format'
import { type InventoryProduct, useCategories, useInventory } from './api'
import ProductEditor from './ProductEditor'

type Filter = 'todos' | 'sin_precio' | 'revisar' | 'stock_bajo' | 'inactivos' | 'recientes'

const DAY_MS = 24 * 60 * 60 * 1000

const FILTERS: { id: Filter; label: string; test: (p: InventoryProduct) => boolean }[] = [
  { id: 'todos', label: 'Todos', test: () => true },
  { id: 'sin_precio', label: 'Sin precio', test: p => p.price == null },
  { id: 'revisar', label: 'Por revisar', test: p => p.needs_review },
  { id: 'stock_bajo', label: 'Stock bajo', test: p => p.active && p.stock <= p.min_stock },
  { id: 'inactivos', label: 'Inactivos', test: p => !p.active },
  // Incluye cambios de stock por ventas/ajustes, no solo ediciones.
  { id: 'recientes', label: 'Recientes (24 h)', test: p => Date.now() - Date.parse(p.updated_at) < DAY_MS },
]

export const margin = (p: Pick<InventoryProduct, 'price' | 'cost'>) =>
  p.price && p.cost != null ? (p.price - p.cost) / p.price : null

export default function InventoryPage() {
  const { data: products = [], isLoading, error } = useInventory()
  const { data: categories = [] } = useCategories()
  const [filter, setFilter] = useState<Filter>('todos')
  const [category, setCategory] = useState<number | ''>('')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  // Se busca en los datos de la query para que el editor vea el stock actualizado tras un ajuste.
  const editing = editingId === 'new' ? 'new' : products.find(p => p.id === editingId) ?? null
  // Productos guardados en esta sesión: se quedan arriba y resaltados aunque ya no cumplan el filtro
  // (p. ej. al ponerle precio a uno de "Sin precio"), para no perderlos de vista.
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [toast, setToast] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.id, products.filter(f.test).length])) as Record<Filter, number>,
    [products])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const test = FILTERS.find(f => f.id === filter)!.test
    const matches = (p: InventoryProduct) => (category === '' || p.category_id === category)
      && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
          || (p.brand?.toLowerCase().includes(q) ?? false) || p.barcode === q)
    const pinned = savedIds.map(id => products.find(p => p.id === id)).filter((p): p is InventoryProduct => !!p && matches(p))
    const rest = products.filter(p => !savedIds.includes(p.id) && test(p) && matches(p))
    if (filter === 'recientes') rest.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return [...pinned, ...rest]
  }, [products, filter, category, query, savedIds])

  function onSaved(id: string, name: string) {
    setSavedIds(ids => [id, ...ids.filter(x => x !== id)])
    setToast({ id, name })
    setEditingId(null)
  }

  const catName = (id: number | null) => categories.find(c => c.id === id)?.name ?? '—'

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Inventario</h1>
        <Link to="/inventario/precios" className="rounded border bg-white px-3 py-1.5 text-sm">📱 Poner precios</Link>
        <Link to="/inventario/conteo" className="rounded border bg-white px-3 py-1.5 text-sm">Conteo de stock</Link>
        <button onClick={() => setEditingId('new')} className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white">+ Nuevo producto</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${filter === f.id ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`}>
            {f.label} <span className="opacity-70">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nombre, marca, SKU o código"
               className="min-w-0 flex-1 rounded border p-2" />
        <select value={category} onChange={e => setCategory(e.target.value ? Number(e.target.value) : '')} className="rounded border p-2">
          <option value="">Todas las categorías</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">Error: {(error as Error).message}</p>}

      <div className="overflow-x-auto rounded-lg bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="p-2">Producto</th>
              <th className="p-2 max-md:hidden">Categoría</th>
              <th className="p-2 text-right">Stock</th>
              <th className="p-2 text-right">Precio</th>
              <th className="p-2 text-right max-sm:hidden">Costo</th>
              <th className="p-2 text-right max-sm:hidden">Margen</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(p => {
              const m = margin(p)
              const saved = savedIds.includes(p.id)
              return (
                <tr key={p.id} onClick={() => setEditingId(p.id)}
                    className={`cursor-pointer hover:bg-amber-50 ${saved ? 'bg-green-50' : ''}`}>
                  <td className="p-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-stone-500">
                      {p.sku}{p.brand && ` · ${p.brand}`}
                      {saved && <span className="ml-2 rounded bg-green-100 px-1 text-green-800">✓ guardado</span>}
                      {!p.active && <span className="ml-2 rounded bg-stone-200 px-1">inactivo</span>}
                      {p.needs_review && <span className="ml-2 rounded bg-yellow-100 px-1 text-yellow-800">revisar</span>}
                    </div>
                  </td>
                  <td className="p-2 max-md:hidden">{catName(p.category_id)}</td>
                  <td className={`p-2 text-right tabular-nums ${p.stock <= p.min_stock ? 'text-red-600' : ''}`}>{p.stock} {p.unit}</td>
                  <td className="p-2 text-right tabular-nums">{p.price != null ? money(p.price) : <span className="text-stone-400">—</span>}</td>
                  <td className="p-2 text-right tabular-nums max-sm:hidden">{p.cost != null ? money(p.cost) : '—'}</td>
                  <td className={`p-2 text-right tabular-nums max-sm:hidden ${m != null && m < 0.15 ? 'text-red-600' : ''}`}>
                    {m != null ? `${Math.round(m * 100)}%` : '—'}
                  </td>
                </tr>
              )
            })}
            {!isLoading && !rows.length && <tr><td colSpan={6} className="p-6 text-center text-stone-500">Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        {rows.length} de {products.length} productos
        {savedIds.length > 0 && <>
          {' · '}{savedIds.length} guardado{savedIds.length > 1 ? 's' : ''} en esta sesión arriba{' '}
          <button onClick={() => setSavedIds([])} className="underline">quitar resaltado</button>
        </>}
      </p>

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-20 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
          <span className="truncate">✓ Guardado: {toast.name}</span>
          <button onClick={() => { setEditingId(toast.id); setToast(null) }} className="shrink-0 font-medium text-amber-300">Abrir</button>
        </div>
      )}

      {editing && <ProductEditor product={editing === 'new' ? null : editing} key={editingId ?? ''}
                                 onClose={() => setEditingId(null)} onSaved={onSaved} />}
    </div>
  )
}
