import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BarcodeScanner from '@/components/BarcodeScanner'
import { money } from '@/lib/format'
import { type InventoryProduct, useCategories, useInventory } from './api'
import CategoryOptions from './CategoryOptions'
import ProductEditor from './ProductEditor'

type Filter = 'todos' | 'sin_precio' | 'revisar' | 'stock_bajo' | 'inactivos' | 'recientes'

const DAY_MS = 24 * 60 * 60 * 1000
// Filas que se dibujan de una vez (el celular se pone lento con cientos); "Ver más" agrega otras tantas.
const PAGE = 60

const FILTERS: { id: Filter; label: string; test: (p: InventoryProduct) => boolean }[] = [
  { id: 'todos', label: 'Todos', test: () => true },
  { id: 'sin_precio', label: 'Sin precio', test: p => p.price == null },
  { id: 'revisar', label: 'Por revisar', test: p => p.needs_review },
  { id: 'stock_bajo', label: 'Stock bajo', test: p => p.active && p.track_stock && p.stock <= p.min_stock },
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
  const [scanning, setScanning] = useState(false)
  // Código escaneado que no está en el inventario: se abre el alta con el código ya puesto.
  const [newBarcode, setNewBarcode] = useState('')
  // Búsqueda sin resultados → "Crear «…»" abre el alta con ese nombre.
  const [newName, setNewName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [toast, setToast] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  /** Código escaneado o tecleado por un lector USB (Enter): abre el producto si existe; si no, ofrece crearlo. */
  function findByCode(raw: string) {
    const code = raw.trim()
    if (!code) return
    const hit = products.find(p => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())
    if (hit) {
      // Sin filtros, para que la fila quede visible detrás del editor.
      setQuery(code); setFilter('todos'); setCategory('')
      setEditingId(hit.id)
    } else {
      setNewBarcode(code); setNewName('')
      setEditingId('new')
      setNotice(`El código ${code} no está en el inventario: completa los datos para crearlo`)
    }
  }

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.id, products.filter(f.test).length])) as Record<Filter, number>,
    [products])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const test = FILTERS.find(f => f.id === filter)!.test
    const matches = (p: InventoryProduct) => (category === '' || p.category_id === category)
      && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
          || (p.brand?.toLowerCase().includes(q) ?? false) || (p.barcode?.includes(q) ?? false))
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

  function newProduct() { setNewBarcode(''); setNewName(''); setEditingId('new') }

  const catName = (id: number | null) => categories.find(c => c.id === id)?.name ?? '—'

  const [limit, setLimit] = useState(PAGE)
  useEffect(() => { setLimit(PAGE) }, [filter, category, query])
  const shown = rows.slice(0, limit)
  const filtersOn = (filter !== 'todos' ? 1 : 0) + (category !== '' ? 1 : 0)

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Inventario</h1>
        <Link to="/inventario/precios" className="flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm">📱 Precios</Link>
        <Link to="/inventario/conteo" className="flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm">Conteo</Link>
        <button onClick={newProduct} className="min-h-11 rounded-lg bg-amber-700 px-3 text-sm text-white max-md:hidden">+ Nuevo producto</button>
      </div>

      {/* Buscador fijo bajo la barra superior: siempre a mano al bajar por la lista. */}
      <div className="sticky top-[calc(2.75rem+env(safe-area-inset-top))] z-[5] -mx-3 space-y-2 bg-stone-100 px-3 py-2 md:mx-0 md:px-0">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-stone-400">🔍</span>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, marca o código"
                   onKeyDown={e => e.key === 'Enter' && findByCode(query)} enterKeyHint="search" aria-label="Buscar producto"
                   className="min-h-12 w-full rounded-lg border bg-white pl-10 pr-11 text-base [&::-webkit-search-cancel-button]:hidden" />
            {query && (
              <button onClick={() => setQuery('')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-500" aria-label="Limpiar búsqueda">✕</button>
            )}
          </div>
          <button onClick={() => setScanning(true)} className="grid min-h-12 w-12 shrink-0 place-items-center rounded-lg bg-amber-700 text-xl text-white" aria-label="Buscar por código de barras">📷</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label="Estado"
                  className={`min-h-11 w-full min-w-0 rounded-lg border px-2 text-sm ${filter !== 'todos' ? 'border-amber-700 bg-amber-50 font-medium text-amber-900' : 'bg-white'}`}>
            {FILTERS.map(f => <option key={f.id} value={f.id}>{f.label} ({counts[f.id] ?? 0})</option>)}
          </select>
          <select value={category} onChange={e => setCategory(e.target.value ? Number(e.target.value) : '')} aria-label="Categoría"
                  className={`min-h-11 w-full min-w-0 rounded-lg border px-2 text-sm ${category !== '' ? 'border-amber-700 bg-amber-50 font-medium text-amber-900' : 'bg-white'}`}>
            <option value="">Todas las categorías</option>
            <CategoryOptions categories={categories} />
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <span className="mr-auto">{rows.length} de {products.length} productos</span>
          {filtersOn > 0 && <button onClick={() => { setFilter('todos'); setCategory('') }} className="min-h-8 underline">Quitar filtros</button>}
        </div>
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">Error: {(error as Error).message}</p>}

      <ul className="divide-y overflow-hidden rounded-lg bg-white shadow">
        <li className="hidden gap-3 bg-stone-50 px-3 py-2 text-xs uppercase text-stone-500 md:grid md:grid-cols-[1fr_9rem_6rem_6rem_5rem_4rem]">
          <span>Producto</span><span>Categoría</span><span className="text-right">Stock</span><span className="text-right">Precio</span>
          <span className="text-right">Costo</span><span className="text-right">Margen</span>
        </li>
        {shown.map(p => {
          const m = margin(p)
          const saved = savedIds.includes(p.id)
          const low = p.track_stock && p.stock <= p.min_stock
          return (
            <li key={p.id}>
              <button onClick={() => setEditingId(p.id)}
                      className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2.5 text-left active:bg-amber-50 md:grid-cols-[1fr_9rem_6rem_6rem_5rem_4rem] md:hover:bg-amber-50
                                  ${saved ? 'bg-green-50' : ''}`}>
                <div className="min-w-0">
                  <div className="line-clamp-2 text-sm font-medium break-words">{p.name}</div>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-stone-500">
                    <span className="truncate">{p.sku}{p.brand && ` · ${p.brand}`}</span>
                    {saved && <span className="rounded bg-green-100 px-1 text-green-800">✓ guardado</span>}
                    {!p.active && <span className="rounded bg-stone-200 px-1">inactivo</span>}
                    {p.needs_review && <span className="rounded bg-yellow-100 px-1 text-yellow-800">revisar</span>}
                  </div>
                </div>
                <span className="truncate text-sm text-stone-600 max-md:hidden">{catName(p.category_id)}</span>
                {/* En el celular precio y stock van apilados a la derecha; en escritorio, en sus columnas. */}
                <div className="flex flex-col items-end md:contents">
                  <div className={`text-sm tabular-nums md:order-1 md:text-right ${p.track_stock ? (low ? 'text-red-600' : 'text-stone-500 md:text-stone-900') : 'text-stone-400'}`}>
                    {p.track_stock ? `${p.stock} ${p.unit}` : 'servicio'}
                  </div>
                  <div className="font-semibold tabular-nums max-md:-order-1 md:order-2 md:text-right md:font-normal">
                    {p.price != null ? money(p.price) : <span className="text-sm font-normal text-stone-400">sin precio</span>}
                  </div>
                  <div className="text-right tabular-nums max-md:hidden md:order-3">{p.cost != null ? money(p.cost) : '—'}</div>
                  <div className={`text-right tabular-nums max-md:hidden md:order-4 ${m != null && m < 0.15 ? 'text-red-600' : ''}`}>
                    {m != null ? `${Math.round(m * 100)}%` : '—'}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
        {!isLoading && !rows.length && (
          <li className="space-y-3 p-6 text-center text-sm text-stone-500">
            <p>Sin resultados{query.trim() && <> para «{query.trim()}»</>}.</p>
            {query.trim() && (
              <button onClick={() => { setNewName(query.trim()); setNewBarcode(''); setEditingId('new') }}
                      className="min-h-11 rounded-lg border border-dashed px-4 text-amber-800">+ Crear «{query.trim()}»</button>
            )}
          </li>
        )}
      </ul>
      {rows.length > limit && (
        <button onClick={() => setLimit(l => l + PAGE)} className="min-h-11 w-full rounded-lg border bg-white text-sm">
          Ver más ({rows.length - limit} restantes)
        </button>
      )}
      {savedIds.length > 0 && (
        <p className="text-xs text-stone-500">
          {savedIds.length} guardado{savedIds.length > 1 ? 's' : ''} en esta sesión arriba{' '}
          <button onClick={() => setSavedIds([])} className="py-3 underline">quitar resaltado</button>
        </p>
      )}

      {/* Botón flotante para agregar desde el celular (en escritorio está arriba). */}
      {!toast && !notice && (
        <button onClick={newProduct} aria-label="Nuevo producto"
                className="fixed right-4 bottom-safe-4 z-20 flex min-h-14 items-center gap-2 rounded-full bg-amber-700 px-5 text-white shadow-lg md:hidden">
          <span className="text-2xl leading-none">+</span><span className="text-sm font-medium">Nuevo</span>
        </button>
      )}

      {toast && (
        <div role="status" className="fixed bottom-safe-3 left-1/2 z-20 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg bg-stone-900 py-1 pl-4 pr-1 text-sm text-white shadow-lg">
          <span className="truncate">✓ Guardado: {toast.name}</span>
          <button onClick={() => { setEditingId(toast.id); setToast(null) }} className="min-h-11 shrink-0 px-3 font-medium text-amber-300">Abrir</button>
        </div>
      )}

      {notice && (
        // Abajo: arriba taparía el campo Nombre del alta que se acaba de abrir.
        <div role="status" className="pointer-events-none fixed inset-x-3 bottom-safe-3 z-[60] rounded-lg bg-amber-700 px-4 py-2 text-center text-sm text-white shadow-lg
                                      md:inset-x-auto md:left-1/2 md:max-w-md md:-translate-x-1/2">{notice}</div>
      )}

      {scanning && <BarcodeScanner title="Buscar producto" onClose={() => setScanning(false)}
                                   onDetected={c => { setScanning(false); findByCode(c) }} />}

      {editing && <ProductEditor product={editing === 'new' ? null : editing} key={`${editingId}-${newBarcode}-${newName}`}
                                 initialBarcode={editing === 'new' ? newBarcode : undefined}
                                 initialName={editing === 'new' ? newName : undefined}
                                 onClose={() => setEditingId(null)} onSaved={onSaved} />}
    </div>
  )
}
