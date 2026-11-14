import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Camera, ChevronLeft, FileText, Loader2, Minus, Package, Plus, ScanBarcode, Search, Share2, Tag, Boxes } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import BarcodeScanner from '@/components/BarcodeScanner'
import Sheet from '@/components/Sheet'
import { Link } from 'react-router-dom'
import { imageUrl, uploadProductImage } from '@/lib/images'
import { ImagePlaceholder, useImageStatus } from '@/components/ProductImage'
import { money } from '@/lib/format'
import { rankBy, withCode } from '@/lib/search'
import { useProductMatcher } from '@/hooks/use-product-search'
import { cn } from '@/lib/utils'
import { friendlyError, inventoryKeys, type InventoryProduct, useAdjustStock, useInventory, usePatchProduct } from './api'
import { suggestPrice } from './ProductEditor'
import QuickCreateSheet from './QuickCreateSheet'

type Queue = 'sin_precio' | 'sin_foto' | 'sin_codigo' | 'todos'
const QUEUES: { id: Queue; label: string; test: (p: InventoryProduct) => boolean }[] = [
  { id: 'sin_precio', label: 'Sin precio', test: p => p.price == null },
  { id: 'sin_foto', label: 'Sin foto', test: p => !p.image_path && p.track_stock },
  { id: 'sin_codigo', label: 'Sin código', test: p => !p.barcode && p.track_stock },
  { id: 'todos', label: 'Todos', test: () => true },
]
const MARKUPS = [0.3, 0.35, 0.4, 0.5]

type Panel = 'price' | 'stock' | 'notes' | 'code'

/**
 * Inventariado estilo "feed": un producto por pantalla, se desliza hacia arriba/abajo y las
 * acciones (foto, precio, stock, notas, código) quedan a la derecha. Las colas funcionan como filtros.
 */
