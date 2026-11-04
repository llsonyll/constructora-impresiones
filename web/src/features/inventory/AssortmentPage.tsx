import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Search, ShoppingCart, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import PageHeader from '@/components/PageHeader'
import { rankBy } from '@/lib/search'
import { useProductMatcher } from '@/hooks/use-product-search'
import { type InventoryProduct, useCategories, useInventory } from './api'
import { brandSet, buildLines, cellKey, isLow, type Line, NO_SIZE, suggestName } from './assortment'
import CategoryOptions from './CategoryOptions'
import QuickCreateSheet from './QuickCreateSheet'

const ORDER_KEY = 'surtido-pedido'
type Order = Record<string, number>   // producto → cantidad a pedir

function loadOrder(): Order {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) ?? '{}') } catch { return {} }
}

/** Cantidad que se propone pedir: hasta el mínimo, o una si no tiene mínimo. */
const suggestQty = (p: InventoryProduct) => Math.max(Math.ceil(p.min_stock - Math.max(p.stock, 0)), 1)

const fmt = (n: number) => String(Number(n.toFixed(3)))
const brandLabel = (b: string) => b || 'Sin marca'

/** El valor más repetido (sin contar vacíos); null si no hay ninguno. */
function mostCommon<T>(values: (T | null | undefined)[]): T | null {
  const count = new Map<T, number>()
  for (const v of values) if (v != null && v !== '') count.set(v, (count.get(v) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Casilla vacía que se va a crear: ese color en ese tamaño de la línea. */
interface Missing { line: Line<InventoryProduct>; color: string; size: string }

/**
 * Surtido: el stock de una línea (ESMALTE · CRONS, SPRAY · CA…) como tabla color × presentación, para ver de un
 * vistazo qué colores faltan en cada tamaño y armar el pedido tocando las casillas.
 */
export default function AssortmentPage() {
  const { data: products = [], isLoading, error } = useInventory()
  const { data: categories = [] } = useCategories()
  const navigate = useNavigate()

  // Filtros en la dirección: al volver de la orden o de la ficha, la pantalla queda igual.
  const [params, setParams] = useSearchParams()
  const category = params.get('categoria') ?? ''     // id, 'sin' (sin categoría) o '' (todas)
  const brand = params.get('marca')                  // null = sin elegir; '' = sin marca
  const size = params.get('tam') ?? ''
  const onlyLow = params.get('bajos') === '1'
  const withInactive = params.get('inactivos') === '1'
  const [query, setQuery] = useState(params.get('q') ?? '')
  function setParam(key: string, value: string | null) {
    setParams(p => {
      const next = new URLSearchParams(p)
      if (value == null || value === '' && key !== 'marca') next.delete(key); else next.set(key, value)
      if (key === 'categoria' || key === 'marca') next.delete('tam')
      return next
    }, { replace: true })
  }
  useEffect(() => {
    const t = setTimeout(() => setParam('q', query.trim() || null), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const [order, setOrder] = useState<Order>(loadOrder)
  useEffect(() => {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)) } catch { /* modo privado */ }
  }, [order])
  const [creating, setCreating] = useState<Missing | null>(null)

  const brands = useMemo(() => brandSet(products.map(p => p.brand)), [products])
  const textScore = useProductMatcher(query)

  // Productos con stock (no servicios) de la categoría elegida, y la búsqueda.
  const pool = useMemo(() => {
    // Los inactivos que están en el pedido se ven igual (p. ej. el recién creado sin precio desde una casilla vacía).
    const list = products.filter(p => p.track_stock && (withInactive || p.active || p.id in order)
      && (category === '' || (category === 'sin' ? p.category_id == null : p.category_id === Number(category))))
    return textScore ? rankBy(list, textScore) : list
  }, [products, category, withInactive, textScore, order])

  const allLines = useMemo(() => buildLines(pool, brands), [pool, brands])

  // Marcas de lo que hay, con cuántos productos y cuántos están bajos.
  const brandStats = useMemo(() => {
    const m = new Map<string, { n: number; low: number }>()
    for (const l of allLines) {
      const s = m.get(l.brand) ?? { n: 0, low: 0 }
      s.n += l.products.length; s.low += l.products.filter(isLow).length
      m.set(l.brand, s)
    }
    return [...m].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
  }, [allLines])

  const picking = brand == null && !query.trim()
  const brandLines = useMemo(() => (brand == null ? allLines : allLines.filter(l => l.brand === brand)), [allLines, brand])

  // Presentaciones de lo elegido (para filtrar por tamaño).
  const sizeOptions = useMemo(() => {
    const m = new Map<string, Line<InventoryProduct>['sizes'][number]>()
    for (const l of brandLines) for (const s of l.sizes) if (!m.has(s.label)) m.set(s.label, s)
    return [...m.values()].sort((a, b) => a.family - b.family || a.value - b.value)
  }, [brandLines])

  /** Cada línea con las columnas y filas que se ven (según tamaño y "solo bajos"). */
  const lines = useMemo(() => brandLines.map(l => {
    const sizes = size ? l.sizes.filter(s => s.label === size) : l.sizes
    const colors = l.colors.filter(c => sizes.some(s => {
      const ps = l.cells.get(cellKey(c, s.label))
      return ps && (!onlyLow || ps.some(isLow))
    }))
    return { ...l, sizes, colors }
  }).filter(l => l.sizes.length && l.colors.length), [brandLines, size, onlyLow])

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const selected = Object.keys(order).filter(id => byId.has(id))

  /** +1 o −1 a la cantidad a pedir de una casilla (si está repetida, al primero; quita del último que tenga). */
  function bump(ps: InventoryProduct[], delta: 1 | -1) {
    setOrder(o => {
      const next = { ...o }
      if (delta > 0) { next[ps[0].id] = (next[ps[0].id] ?? 0) + 1; return next }
      const p = [...ps].reverse().find(x => (next[x.id] ?? 0) > 0)
      if (!p) return o
      if (next[p.id] > 1) next[p.id] -= 1; else delete next[p.id]
      return next
    })
  }

  function markLow(l: (typeof lines)[number]) {
    const low = l.colors.flatMap(c => l.sizes.flatMap(s => l.cells.get(cellKey(c, s.label)) ?? [])).filter(isLow)
    if (!low.length) return toast('Nada agotado ni bajo el mínimo en esta línea')
    setOrder(o => {
      const next = { ...o }
      for (const p of low) if (!(p.id in next)) next[p.id] = suggestQty(p)
      return next
    })
    toast.success(`${low.length} producto${low.length > 1 ? 's' : ''} al pedido`)
  }

  const units = selected.reduce((n, id) => n + order[id], 0)

  function orderText() {
    return selected.map(id => byId.get(id)!).sort((a, b) => a.name.localeCompare(b.name))
      .map(p => `- ${fmt(order[p.id])} ${p.unit} ${p.name}`).join('\n')
  }

  async function copyOrder() {
    try { await navigator.clipboard.writeText(orderText()); toast.success('Lista copiada') }
    catch { toast.error('No se pudo copiar') }
  }

  function makeOrder() {
    const items = selected.map(id => ({ product_id: id, qty: order[id] }))
    // Si todos los productos son del mismo proveedor, la orden ya lo trae elegido.
    const providers = new Set(selected.map(id => byId.get(id)!.provider_id))
    const provider = providers.size === 1 ? [...providers][0] : null
    // Se vacía antes de salir: al desmontarse la pantalla, el efecto que guarda la selección ya no corre.
    try { localStorage.removeItem(ORDER_KEY) } catch { /* modo privado */ }
    setOrder({})
    navigate(`/proveedores/ordenes/nueva${provider ? `?proveedor=${provider}` : ''}`, { state: { prefill: items } })
  }

  const lowCount = (ls: typeof lines) => ls.reduce((n, l) => n + l.products.filter(isLow).length, 0)

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 pb-[calc(9rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title="Surtido" back="/inventario" backLabel="Inventario" />
      <p className="text-sm text-stone-600">
        Stock por color y presentación. <b>Toca</b> una casilla para pedir 1 más y <b>mantén presionado</b> para quitar 1.
      </p>

      <div className="sticky top-below-header z-[5] -mx-3 space-y-2 bg-stone-100 px-3 py-2 md:mx-0 md:px-0">
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-stone-400"><Search className="size-5" /></span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar: esmalte, spray azul…"
                 enterKeyHint="search" aria-label="Buscar"
                 className="min-h-12 w-full rounded-lg border bg-white pl-10 pr-11 text-base [&::-webkit-search-cancel-button]:hidden" />
          {query && <button onClick={() => setQuery('')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-500" aria-label="Limpiar búsqueda">✕</button>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={category} onChange={e => setParam('categoria', e.target.value)} aria-label="Categoría"
                  className={`min-h-11 w-full min-w-0 rounded-lg border px-2 text-sm ${category ? 'border-amber-700 bg-amber-50 font-medium text-amber-900' : 'bg-white'}`}>
            <option value="">Todas las categorías</option>
            <option value="sin">Sin categoría</option>
            <CategoryOptions categories={categories} />
          </select>
          <select value={brand ?? '\u0000'} onChange={e => setParam('marca', e.target.value === '\u0000' ? null : e.target.value)} aria-label="Marca"
                  className={`min-h-11 w-full min-w-0 rounded-lg border px-2 text-sm ${brand != null ? 'border-amber-700 bg-amber-50 font-medium text-amber-900' : 'bg-white'}`}>
            <option value={'\u0000'}>Todas las marcas</option>
            {brandStats.map(([b, s]) => <option key={b} value={b}>{brandLabel(b)} ({s.n})</option>)}
          </select>
        </div>
        {!picking && sizeOptions.length > 1 && (
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Presentación">
            <Chip on={!size} onClick={() => setParam('tam', null)}>Todas</Chip>
            {sizeOptions.map(s => <Chip key={s.label} on={size === s.label} onClick={() => setParam('tam', size === s.label ? null : s.label)}>{s.label === '—' ? 'Sin tamaño' : s.label}</Chip>)}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <label className="flex min-h-9 items-center gap-2">
            <input type="checkbox" checked={onlyLow} onChange={e => setParam('bajos', e.target.checked ? '1' : null)} className="size-5 accent-amber-700" />
            Solo agotados o bajos
          </label>
          <label className="flex min-h-9 items-center gap-2">
            <input type="checkbox" checked={withInactive} onChange={e => setParam('inactivos', e.target.checked ? '1' : null)} className="size-5 accent-amber-700" />
            Incluir inactivos
          </label>
        </div>
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">Error: {(error as Error).message}</p>}

      {picking && !isLoading && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-stone-600">Elige una marca</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {brandStats.filter(([, s]) => s.n > 1).map(([b, s]) => (
              <li key={b}>
                <button onClick={() => setParam('marca', b)} className="flex min-h-14 w-full flex-col justify-center rounded-lg border bg-white px-3 py-2 text-left active:bg-amber-50 md:hover:bg-amber-50">
                  <span className="truncate font-medium">{brandLabel(b)}</span>
                  <span className="text-xs text-stone-500">
                    {s.n} productos{s.low > 0 && <> · <span className="text-red-600">{s.low} por reponer</span></>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!picking && (
        <>
          <p className="text-xs text-stone-500">
            {lines.length} línea{lines.length !== 1 && 's'} · {lowCount(lines)} agotados o bajo el mínimo
          </p>
          {!lines.length && !isLoading && <p className="rounded-lg bg-white p-6 text-center text-sm text-stone-500 shadow">Sin productos con estos filtros.</p>}
          {lines.map(l => (
            <LineTable key={l.key} line={l} order={order} onBump={bump} onMarkLow={() => markLow(l)}
                       onCreate={(color, size) => setCreating({ line: l, color, size })} />
          ))}
          <Legend />
        </>
      )}

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-safe-4 z-20 mx-auto flex max-w-5xl items-center gap-2 px-3 md:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-stone-900 p-2 pl-4 text-white shadow-lg">
            <span className="mr-auto min-w-0 text-sm leading-tight">
              <b className="text-base">{selected.length}</b> producto{selected.length !== 1 && 's'}
              <span className="block text-xs text-stone-300">{units} unidad{units !== 1 && 'es'}</span>
            </span>
            <button onClick={() => { if (confirm('¿Quitar todos los productos del pedido?')) setOrder({}) }}
                    className="grid min-h-11 w-11 place-items-center rounded-lg text-stone-300" aria-label="Quitar todo"><X className="size-5" /></button>
            <button onClick={copyOrder} className="grid min-h-11 w-11 place-items-center rounded-lg bg-stone-700" aria-label="Copiar lista"><Copy className="size-5" /></button>
            <button onClick={makeOrder} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-sm font-medium whitespace-nowrap">
              <ShoppingCart className="size-5" />Armar pedido
            </button>
          </div>
        </div>
      )}

      {creating && <CreateMissing missing={creating} onClose={() => setCreating(null)}
                                  onCreated={(id, name, existing) => {
                                    setOrder(o => ({ ...o, [id]: (o[id] ?? 0) + 1 }))
                                    setCreating(null)
                                    toast.success(`${existing ? 'Ya existía; agregado' : 'Creado y agregado'} al pedido: ${name}`)
                                  }} />}


    </div>
  )
}

/** Alta rápida del producto que falta, con nombre, marca, categoría, unidad y proveedor tomados de su línea. */
function CreateMissing({ missing: { line, color, size }, onClose, onCreated }: {
  missing: Missing
  onClose: () => void
  onCreated: (id: string, name: string, existing?: boolean) => void
}) {
  const { name, template } = suggestName(line, color, size)
  const ps = line.products
  const sizeText = size === NO_SIZE ? '' : ` en ${size}`
  return (
    <QuickCreateSheet
      initialName={name}
      initialBrand={template?.brand ?? mostCommon(ps.map(p => p.brand)) ?? line.brand}
      initialCategory={template?.category_id ?? mostCommon(ps.map(p => p.category_id))}
      initialUnit={template?.unit ?? mostCommon(ps.map(p => p.unit)) ?? 'und'}
      providerId={template?.provider_id ?? mostCommon(ps.map(p => p.provider_id))}
      submitLabel="Crear y agregar al pedido"
      intro={
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          No tienes <b>{color || 'este producto'}</b>{sizeText} en {line.line} · {brandLabel(line.brand)}. Revisa el nombre:
          se crea <b>por revisar</b> (sin precio no sale en Ventas) y entra al pedido. El costo lo pones en la orden y el precio, al recibir la compra.
        </p>
      }
      onClose={onClose}
      onCreated={(p, existing) => onCreated(p.id, p.name, existing)}
    />
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
            className={`min-h-9 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap ${on ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`}>
      {children}
    </button>
  )
}

function LineTable({ line, order, onBump, onMarkLow, onCreate }: {
  line: Line<InventoryProduct>
  order: Order
  onBump: (ps: InventoryProduct[], delta: 1 | -1) => void
  onMarkLow: () => void
  onCreate: (color: string, size: string) => void
}) {
  const visible = line.colors.flatMap(c => line.sizes.flatMap(s => line.cells.get(cellKey(c, s.label)) ?? []))
  const low = visible.filter(isLow).length
  const total = (label: string) => line.colors.reduce((n, c) => n + (line.cells.get(cellKey(c, label)) ?? []).reduce((m, p) => m + Math.max(p.stock, 0), 0), 0)
  return (
    <section className="overflow-hidden rounded-lg bg-white shadow">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <div className="mr-auto min-w-0">
          <h2 className="font-semibold break-words">{line.line} <span className="font-normal text-stone-500">· {brandLabel(line.brand)}</span></h2>
          <p className="text-xs text-stone-500">
            {visible.length} producto{visible.length !== 1 && 's'}{low > 0 && <> · <span className="text-red-600">{low} por reponer</span></>}
          </p>
        </div>
        {low > 0 && <button onClick={onMarkLow} className="min-h-10 rounded-lg border px-3 text-sm text-amber-800">+ Agotados al pedido</button>}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-stone-50 text-xs text-stone-500">
              <th scope="col" className="sticky left-0 z-[1] bg-stone-50 px-3 py-2 text-left font-medium">Color</th>
              {line.sizes.map(s => <th key={s.label} scope="col" className="min-w-[3.75rem] px-1 py-2 text-center font-medium whitespace-nowrap">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {line.colors.map(c => (
              <tr key={c} className="border-t">
                <th scope="row" className="sticky left-0 z-[1] max-w-[10rem] bg-white px-3 py-1 text-left font-normal break-words">
                  {c || <span className="text-stone-400">(sin color)</span>}
                </th>
                {line.sizes.map(s => {
                  const ps = line.cells.get(cellKey(c, s.label))
                  return (
                    <td key={s.label} className="p-0.5 text-center">
                      {ps ? <Cell ps={ps} order={order} onBump={onBump} />
                        : <button onClick={() => onCreate(c, s.label)} aria-label={`No existe ${c || 'sin color'} en ${s.label}: crear y pedir`}
                                  className="group h-11 w-full min-w-[3.25rem] rounded-md text-stone-300 active:bg-amber-50 md:hover:bg-amber-50">
                            <span className="group-active:hidden md:group-hover:hidden">·</span>
                            <span className="hidden text-lg text-amber-700 group-active:inline md:group-hover:inline">+</span>
                          </button>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {line.colors.length > 1 && (
            <tfoot>
              <tr className="border-t bg-stone-50 text-xs text-stone-500">
                <th scope="row" className="sticky left-0 z-[1] bg-stone-50 px-3 py-1.5 text-left font-medium">Total</th>
                {line.sizes.map(s => <td key={s.label} className="px-1 py-1.5 text-center tabular-nums">{fmt(total(s.label))}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}

function Cell({ ps, order, onBump }: {
  ps: InventoryProduct[]
  order: Order
  onBump: (ps: InventoryProduct[], delta: 1 | -1) => void
}) {
  const stock = ps.reduce((n, p) => n + p.stock, 0)
  const qty = ps.reduce((n, p) => n + (order[p.id] ?? 0), 0)
  const on = qty > 0
  const out = ps.every(p => p.stock <= 0)
  const low = ps.some(isLow)
  const inactive = ps.every(p => !p.active)
  const tone = on ? 'bg-amber-600 text-white'
    : out ? 'bg-red-50 text-red-700 font-semibold'
    : low ? 'bg-amber-50 text-amber-800 font-medium'
    : 'text-stone-900'
  const title = ps.map(p => `${p.name}: ${fmt(p.stock)} ${p.unit}${p.min_stock > 0 ? ` (mín. ${fmt(p.min_stock)})` : ''}`).join('\n')
  // Toque: +1. Mantener presionado (o clic derecho): −1.
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const held = useRef(false)
  const cancel = () => clearTimeout(timer.current)
  const remove = () => { navigator.vibrate?.(15); onBump(ps, -1) }
  return (
    <button onClick={() => { if (!held.current) onBump(ps, 1); held.current = false }} title={title}
            aria-label={`${title}${on ? `. Pedir ${fmt(qty)}` : ''}. Toca para sumar 1, mantén presionado para quitar 1`}
            onContextMenu={e => { e.preventDefault(); cancel(); held.current = false; if (on) onBump(ps, -1) }}
            onPointerDown={() => { held.current = false; cancel(); timer.current = setTimeout(() => { held.current = true; if (on) remove() }, 500) }}
            onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
            className={`relative h-12 w-full min-w-[3.25rem] touch-manipulation rounded-md tabular-nums select-none [-webkit-touch-callout:none] ${tone} ${inactive && !on ? 'italic opacity-60' : ''}`}>
      {on ? (
        <span className="flex flex-col items-center leading-none">
          <span className="text-base font-bold">+{fmt(qty)}</span>
          <span className="mt-0.5 text-[10px] opacity-90">hay {fmt(stock)}</span>
        </span>
      ) : fmt(stock)}
      {ps.length > 1 && <span className="absolute top-0.5 right-1 text-[10px] leading-none opacity-70" title="Producto repetido">×{ps.length}</span>}
    </button>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-stone-500">
      <span><span className="inline-block size-3 rounded-sm bg-red-100 align-[-0.1em]" /> agotado</span>
      <span><span className="inline-block size-3 rounded-sm bg-amber-100 align-[-0.1em]" /> en o bajo el mínimo</span>
      <span><span className="inline-block size-3 rounded-sm bg-amber-600 align-[-0.1em]" /> en el pedido: +cantidad a pedir y lo que hay</span>
      <span>· no existe en ese tamaño (tócalo para crearlo y pedirlo)</span>
      <span>×2 producto repetido</span>
    </div>
  )
}
