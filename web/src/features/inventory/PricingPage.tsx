import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import BarcodeScanner from '@/components/BarcodeScanner'
import PhotoInput from '@/components/PhotoInput'
import Sheet from '@/components/Sheet'
import { imageUrl, uploadProductImage } from '@/lib/images'
import { money } from '@/lib/format'
import { friendlyError, inventoryKeys, type InventoryProduct, useInventory, usePatchProduct } from './api'
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

/** Recorrer la tienda con el celular: escanear/buscar, poner precio, código y foto, y pasar al siguiente. */
export default function PricingPage() {
  const { data: products = [], isLoading } = useInventory()
  const [queue, setQueue] = useState<Queue>('sin_precio')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [scanMode, setScanMode] = useState<'find' | 'assign' | null>(null)
  const [unknownCode, setUnknownCode] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ barcode?: string; name?: string } | null>(null)
  const [flash, setFlash] = useState('')

  const list = useMemo(() => products.filter(QUEUES.find(q => q.id === queue)!.test), [products, queue])
  // Si el actual sale de la cola (p. ej. ya tiene precio), se sigue mostrando hasta pasar al siguiente.
  const current = products.find(p => p.id === currentId) ?? list[0] ?? null
  const idx = current ? list.findIndex(p => p.id === current.id) : -1
  const nextId = (idx >= 0 ? list[idx + 1] : list.find(p => p.id !== current?.id))?.id ?? null

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return products.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      || (p.brand?.toLowerCase().includes(q) ?? false) || p.barcode === q).slice(0, 20)
  }, [products, query])

  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 2500); return () => clearTimeout(t) }, [flash])

  const select = (id: string) => { setCurrentId(id); setQuery('') }

  // Código para la tarjeta actual (escaneado o elegido en "no está en el catálogo"); n fuerza el efecto.
  const [assigned, setAssigned] = useState<{ code: string; n: number } | null>(null)
  const assign = (code: string) => setAssigned(a => ({ code, n: (a?.n ?? 0) + 1 }))

  function onScan(code: string) {
    const mode = scanMode
    setScanMode(null)
    if (mode === 'assign') return assign(code)
    const found = products.find(p => p.barcode === code)
    if (found) { select(found.id); setFlash(`Encontrado: ${found.name}`) }
    else setUnknownCode(code)
  }

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2">
        <Link to="/inventario" className="-ml-2 grid size-11 place-items-center text-xl text-amber-800" aria-label="Volver a Inventario">←</Link>
        <h1 className="flex-1 text-lg font-semibold">Poner precios</h1>
        <button onClick={() => setCreating({})} className="min-h-11 rounded-lg bg-amber-700 px-4 text-sm text-white">+ Nuevo</button>
      </div>

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-stone-400">🔍</span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar producto" aria-label="Buscar producto"
                 className="min-h-12 w-full rounded-lg border bg-white pl-10 pr-11 text-base [&::-webkit-search-cancel-button]:hidden" />
          {query && (
            <button onClick={() => setQuery('')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-500" aria-label="Limpiar búsqueda">✕</button>
          )}
        </div>
        <button onClick={() => setScanMode('find')} className="grid min-h-12 w-12 shrink-0 place-items-center rounded-lg bg-amber-700 text-xl text-white" aria-label="Escanear para buscar">
          📷
        </button>
      </div>

      {matches.length > 0 && (
        <ul className="divide-y rounded-lg bg-white shadow">
          {matches.map(p => (
            <li key={p.id}>
              <button onClick={() => select(p.id)} className="flex w-full items-center gap-2 p-3 text-left">
                <span className="flex-1 text-sm">{p.name}</span>
                <span className="text-sm text-stone-500">{p.price != null ? money(p.price) : 'sin precio'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && !matches.length && (
        <button onClick={() => setCreating({ name: query.trim() })} className="w-full rounded-lg border border-dashed bg-white p-3 text-sm">
          No está en el catálogo → crear «{query.trim()}»
        </button>
      )}

      <label className="flex items-center gap-2 text-sm text-stone-600">
        <span className="shrink-0">Recorrer:</span>
        <select value={queue} onChange={e => { setQueue(e.target.value as Queue); setCurrentId(null) }}
                className="min-h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-base text-stone-900">
          {QUEUES.map(q => <option key={q.id} value={q.id}>{q.label} ({products.filter(q.test).length})</option>)}
        </select>
      </label>

      {flash && <p className="rounded-lg bg-green-50 p-2 text-sm text-green-800">{flash}</p>}
      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {!isLoading && !current && <p className="rounded-lg bg-white p-6 text-center text-stone-500">¡Nada pendiente en esta lista!</p>}

      {current && (
        <ProductCard key={current.id} product={current} position={idx >= 0 ? `${idx + 1} de ${list.length}` : 'fuera de la lista'}
                     assigned={assigned} onScanAssign={() => setScanMode('assign')}
                     onNext={(msg) => { if (msg) setFlash(msg); setCurrentId(nextId) }} />
      )}

      {scanMode && (
        <BarcodeScanner title={scanMode === 'find' ? 'Escanear para buscar' : `Código para: ${current?.name ?? ''}`}
                        onClose={() => setScanMode(null)} onDetected={onScan} />
      )}

      {unknownCode && (
        <Sheet onClose={() => setUnknownCode(null)} className="space-y-3" label="Código no encontrado">
            <p>El código <b className="font-mono">{unknownCode}</b> no está en el catálogo.</p>
            {current && (
              <button onClick={() => { assign(unknownCode); setUnknownCode(null) }}
                      className="w-full rounded-lg border p-3 text-left text-sm">
                Asignarlo a <b>{current.name}</b>
              </button>
            )}
            <button onClick={() => { setCreating({ barcode: unknownCode }); setUnknownCode(null) }}
                    className="w-full rounded-lg bg-amber-700 p-3 text-sm text-white">Crear producto nuevo con este código</button>
            <button onClick={() => setUnknownCode(null)} className="min-h-11 w-full text-sm text-stone-500">Cancelar</button>
        </Sheet>
      )}

      {creating && (
        <QuickCreateSheet initialBarcode={creating.barcode} initialName={creating.name} onClose={() => setCreating(null)}
                          onCreated={p => { setCreating(null); setQuery(''); setCurrentId(p.id); setFlash(`Creado ${p.sku}: ${p.name}`) }} />
      )}
    </div>
  )
}

interface CardProps {
  product: InventoryProduct
  position: string
  assigned: { code: string; n: number } | null
  onScanAssign: () => void
  onNext: (msg?: string) => void
}

function ProductCard({ product, position, assigned, onScanAssign, onNext }: CardProps) {
  const qc = useQueryClient()
  const patch = usePatchProduct()
  const [price, setPrice] = useState(product.price?.toString() ?? '')
  const [barcode, setBarcode] = useState(product.barcode ?? '')
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  // El escáner vive en la página; el código leído llega por prop sin perder el precio ya escrito.
  const seen = useRef(assigned?.n)
  useEffect(() => {
    if (assigned && assigned.n !== seen.current) { seen.current = assigned.n; setBarcode(assigned.code) }
  }, [assigned])

  const p = price.trim() ? Number(price.replace(',', '.')) : null
  const valid = p == null || (!Number.isNaN(p) && p >= 0)
  const m = p && product.cost != null ? (p - product.cost) / p : null
  const changed = (p ?? null) !== (product.price ?? null) || (barcode.trim() || null) !== product.barcode

  async function onPhoto(file: File | null) {
    if (!file) return
    setUploading(true); setPhotoError('')
    try {
      await uploadProductImage(product.id, file, product.image_path)
      await qc.invalidateQueries({ queryKey: inventoryKeys.products })
    } catch (e) { setPhotoError(friendlyError(e)) } finally { setUploading(false) }
  }

  async function save() {
    if (!valid) return
    try {
      await patch.mutateAsync({
        id: product.id, price: p, barcode: barcode.trim() || null,
        // poner precio activa el producto (aparece en el POS); quitarlo lo desactiva
        active: p != null ? (product.price == null ? true : product.active) : false,
      })
      onNext(`Guardado: ${product.name}${p != null ? ` · ${money(p)}` : ''}`)
    } catch { /* se muestra abajo */ }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-4 shadow">
      <div className="flex items-start gap-2 text-xs text-stone-500">
        <span className="flex-1">{product.sku}{product.brand && ` · ${product.brand}`}</span>
        <span>{position}</span>
      </div>
      <h2 className="text-lg font-semibold leading-snug">{product.name}</h2>
      {product.notes && <p className="text-xs text-stone-500">{product.notes}</p>}

      <div className={uploading ? 'opacity-50' : ''}>
        <PhotoInput file={null} currentUrl={imageUrl(product.image_path)} onChange={onPhoto} />
        {uploading && <p className="mt-1 text-xs text-stone-500">Subiendo foto…</p>}
        {photoError && <p className="mt-1 text-xs text-red-600">{photoError}</p>}
      </div>

      <div className="flex gap-2">
        <input value={barcode} onChange={e => setBarcode(e.target.value)} inputMode="numeric" placeholder="Código de barras"
               className="min-w-0 flex-1 rounded-lg border p-3 font-mono" />
        <button onClick={onScanAssign} className="min-w-12 shrink-0 rounded-lg border px-4" aria-label="Escanear código del producto">📷</button>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-sm text-stone-600">
          <span>Costo: {product.cost != null ? money(product.cost) : '—'}</span>
          {m != null && <span className={m < 0.15 ? 'text-red-600' : ''}>Margen {Math.round(m * 100)}%</span>}
        </div>
        <div className="flex items-center rounded-lg border focus-within:ring-2 focus-within:ring-amber-600">
          <span className="pl-3 text-xl text-stone-500">S/</span>
          <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Precio de venta"
                 className="min-w-0 flex-1 rounded-lg p-3 text-2xl font-semibold outline-none" />
        </div>
        {product.cost != null && product.cost > 0 && (
          <div className="mt-2 grid grid-cols-4 gap-1">
            {MARKUPS.map(mk => (
              <button key={mk} onClick={() => setPrice(suggestPrice(product.cost!, mk).toFixed(2))}
                      className="rounded-lg border px-1 py-2 text-xs">
                +{mk * 100}%<br /><b>{money(suggestPrice(product.cost!, mk))}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      {patch.error && <p className="text-sm text-red-600">{friendlyError(patch.error)}</p>}

      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t bg-white px-safe-3 pt-3 pb-safe-3">
        <button onClick={() => onNext()} className="flex-1 rounded-lg border p-3">Saltar</button>
        <button onClick={save} disabled={!valid || !changed || patch.isPending}
                className="flex-[2] rounded-lg bg-amber-700 p-3 font-medium text-white disabled:opacity-40">
          {patch.isPending ? 'Guardando…' : 'Guardar y siguiente'}
        </button>
      </div>
    </div>
  )
}