export default function PricingPage() {
  const { data: products = [], isLoading } = useInventory()
  const queryClient = useQueryClient()
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const [queue, setQueue] = useState<Queue>('sin_precio')
  // Lista congelada al elegir la cola: un producto que sale de ella (p. ej. ya tiene precio) no desaparece de golpe.
  const [ids, setIds] = useState<string[]>([])
  const loaded = !isLoading
  const productsRef = useRef(products)
  productsRef.current = products
  useEffect(() => {
    if (!loaded) return
    const test = QUEUES.find(q => q.id === queue)!.test
    setIds(productsRef.current.filter(test).map(p => p.id))
    setIdx(0)
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [queue, loaded])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const [idx, setIdx] = useState(0)
  const raf = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (el && el.clientHeight) setIdx(Math.round(el.scrollTop / el.clientHeight))
    })
  }
  const goTo = useCallback((i: number, smooth = true) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: i * el.clientHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,button,select,label')) return
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goTo(Math.min(idx + 1, ids.length - 1)) }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goTo(Math.max(idx - 1, 0)) }
  }

  const [panel, setPanel] = useState<{ kind: Panel; id: string } | null>(null)
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState<{ barcode?: string; name?: string } | null>(null)

  /** Lleva al producto a la pantalla actual; si no está en la lista, lo pone primero. */
  const focusProduct = (id: string) => {
    const i = ids.indexOf(id)
    if (i >= 0) return goTo(i, false)
    setIds([id, ...ids])
    requestAnimationFrame(() => goTo(0, false))
    setIdx(0)
  }

  const current = byId.get(ids[idx] ?? '')
  const panelProduct = panel ? byId.get(panel.id) : undefined

  return (
    <div className="fixed inset-x-0 bottom-0 top-below-header z-20 bg-stone-950 text-white">
      <div className="mx-auto h-full max-w-md">
        {/* Controles superpuestos */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 mx-auto max-w-md bg-gradient-to-b from-black/70 to-transparent pb-6">
          <div className="pointer-events-auto flex items-center gap-1 px-2 pt-2">
            <Link to="/inventario" aria-label="Volver a Inventario" className="grid size-11 shrink-0 place-items-center rounded-full active:bg-white/20"><ChevronLeft className="size-6" /></Link>
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]">
              {QUEUES.map(q => {
                const n = products.filter(q.test).length
                return (
                  <button key={q.id} onClick={() => setQueue(q.id)} aria-pressed={queue === q.id}
                          className={cn('min-h-9 shrink-0 rounded-full px-3 text-sm', queue === q.id ? 'bg-white font-medium text-stone-900' : 'bg-white/20')}>
                    {q.label} <span className="opacity-70">{n}</span>
                  </button>
                )
              })}
            </div>
            <button onClick={() => setSearching(true)} aria-label="Buscar producto" className="grid size-11 shrink-0 place-items-center rounded-full active:bg-white/20"><Search className="size-6" /></button>
            <button onClick={() => setCreating({})} aria-label="Nuevo producto" className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-700 active:bg-amber-800"><Plus className="size-6" /></button>
          </div>
          {ids.length > 0 && <p className="pointer-events-none px-4 pt-1 text-xs text-white/70">{Math.min(idx + 1, ids.length)} de {ids.length}</p>}
        </div>

        {isLoading && <p className="grid h-full place-items-center text-white/70">Cargando…</p>}
        {!isLoading && ids.length === 0 && (
          <div className="grid h-full place-items-center p-8 text-center text-white/70">
            <div><Package className="mx-auto mb-3 size-12 opacity-50" /><p>¡Nada pendiente en esta lista!</p></div>
          </div>
        )}

        <div ref={scrollerRef} onScroll={onScroll} onKeyDown={onKeyDown} tabIndex={-1}
             className={cn('h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain outline-none [scrollbar-width:none]', !ids.length && 'hidden')}>
          {ids.map((id, i) => {
            const p = byId.get(id)
            return (
              <div key={id} className="h-full snap-start snap-always">
                {p && Math.abs(i - idx) <= 1 && (
                  <Slide product={p} onOpen={kind => setPanel({ kind, id })} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {panelProduct && panel?.kind === 'price' && (
        <PriceSheet product={panelProduct} onClose={() => setPanel(null)}
                    onSaved={() => { setPanel(null); if (idx < ids.length - 1) setTimeout(() => goTo(idx + 1), 150) }} />
      )}
      {panelProduct && panel?.kind === 'stock' && <StockSheet product={panelProduct} onClose={() => setPanel(null)} />}
      {panelProduct && panel?.kind === 'notes' && <NotesSheet product={panelProduct} onClose={() => setPanel(null)} />}
      {panelProduct && panel?.kind === 'code' && <CodeSheet product={panelProduct} onClose={() => setPanel(null)} />}

      {searching && (
        <SearchSheet products={products} current={current}
                     onPick={id => { setSearching(false); focusProduct(id) }}
                     onCreate={init => { setSearching(false); setCreating(init) }}
                     onClose={() => setSearching(false)} />
      )}
      {creating && (
        <QuickCreateSheet initialBarcode={creating.barcode} initialName={creating.name} onClose={() => setCreating(null)}
                          onCreated={(p, existing) => {
                            setCreating(null)
                            toast.success(`${existing ? 'Ya existía' : 'Creado'} ${p.sku}: ${p.name}`)
                            // el producto recién creado aún no está en caché: se enfoca cuando llegue
                            void queryClient.invalidateQueries({ queryKey: inventoryKeys.products }).then(() => focusProduct(p.id))
                          }} />
      )}
    </div>
  )

}

/** Un producto a pantalla completa: foto de fondo, datos abajo a la izquierda, acciones a la derecha. */
function Slide({ product: p, onOpen }: { product: InventoryProduct; onOpen: (k: Panel) => void }) {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const src = imageUrl(p.image_path)
  const { status, imgProps } = useImageStatus(src)
  const lowStock = p.track_stock && p.stock <= p.min_stock
  const margin = p.price && p.cost != null ? (p.price - p.cost) / p.price : null

  async function onPhoto(file: File | null) {
    if (!file) return
    setUploading(true)
    try {
      await uploadProductImage(p.id, file, p.image_path)
      await qc.invalidateQueries({ queryKey: inventoryKeys.products })
      toast.success('Foto guardada')
    } catch (e) { toast.error(friendlyError(e)) } finally { setUploading(false) }
  }

  return (
    <div className="relative h-full overflow-hidden">
      {src ? (
        <>
          {status === 'loaded' && <img src={src} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl" />}
          <img {...imgProps} src={src} alt={p.name}
               className={cn('absolute inset-0 size-full object-contain transition-opacity duration-300', status !== 'loaded' && 'opacity-0')} />
          {status === 'loading' && <div aria-hidden className="absolute inset-0 animate-pulse bg-white/5" />}
          {status === 'error' && <ImagePlaceholder kind="error" size="lg" label className="absolute inset-0 bg-transparent text-white/40" />}
        </>
      ) : (
        <button onClick={() => document.getElementById(`photo-${p.id}`)?.click()}
                className="absolute inset-0 grid place-items-center text-white/40">
          <span className="text-center"><Package className="mx-auto mb-2 size-20" /><span className="text-sm">Sin foto · toca para agregar</span></span>
        </button>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 to-transparent" />
      {uploading && <div role="status" className="absolute inset-0 z-10 grid place-items-center bg-black/50 text-sm">
        <span className="grid justify-items-center gap-2"><Loader2 className="size-8 animate-spin" aria-hidden />Subiendo foto…</span>
      </div>}

      {/* Datos */}
      <div className="absolute bottom-0 left-0 right-20 space-y-1.5 p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="text-xs text-white/70">{p.sku}{p.brand && ` · ${p.brand}`}</div>
        <h2 className="text-xl font-semibold leading-snug drop-shadow">{p.name}</h2>
        {p.notes && <p className="line-clamp-2 text-sm text-white/80">{p.notes}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {p.price != null
            ? <span className="text-3xl font-bold drop-shadow">{money(p.price)}</span>
            : <span className="rounded-full bg-amber-600 px-3 py-1 text-sm font-medium">Sin precio</span>}
          {margin != null && <span className={cn('rounded-full bg-black/40 px-2 py-0.5 text-xs', margin < 0.15 && 'text-red-300')}>Margen {Math.round(margin * 100)}%</span>}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {p.track_stock
            ? <span className={cn('rounded-full bg-black/40 px-2 py-0.5', lowStock && 'text-red-300')}>Stock {p.stock} {p.unit}</span>
            : <span className="rounded-full bg-black/40 px-2 py-0.5">Servicio</span>}
          {p.barcode && <span className="rounded-full bg-black/40 px-2 py-0.5 font-mono">{p.barcode}</span>}
        </div>
      </div>

      {/* Acciones */}
      <div className="absolute bottom-0 right-1 flex flex-col items-center gap-3 p-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <RailButton icon={Camera} label={p.image_path ? 'Foto' : 'Agregar'}>
          <input id={`photo-${p.id}`} type="file" accept="image/*" capture="environment" className="hidden"
                 onChange={e => { void onPhoto(e.target.files?.[0] ?? null); e.target.value = '' }} />
        </RailButton>
        <RailButton icon={Tag} label="Precio" onClick={() => onOpen('price')} highlight={p.price == null} />
        {p.track_stock && <RailButton icon={Boxes} label="Stock" onClick={() => onOpen('stock')} />}
        <RailButton icon={FileText} label="Notas" onClick={() => onOpen('notes')} />
        <RailButton icon={ScanBarcode} label="Código" onClick={() => onOpen('code')} highlight={!p.barcode && p.track_stock} />
        <RailButton icon={Share2} label="Pronto" disabled />
      </div>
    </div>
  )
}

function RailButton({ icon: Icon, label, onClick, disabled, highlight, children }: {
  icon: ComponentType<{ className?: string }>; label: string; onClick?: () => void; disabled?: boolean; highlight?: boolean; children?: ReactNode
}) {
  const cls = cn('flex w-14 flex-col items-center gap-0.5 text-[11px]', disabled && 'opacity-40')
  const circle = cn('grid size-12 place-items-center rounded-full', highlight ? 'bg-amber-600' : 'bg-black/50 backdrop-blur')
  if (children) return (
    <label className={cn(cls, 'cursor-pointer')}>
      <span className={circle}><Icon className="size-6" /></span>{label}{children}
    </label>
  )
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      <span className={circle}><Icon className="size-6" /></span>{label}
    </button>
  )
}

function PriceSheet({ product, onClose, onSaved }: { product: InventoryProduct; onClose: () => void; onSaved: () => void }) {
  const patch = usePatchProduct()
  const [price, setPrice] = useState(product.price?.toString() ?? '')
  const p = price.trim() ? Number(price.replace(',', '.')) : null
  const valid = p == null || (!Number.isNaN(p) && p >= 0)
  const m = p && product.cost != null ? (p - product.cost) / p : null
  const changed = (p ?? null) !== (product.price ?? null)

  async function save() {
    if (!valid) return
    try {
      await patch.mutateAsync({
        id: product.id, price: p,
        // poner precio activa el producto (aparece en el POS); quitarlo lo desactiva
        active: p != null ? (product.price == null ? true : product.active) : false,
      })
      toast.success(`Guardado: ${product.name}${p != null ? ` · ${money(p)}` : ''}`)
      onSaved()
    } catch { /* se muestra abajo */ }
  }

  return (
    <Sheet onClose={onClose} label="Precio" className="space-y-3">
      <h3 className="font-semibold leading-snug">{product.name}</h3>
      <div className="flex justify-between text-sm text-stone-600">
        <span>Costo: {product.cost != null ? money(product.cost) : '—'}</span>
        {m != null && <span className={m < 0.15 ? 'text-red-600' : ''}>Margen {Math.round(m * 100)}%</span>}
      </div>
      <div className="flex items-center rounded-lg border focus-within:ring-2 focus-within:ring-amber-600">
        <span className="pl-3 text-xl text-stone-500">S/</span>
        <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Precio de venta" autoFocus
               className="min-w-0 flex-1 rounded-lg p-3 text-2xl font-semibold outline-none" />
      </div>
      {product.cost != null && product.cost > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {MARKUPS.map(mk => (
            <button key={mk} onClick={() => setPrice(suggestPrice(product.cost!, mk).toFixed(2))} className="rounded-lg border px-1 py-2 text-xs">
              +{mk * 100}%<br /><b>{money(suggestPrice(product.cost!, mk))}</b>
            </button>
          ))}
        </div>
      )}
      {patch.error && <p className="text-sm text-red-600">{friendlyError(patch.error)}</p>}
      <button onClick={save} disabled={!valid || !changed || patch.isPending}
              className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white disabled:opacity-40">
        {patch.isPending ? 'Guardando…' : 'Guardar'}
      </button>
    </Sheet>
  )
}

function StockSheet({ product, onClose }: { product: InventoryProduct; onClose: () => void }) {
  const adjust = useAdjustStock()
  const [value, setValue] = useState(String(product.stock))
  const n = Number(value.replace(',', '.'))
  const valid = value.trim() !== '' && !Number.isNaN(n) && n >= 0
  const step = (d: number) => setValue(String(Math.max(0, (valid ? n : product.stock) + d)))

  async function save() {
    if (!valid) return
    try {
      await adjust.mutateAsync({ productId: product.id, newStock: n, note: 'Ajuste desde inventariado' })
      toast.success(`Stock de ${product.name}: ${n} ${product.unit}`)
      onClose()
    } catch { /* se muestra abajo */ }
  }

  return (
    <Sheet onClose={onClose} label="Stock" className="space-y-3">
      <h3 className="font-semibold leading-snug">{product.name}</h3>
      <p className="text-sm text-stone-600">Stock actual: {product.stock} {product.unit}. Se registra como ajuste en el historial.</p>
      <div className="flex items-center gap-2">
        <button onClick={() => step(-1)} aria-label="Restar uno" className="grid size-12 shrink-0 place-items-center rounded-lg border"><Minus className="size-5" /></button>
        <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" aria-label="Stock contado" autoFocus
               className="min-w-0 flex-1 rounded-lg border p-3 text-center text-2xl font-semibold" />
        <button onClick={() => step(1)} aria-label="Sumar uno" className="grid size-12 shrink-0 place-items-center rounded-lg border"><Plus className="size-5" /></button>
      </div>
      {adjust.error && <p className="text-sm text-red-600">{friendlyError(adjust.error)}</p>}
      <button onClick={save} disabled={!valid || n === product.stock || adjust.isPending}
              className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white disabled:opacity-40">
        {adjust.isPending ? 'Guardando…' : 'Guardar stock'}
      </button>
    </Sheet>
  )
}

function NotesSheet({ product, onClose }: { product: InventoryProduct; onClose: () => void }) {
  const patch = usePatchProduct()
  const [notes, setNotes] = useState(product.notes ?? '')

  async function save() {
    try {
      await patch.mutateAsync({ id: product.id, notes: notes.trim() || null })
      toast.success('Nota guardada')
      onClose()
    } catch { /* se muestra abajo */ }
  }

  return (
    <Sheet onClose={onClose} label="Notas" className="space-y-3">
      <h3 className="font-semibold leading-snug">{product.name}</h3>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Notas del producto" aria-label="Notas" autoFocus
                className="w-full rounded-lg border p-3 text-base" />
      {patch.error && <p className="text-sm text-red-600">{friendlyError(patch.error)}</p>}
      <button onClick={save} disabled={(notes.trim() || null) === product.notes || patch.isPending}
              className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white disabled:opacity-40">
        {patch.isPending ? 'Guardando…' : 'Guardar nota'}
      </button>
    </Sheet>
  )
}

function CodeSheet({ product, onClose }: { product: InventoryProduct; onClose: () => void }) {
  const patch = usePatchProduct()
  const [barcode, setBarcode] = useState(product.barcode ?? '')
  const [scanning, setScanning] = useState(false)

  async function save() {
    try {
      await patch.mutateAsync({ id: product.id, barcode: barcode.trim() || null })
      toast.success('Código guardado')
      onClose()
    } catch { /* se muestra abajo */ }
  }

  return (
    <>
      <Sheet onClose={onClose} label="Código de barras" className="space-y-3" hidden={scanning}>
        <h3 className="font-semibold leading-snug">{product.name}</h3>
        <div className="flex gap-2">
          <input value={barcode} onChange={e => setBarcode(e.target.value)} inputMode="numeric" placeholder="Código de barras" aria-label="Código de barras"
                 className="min-w-0 flex-1 rounded-lg border p-3 font-mono" />
          <button onClick={() => setScanning(true)} className="min-w-12 shrink-0 rounded-lg border px-4" aria-label="Escanear código"><ScanBarcode className="mx-auto size-6" /></button>
        </div>
        {patch.error && <p className="text-sm text-red-600">{friendlyError(patch.error)}</p>}
        <button onClick={save} disabled={(barcode.trim() || null) === product.barcode || patch.isPending}
                className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white disabled:opacity-40">
          {patch.isPending ? 'Guardando…' : 'Guardar código'}
        </button>
      </Sheet>
      {scanning && (
        <BarcodeScanner title={`Código para: ${product.name}`} onClose={() => setScanning(false)}
                        onDetected={code => { setBarcode(code); setScanning(false) }} />
      )}
    </>
  )
}

function SearchSheet({ products, current, onPick, onCreate, onClose }: {
  products: InventoryProduct[]; current?: InventoryProduct
  onPick: (id: string) => void; onCreate: (init: { barcode?: string; name?: string }) => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [unknown, setUnknown] = useState<string | null>(null)
  const textScore = useProductMatcher(query)
  const matches = useMemo(() => query.trim().length < 2 ? [] : rankBy(products, withCode(query, textScore)).slice(0, 20), [products, query, textScore])
  const patch = usePatchProduct()

  function onScan(code: string) {
    setScanning(false)
    const found = products.find(p => p.barcode === code)
    if (found) onPick(found.id)
    else setUnknown(code)
  }

  async function assignToCurrent(code: string) {
    if (!current) return
    try {
      await patch.mutateAsync({ id: current.id, barcode: code })
      toast.success(`Código asignado a ${current.name}`)
      onClose()
    } catch (e) { toast.error(friendlyError(e)) }
  }

  return (
    <>
      <Sheet onClose={onClose} label="Buscar producto" className="space-y-3" hidden={scanning}>
        <div className="flex gap-2">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar producto" aria-label="Buscar producto" autoFocus
                 className="min-h-12 min-w-0 flex-1 rounded-lg border bg-white px-3 text-base" />
          <button onClick={() => setScanning(true)} className="grid min-h-12 w-12 shrink-0 place-items-center rounded-lg bg-amber-700 text-white" aria-label="Escanear para buscar">
            <ScanBarcode className="size-6" />
          </button>
        </div>
        {unknown && (
          <div className="space-y-2 rounded-lg bg-stone-100 p-3 text-sm">
            <p>El código <b className="font-mono">{unknown}</b> no está en el catálogo.</p>
            {current && <button onClick={() => assignToCurrent(unknown)} className="w-full rounded-lg border bg-white p-3 text-left">Asignarlo a <b>{current.name}</b></button>}
            <button onClick={() => onCreate({ barcode: unknown })} className="w-full rounded-lg bg-amber-700 p-3 text-white">Crear producto nuevo con este código</button>
          </div>
        )}
        {matches.length > 0 && (
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-lg border">
            {matches.map(p => (
              <li key={p.id}>
                <button onClick={() => onPick(p.id)} className="flex w-full items-center gap-2 p-3 text-left">
                  <span className="flex-1 text-sm">{p.name}</span>
                  <span className="text-sm text-stone-500">{p.price != null ? money(p.price) : 'sin precio'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && !matches.length && (
          <button onClick={() => onCreate({ name: query.trim() })} className="w-full rounded-lg border border-dashed p-3 text-sm">
            No está en el catálogo → crear «{query.trim()}»
          </button>
        )}
      </Sheet>
      {scanning && <BarcodeScanner title="Escanear para buscar" onClose={() => setScanning(false)} onDetected={onScan} />}
    </>
  )
}
