import { useEffect, useMemo, useState } from 'react'
import { MapPin, Minus, Plus, Printer, ScanBarcode, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '@/components/PageHeader'
import BarcodeScanner from '@/components/BarcodeScanner'
import { money } from '@/lib/format'
import { rankBy } from '@/lib/search'
import { useProductMatcher } from '@/hooks/use-product-search'
import { normalizeCode } from '@/features/locations/api'
import { type InventoryProduct, useInventory } from '@/features/inventory/api'
import { useBusinessInfo } from '@/features/documents/api'
import { labelQueue, MAX_COPIES, useLabelQueue } from './queue'
import {
  amount, brandLine, FORMATS, isFormat, type LabelData, type LabelFormat, nameTier, paginate, perPage, presentationText,
  unitText,
} from './labels'
import { chip } from '@/lib/chip'

const FORMAT_KEY = 'etiquetas-formato'
const RESULTS = 8          // resultados que se muestran al buscar
const MAX_BULK = 120       // "Agregar los N": tope para no llenar la lista por error con una búsqueda corta

const readFormat = (): LabelFormat => {
  try { const f = localStorage.getItem(FORMAT_KEY); return isFormat(f) ? f : 'ancha' } catch { return 'ancha' }
}

const toLabel = (p: InventoryProduct): LabelData => ({
  id: p.id, name: p.name, brand: p.brand, sku: p.sku, unit: p.unit, price: p.price, presentations: p.presentations ?? [],
})

/**
 * Etiquetas de precio para los estantes: se van agregando productos (buscando, escaneando o desde la ficha) y se
 * imprimen en hojas A4 de 12 (2 × 6), 18 (3 × 6) o 30 (5 × 6) (Imprimir / PDF, como los demás documentos). La lista queda guardada en este equipo
 * hasta vaciarla; precio y nombre se leen del inventario al imprimir, así salen siempre actualizados.
 */
export default function LabelsPage() {
  const { data: products = [], isLoading } = useInventory()
  const { data: biz } = useBusinessInfo()
  const queue = useLabelQueue()
  const [format, setFormat] = useState<LabelFormat>(readFormat)
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [printed, setPrinted] = useState(false)

  useEffect(() => { try { localStorage.setItem(FORMAT_KEY, format) } catch { /* modo privado */ } }, [format])
  // Después de imprimir se ofrece vaciar la lista (el navegador no dice si de verdad se imprimió).
  useEffect(() => {
    const after = () => setPrinted(true)
    window.addEventListener('afterprint', after)
    return () => window.removeEventListener('afterprint', after)
  }, [])

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const lines = queue.map(q => ({ ...q, product: byId.get(q.id) }))
  // Productos que ya no existen (eliminados): no se imprimen y se pueden quitar.
  const valid = lines.filter((l): l is typeof l & { product: InventoryProduct } => !!l.product)
  const size = perPage(format)
  const pages = paginate(valid.map(l => ({ data: toLabel(l.product), copies: l.copies })), size)
  const total = valid.reduce((s, l) => s + l.copies, 0)
  const noPrice = valid.filter(l => l.product.price == null).length
  const free = pages.length ? pages.length * size - total : 0

  const textScore = useProductMatcher(query)
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    // "E2-N5", "e2n5" o "E4": lo que está en esa ubicación o mueble, como en el inventario.
    const loc = /^[a-z]\d/i.test(q) ? normalizeCode(q) : null
    const score = (p: InventoryProduct) => p.barcode === q || p.sku.toLowerCase() === q ? 100
      : (textScore?.(p) ?? 0) || ((p.barcode?.includes(q) ?? false)
          || (loc != null && p.locations.some(l => l.code === loc || l.code.startsWith(`${loc}-`))) ? 1 : 0)
    return rankBy(products.filter(p => score(p) > 0), score)
  }, [products, query, textScore])
  const notQueued = results.filter(p => !labelQueue.has(p.id))

  function add(p: InventoryProduct) {
    if (labelQueue.add([p.id])) toast.success(`Agregada: ${p.name}`, { duration: 1800 })
    else toast(`${p.name} ya está en la lista`, { action: { label: '+1 copia', onClick: () => bump(p.id, 1) } })
  }
  function bump(id: string, d: number) {
    const cur = labelQueue.get().find(i => i.id === id)
    if (cur) labelQueue.setCopies(id, cur.copies + d)
  }
  function addAll() {
    const n = labelQueue.add(notQueued.map(p => p.id))
    toast.success(`${n} agregada${n === 1 ? '' : 's'}`)
    setQuery('')
  }
  function remove(id: string) {
    const before = labelQueue.get()
    labelQueue.remove(id)
    toast('Quitada de la lista', { action: { label: 'Deshacer', onClick: () => labelQueue.restore(before) } })
  }
  function clearAll() {
    const before = labelQueue.get()
    labelQueue.clear(); setPrinted(false)
    toast('Lista vaciada', { duration: 6000, action: { label: 'Deshacer', onClick: () => labelQueue.restore(before) } })
  }
  function onCode(raw: string) {
    setScanning(false)
    const code = raw.trim()
    const hit = products.find(p => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())
    if (hit) add(hit)
    else toast.warning(`El código ${code} no está en el inventario`)
  }


  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-4 print:max-w-none print:space-y-0 print:p-0">
      {/* Al imprimir: hoja sin márgenes del navegador (sin fecha ni dirección arriba); cada hoja trae los suyos. */}
      <style>{'@page { size: A4; margin: 0; }'}</style>

      <div className="space-y-3 print:hidden">
        <PageHeader title="Etiquetas de precio" back="/inventario" backLabel="Inventario">
          <button onClick={() => window.print()} disabled={!total}
                  className="flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-700 px-4 text-sm font-medium text-white disabled:opacity-50">
            <Printer className="size-4" />Imprimir / PDF
          </button>
        </PageHeader>

        {printed && total > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <span className="mr-auto">¿Salieron bien? Vacía la lista para empezar la próxima tanda.</span>
            <button onClick={() => setPrinted(false)} className="min-h-11 rounded-lg px-3 underline">Seguir con la lista</button>
            <button onClick={clearAll} className="min-h-11 rounded-lg bg-green-700 px-4 font-medium text-white">Vaciar lista</button>
          </div>
        )}

        {/* Buscar o escanear para agregar */}
        <section className="space-y-2 rounded-lg bg-white p-3 shadow">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-stone-400"><Search className="size-5" /></span>
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Agregar: nombre, código o ubicación"
                     onKeyDown={e => {
                       if (e.key !== 'Enter') return
                       // Lector USB: el código exacto se agrega solo.
                       const exact = products.find(p => p.barcode === query.trim() || p.sku.toLowerCase() === query.trim().toLowerCase())
                       if (exact) { add(exact); setQuery('') }
                     }}
                     enterKeyHint="search" aria-label="Buscar producto para agregar"
                     className="min-h-12 w-full rounded-lg border bg-white pl-10 pr-11 text-base [&::-webkit-search-cancel-button]:hidden" />
              {query && <button onClick={() => setQuery('')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-500" aria-label="Limpiar búsqueda">✕</button>}
            </div>
            <button onClick={() => setScanning(true)} className="grid min-h-12 w-12 shrink-0 place-items-center rounded-lg bg-amber-700 text-white" aria-label="Escanear código de barras">
              <ScanBarcode className="size-6" />
            </button>
          </div>

          {query.trim() && (
            <>
              <ul className="divide-y rounded-lg border">
                {results.slice(0, RESULTS).map(p => {
                  const queued = queue.some(q => q.id === p.id)
                  return (
                    <li key={p.id}>
                      <button onClick={() => add(p)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left active:bg-amber-50 md:hover:bg-amber-50">
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm font-medium break-words">{p.name}</div>
                          <div className="text-xs text-stone-500">
                            {p.sku}{p.locations[0] && <> · <span className="font-mono">{p.locations[0].code}</span></>}
                            {!p.active && <> · inactivo</>}
                          </div>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums">{p.price != null ? money(p.price) : <span className="text-stone-400">sin precio</span>}</span>
                        {queued
                          ? <span className="shrink-0 rounded bg-green-100 px-1.5 text-xs text-green-800">✓ en la lista</span>
                          : <Plus aria-label="Agregar" className="size-5 shrink-0 text-amber-700" />}
                      </button>
                    </li>
                  )
                })}
                {!results.length && <li className="p-3 text-center text-sm text-stone-500">{isLoading ? 'Cargando…' : `Sin resultados para «${query.trim()}».`}</li>}
              </ul>
              {notQueued.length > 1 && notQueued.length <= MAX_BULK && (
                <button onClick={addAll} className="min-h-11 w-full rounded-lg border border-dashed text-sm text-amber-800">
                  + Agregar {notQueued.length === results.length ? 'los' : 'los otros'} {notQueued.length} resultados
                </button>
              )}
              {results.length > RESULTS && notQueued.length > MAX_BULK && (
                <p className="text-center text-xs text-stone-500">{results.length} resultados: afina la búsqueda para agregarlos de una vez.</p>
              )}
            </>
          )}
        </section>

        {/* La lista */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">
              Lista <span className="font-normal text-stone-500">· {total} etiqueta{total === 1 ? '' : 's'} · {pages.length} hoja{pages.length === 1 ? '' : 's'}</span>
            </h2>
            {queue.length > 0 && (
              <button onClick={clearAll} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-red-700"><Trash2 className="size-4" />Vaciar</button>
            )}
          </div>
          {!queue.length && (
            <p className="rounded-lg bg-white p-6 text-center text-sm text-stone-500 shadow">
              Busca o escanea productos para agregarlos. También desde el inventario: botón <b>Etiqueta</b> en la ficha del producto.
            </p>
          )}
          {queue.length > 0 && (
            <ul className="divide-y overflow-hidden rounded-lg bg-white shadow">
              {lines.map(l => {
                const p = l.product
                return (
                  <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-medium break-words">{p?.name ?? 'Producto eliminado'}</div>
                      {p && (
                        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-stone-500">
                          <span className={p.price == null ? 'rounded bg-yellow-100 px-1 text-yellow-800' : 'tabular-nums text-stone-700'}>
                            {p.price != null ? `${money(p.price)} ${unitText(p.unit)}` : 'sin precio: sale en blanco'}
                          </span>
                          {p.locations[0] && <span className="font-mono"><MapPin className="inline size-3.5 align-[-0.15em]" />{p.locations[0].code}</span>}
                          {!p.active && <span className="rounded bg-stone-200 px-1">inactivo</span>}
                        </div>
                      )}
                    </div>
                    {p && (
                      <div className="flex shrink-0 items-center rounded-lg border" role="group" aria-label={`Copias de ${p.name}`}>
                        <button onClick={() => bump(l.id, -1)} disabled={l.copies <= 1} aria-label="Una copia menos" className="grid size-11 place-items-center disabled:opacity-30"><Minus className="size-4" /></button>
                        <span className="w-7 text-center tabular-nums" aria-live="polite">{l.copies}</span>
                        <button onClick={() => bump(l.id, 1)} disabled={l.copies >= MAX_COPIES} aria-label="Una copia más" className="grid size-11 place-items-center disabled:opacity-30"><Plus className="size-4" /></button>
                      </div>
                    )}
                    <button onClick={() => remove(l.id)} aria-label={`Quitar ${p?.name ?? 'producto'}`} className="grid size-11 shrink-0 place-items-center text-stone-500"><X className="size-5" /></button>
                  </li>
                )
              })}
            </ul>
          )}
          {noPrice > 0 && (
            <p className="text-xs text-yellow-800">{noPrice} sin precio: su etiqueta sale con el precio en blanco para escribirlo a mano.</p>
          )}
        </section>

        {total > 0 && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto font-semibold">Vista previa</h2>
              {(Object.keys(FORMATS) as LabelFormat[]).map(f => (
                <button key={f} onClick={() => setFormat(f)} className={chip(format === f)} aria-pressed={format === f}>
                  {FORMATS[f].label} <span className={format === f ? 'text-amber-100' : 'text-stone-500'}>· {FORMATS[f].size}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-500">
              {size} por hoja A4{free > 0 ? `; en la última quedan ${free} libres` : ''}. En el diálogo de impresión elige «Guardar como PDF»
              o la impresora, con escala al 100 %. Las líneas punteadas son para cortar.
            </p>
          </section>
        )}
      </div>

      {total > 0 && <LabelSheets pages={pages} format={format} business={biz?.name ?? 'La Constructora'} />}

      {scanning && <BarcodeScanner title="Agregar etiqueta" onClose={() => setScanning(false)} onDetected={onCode} />}
    </div>
  )
}

/** Las hojas A4 tal como se imprimen (en pantalla, a escala del ancho disponible). */
export function LabelSheets({ pages, format, business }: { pages: LabelData[][]; format: LabelFormat; business: string }) {
  const { cols, maxPres } = FORMATS[format]
  return (
    <div className="label-sheets mx-auto max-w-3xl space-y-4 print:max-w-none print:space-y-0">
      {pages.map((page, n) => (
        <div key={n} className="label-page shadow print:shadow-none" data-format={format} aria-label={`Hoja ${n + 1} de ${pages.length}`}>
          <div className="label-grid">
            {page.map((l, i) => (
              <PriceLabel key={i} label={l} business={business} maxPres={maxPres} top={i < cols} left={i % cols === 0} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PriceLabel({ label: l, business, maxPres, top, left }: { label: LabelData; business: string; maxPres: number; top: boolean; left: boolean }) {
  const brand = brandLine(l.name, l.brand)
  const pres = l.presentations.slice(0, maxPres)
  return (
    <div className="label" data-top={top || undefined} data-left={left || undefined}>
      <div className="label-head"><span className="truncate">{business}</span></div>
      <div className="label-name" data-tier={nameTier(l.name)}>{l.name}</div>
      {brand && <div className="label-brand">{brand}</div>}
      {pres.length > 0 && (
        <div className="label-pres">
          {pres.map(p => <span key={p.name}>{presentationText(p, l.unit)} <b>S/ {amount(p.price)}</b></span>)}
        </div>
      )}
      <div className="label-price">
        <span className="cur">S/</span>
        {l.price != null
          ? <span className="num" data-long={amount(l.price).length > 6 || undefined}>{amount(l.price)}</span>
          : <span className="blank" />}
        <span className="unit">{unitText(l.unit)}</span>
      </div>
      <div className="label-foot">{l.sku}</div>
    </div>
  )
}
