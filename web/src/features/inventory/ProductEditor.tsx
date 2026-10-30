import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ScanBarcode } from 'lucide-react'
import ProductLocations from '@/features/locations/ProductLocations'
import CategoryOptions from './CategoryOptions'
import { useQueryClient } from '@tanstack/react-query'
import BarcodeScanner from '@/components/BarcodeScanner'
import PhotoInput from '@/components/PhotoInput'
import { imageUrl, uploadProductImage } from '@/lib/images'
import { money } from '@/lib/format'
import { useOverlay } from '@/lib/overlay'
import type { JobSource, Presentation } from '@/types/domain'
import {
  friendlyError, inventoryKeys, type InventoryProduct, type ProductInput,
  useAdjustStock, useCategories, useCostHistory, useMovements, useProviders, useSaveProduct,
} from './api'

const UNITS = ['und', 'hoja', 'm', 'kg', 'par', 'juego', 'paquete', 'bolsa', 'caja', 'rollo', 'galón', 'litro']
const MARKUPS = [0.3, 0.35, 0.4, 0.5]
const REASONS: Record<string, string> = {
  venta: 'Venta', compra: 'Compra', ajuste: 'Ajuste', devolucion: 'Devolución', anulacion_venta: 'Venta anulada',
}

/** Precio sugerido = costo × (1 + markup), redondeado a S/0.10 (o S/0.01 si es menor a S/1). */
export const suggestPrice = (cost: number, markup: number) => {
  const p = cost * (1 + markup)
  return p >= 1 ? Math.ceil(p * 10) / 10 : Math.ceil(p * 100) / 100
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

/** Presentaciones en el formulario (texto mientras se escribe). */
type PresRow = { name: string; qty: string; price: string }
const PRESET_PRES: { name: string; qty: number }[] = [
  { name: 'Media docena', qty: 6 }, { name: 'Docena', qty: 12 }, { name: 'Ciento', qty: 100 },
  { name: 'Bolsa', qty: 0 }, { name: 'Caja', qty: 0 }, { name: 'Paquete', qty: 0 },
]

/** Filas válidas → presentaciones; error si alguna está a medias o repetida. Filas vacías se ignoran. */
function parsePresentations(rows: PresRow[]): { list: Presentation[]; error: string } {
  const list: Presentation[] = []
  for (const r of rows) {
    if (!r.name.trim() && !r.qty.trim() && !r.price.trim()) continue
    const qty = num(r.qty), price = num(r.price)
    if (!r.name.trim() || qty == null || !(qty > 0) || price == null || !(price > 0))
      return { list, error: `Presentación «${r.name.trim() || 'sin nombre'}»: completa nombre, cantidad y precio (mayores a 0).` }
    if (qty === 1) return { list, error: `Presentación «${r.name.trim()}»: la cantidad 1 ya es la unidad; usa el precio de venta.` }
    if (list.some(p => p.name.toLowerCase() === r.name.trim().toLowerCase())) return { list, error: `La presentación «${r.name.trim()}» está repetida.` }
    list.push({ name: r.name.trim(), qty, price: Math.round(price * 100) / 100 })
  }
  return { list, error: '' }
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`block text-sm ${className}`}><span className="mb-1 block text-xs text-stone-500">{label}</span>{children}</label>
}
const input = 'min-h-11 w-full rounded border px-2 py-2 text-base sm:text-sm'

interface Props {
  product: InventoryProduct | null
  /** Código escaneado que no existía: precarga el alta de un producto nuevo. */
  initialBarcode?: string
  /** Alta desde una búsqueda sin resultados: el nombre buscado. */
  initialName?: string
  onClose: () => void
  onSaved: (id: string, name: string) => void
}

export default function ProductEditor({ product, initialBarcode = '', initialName = '', onClose, onSaved }: Props) {
  const { data: categories = [] } = useCategories()
  const { data: providers = [] } = useProviders()
  const save = useSaveProduct()

  const [initial] = useState(() => ({
    sku: product?.sku ?? '', name: product?.name ?? initialName.toUpperCase(), brand: product?.brand ?? '', barcode: product?.barcode ?? initialBarcode,
    category_id: product?.category_id?.toString() ?? '', provider_id: product?.provider_id ?? '',
    unit: product?.unit ?? 'und', price: product?.price?.toString() ?? '', cost: product?.cost?.toString() ?? '',
    min_stock: product?.min_stock?.toString() ?? '0', active: product?.active ?? false,
    needs_review: product?.needs_review ?? false, notes: product?.notes ?? '',
    track_stock: product?.track_stock ?? true, job_sources: product?.job_sources ?? [],
    job_color: product?.job_color == null ? 'any' : product.job_color ? 'color' : 'bn',
    job_duplex: product?.job_duplex ?? false, job_keywords: (product?.job_keywords ?? []).join(', '),
    presentations: (product?.presentations ?? []).map(p => ({ name: p.name, qty: String(p.qty), price: p.price.toFixed(2) })) as PresRow[],
    aliases: (product?.aliases ?? []).join(', '),
  }))
  const [f, setF] = useState(initial)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const [scanning, setScanning] = useState(false)

  // Cerrar con cambios sin guardar pide confirmación (clic fuera, Esc, atrás, ✕ o Cancelar).
  // Con el escáner abierto, Esc/atrás cierran solo el escáner (es la capa de arriba).
  const requestClose = () => {
    if (!dirty || confirm('Tienes cambios sin guardar. ¿Descartarlos?')) onClose()
  }
  useOverlay(requestClose)
  // Solo cuenta como "clic fuera" si el clic empezó en el fondo: seleccionar texto en un campo y
  // soltar el mouse fuera del panel también dispara click en el fondo y antes cerraba el editor.
  const downOnBackdrop = useRef(false)

  const price = num(f.price), cost = num(f.cost)
  const hasPrice = price != null && !Number.isNaN(price)
  const m = hasPrice && price && cost != null ? (price - cost) / price : null

  const setPrice = (v: string) => {
    // Poner precio a un producto que no tenía lo activa (para que aparezca en el POS); quitarlo lo desactiva.
    setF(s => {
      const had = num(s.price) != null, has = num(v) != null
      return { ...s, price: v, active: has ? (had ? s.active : true) : false }
    })
  }

  const pres = parsePresentations(f.presentations)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pres.error) return
    const payload: ProductInput = {
      id: product?.id, sku: f.sku.trim(), name: f.name.trim(), brand: f.brand.trim() || null,
      barcode: f.barcode.trim() || null, category_id: f.category_id ? Number(f.category_id) : null,
      provider_id: f.provider_id || null, unit: f.unit, price: hasPrice ? price : null,
      cost: cost != null && !Number.isNaN(cost) ? cost : null, min_stock: num(f.min_stock) ?? 0,
      active: hasPrice && f.active, needs_review: f.needs_review, notes: f.notes.trim() || null,
      track_stock: f.track_stock, job_sources: f.job_sources, job_duplex: f.job_duplex,
      job_color: f.job_color === 'any' ? null : f.job_color === 'color',
      job_keywords: f.job_keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
      presentations: pres.list,
      aliases: [...new Set(f.aliases.split(',').map(a => a.trim().toLowerCase()).filter(Boolean))],
    }
    try {
      const id = await save.mutateAsync(payload)
      onSaved(id, payload.name)
    } catch { /* se muestra abajo */ }
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30"
         onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
         onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget) requestClose() }}>
      <div className="h-full w-full max-w-xl overflow-y-auto overscroll-contain bg-white px-safe-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-safe-4 shadow-xl sm:px-5">
        <div className="mb-4 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">
            {product ? 'Editar producto' : 'Nuevo producto'}
            {dirty && <span className="ml-2 align-middle text-xs font-normal text-amber-700">● sin guardar</span>}
          </h2>
          <button onClick={requestClose} aria-label="Cerrar" className="-mr-2 grid size-11 place-items-center text-xl">✕</button>
        </div>

        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
          <Field label="Nombre" className="col-span-2">
            <input className={input} value={f.name} onChange={e => set('name', e.target.value)} required />
          </Field>
          <Field label="También se conoce como (separados por coma)" className="col-span-2">
            <input className={input} value={f.aliases} onChange={e => set('aliases', e.target.value)} placeholder="cintillo, precinto" />
          </Field>
          <Field label="Precio de venta (con IGV)">
            <input className={`${input} font-semibold`} inputMode="decimal" value={f.price} onChange={e => setPrice(e.target.value)} placeholder="Sin precio" />
          </Field>
          <Field label="Último costo (con IGV)">
            <input className={input} inputMode="decimal" value={f.cost} onChange={e => set('cost', e.target.value)} />
          </Field>
          {cost != null && !Number.isNaN(cost) && cost > 0 && (
            <div className="col-span-2 text-xs">
              <span className="text-stone-500">Sugerir precio (recargo sobre costo):</span>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {MARKUPS.map(mk => (
                  <button type="button" key={mk} onClick={() => setPrice(suggestPrice(cost, mk).toFixed(2))}
                          className="min-h-11 rounded border px-1 py-1 hover:bg-amber-50">
                    +{mk * 100}%<br /><b>{money(suggestPrice(cost, mk))}</b>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className={`col-span-2 text-sm ${m != null && m < 0.15 ? 'text-red-600' : 'text-stone-600'}`}>
            Margen: {m != null ? `${Math.round(m * 100)}% (${money(price! - cost!)} por ${f.unit})` : '—'}
          </p>

          <PresentationFields rows={f.presentations} unit={f.unit} basePrice={hasPrice ? price : null} error={pres.error}
                              onChange={rows => set('presentations', rows)} />

          <Field label="SKU">
            <input className={input} value={f.sku} onChange={e => set('sku', e.target.value)}
                   required={!!product} placeholder={product ? '' : 'Automático'} />
          </Field>
          <Field label="Código de barras" className="max-sm:col-span-2">
            <div className="flex gap-1">
              <input className={input} value={f.barcode} onChange={e => set('barcode', e.target.value)} inputMode="numeric" />
              <button type="button" onClick={() => setScanning(true)} className="min-w-11 shrink-0 rounded border px-2" aria-label="Escanear código"><ScanBarcode className="mx-auto size-6" /></button>
            </div>
          </Field>
          <Field label="Marca"><input className={input} value={f.brand} onChange={e => set('brand', e.target.value)} /></Field>
          <Field label="Unidad">
            <select className={input} value={f.unit} onChange={e => set('unit', e.target.value)}>
              {[...new Set([f.unit, ...UNITS])].map(u => <option key={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Categoría" className="max-sm:col-span-2">
            <select className={input} value={f.category_id} onChange={e => set('category_id', e.target.value)}>
              <option value="">—</option>
              <CategoryOptions categories={categories} />
            </select>
          </Field>
          <Field label="Proveedor" className="max-sm:col-span-2">
            <select className={input} value={f.provider_id} onChange={e => set('provider_id', e.target.value)}>
              <option value="">—</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          {f.track_stock ? (
            <Field label="Stock mínimo (alerta)">
              <input className={input} inputMode="decimal" value={f.min_stock} onChange={e => set('min_stock', e.target.value)} />
            </Field>
          ) : <div className="max-sm:hidden" />}
          <div className="flex flex-col justify-end gap-2 text-sm max-sm:col-span-2">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={!f.track_stock} onChange={e => set('track_stock', !e.target.checked)} />
              Servicio (no lleva stock)
            </label>
            <label className={`flex min-h-11 items-center gap-2 ${hasPrice ? '' : 'opacity-50'}`} title={hasPrice ? '' : 'Pon un precio para activarlo'}>
              <input type="checkbox" className="size-5" checked={hasPrice && f.active} disabled={!hasPrice} onChange={e => set('active', e.target.checked)} />
              Activo (visible en el POS)
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={f.needs_review} onChange={e => set('needs_review', e.target.checked)} />
              Marcar para revisar
            </label>
          </div>
          <JobFields f={f} set={set} />
          <Field label="Notas" className="col-span-2">
            <textarea className={input} rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} />
          </Field>

          {save.error && <p className="col-span-2 text-sm text-red-600">{friendlyError(save.error)}</p>}
          {/* Fija al pie de la hoja: guardar sin bajar hasta el final del formulario. */}
          <div className="sticky bottom-0 z-10 col-span-2 -mx-3 flex justify-end gap-2 border-t bg-white px-3 py-3 sm:-mx-5 sm:px-5">
            <button type="button" onClick={requestClose} className="min-h-12 rounded-lg border px-4 max-sm:flex-1">Cancelar</button>
            <button disabled={save.isPending || !!pres.error} className="min-h-12 rounded-lg bg-amber-700 px-6 font-medium text-white disabled:opacity-50 max-sm:flex-[2]">
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>

        {product && product.track_stock && <ProductLocations product={product} />}
        {product && <PhotoSection product={product} />}
        {product && product.track_stock && <StockSection product={product} />}
        {product && <CostHistorySection product={product} />}
        {scanning && <BarcodeScanner onClose={() => setScanning(false)} onDetected={c => { set('barcode', c); setScanning(false) }} />}
      </div>
    </div>
  )
}

/**
 * Venta por docena, ciento, bolsa…: cada presentación lleva `qty` unidades base y su precio. En Ventas, al tocar
 * el producto se elige la presentación; el stock baja en unidades base (1 docena = 12).
 */
function PresentationFields({ rows, unit, basePrice, error, onChange }: {
  rows: PresRow[]; unit: string; basePrice: number | null; error: string; onChange: (rows: PresRow[]) => void
}) {
  const setRow = (i: number, patch: Partial<PresRow>) => onChange(rows.map((r, n) => n === i ? { ...r, ...patch } : r))
  const used = new Set(rows.map(r => r.name.trim().toLowerCase()))
  return (
    <details className="col-span-2 rounded border p-3 text-sm" open={rows.length > 0}>
      <summary className="min-h-11 cursor-pointer content-center font-medium">
        Presentaciones (docena, ciento, bolsa…){rows.length > 0 && <span className="ml-1 font-normal text-stone-500">· {rows.length}</span>}
      </summary>
      <p className="mb-2 text-xs text-stone-500">
        Se vende por <b>{unit}</b> al precio de venta y, además, por estas presentaciones. La cantidad va en {unit}: el stock baja eso al venderla.
      </p>
      <ul className="space-y-2">
        {rows.map((r, i) => {
          const qty = num(r.qty), price = num(r.price)
          const per = qty && qty > 0 && price && price > 0 ? price / qty : null
          return (
            <li key={i} className="grid grid-cols-[1fr_5.5rem_6rem_auto] items-end gap-1.5">
              <Field label="Nombre"><input className={input} value={r.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="Docena" aria-label={`Nombre de la presentación ${i + 1}`} /></Field>
              <Field label={`Cant. (${unit})`}><input className={input} inputMode="decimal" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} aria-label={`Cantidad de ${r.name || 'la presentación'}`} /></Field>
              <Field label="Precio"><input className={input} inputMode="decimal" value={r.price} onChange={e => setRow(i, { price: e.target.value })} aria-label={`Precio de ${r.name || 'la presentación'}`} /></Field>
              <button type="button" onClick={() => onChange(rows.filter((_, n) => n !== i))} aria-label={`Quitar ${r.name || 'presentación'}`}
                      className="grid size-11 place-items-center text-stone-500">✕</button>
              {per != null && (
                <p className="col-span-4 -mt-1 text-xs text-stone-500">
                  = {money(per)} por {unit}
                  {basePrice != null && basePrice > 0 && per < basePrice && ` (${Math.round((1 - per / basePrice) * 100)}% menos que suelto)`}
                  {basePrice != null && per > basePrice && <span className="text-amber-700"> · más caro que suelto</span>}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESET_PRES.filter(p => !used.has(p.name.toLowerCase())).map(p => (
          <button type="button" key={p.name} onClick={() => onChange([...rows, { name: p.name, qty: p.qty ? String(p.qty) : '', price: '' }])}
                  className="min-h-11 rounded-full border px-3 text-sm">+ {p.name}{p.qty ? ` (${p.qty})` : ''}</button>
        ))}
        <button type="button" onClick={() => onChange([...rows, { name: '', qty: '', price: '' }])} className="min-h-11 rounded-full border border-dashed px-3 text-sm">+ Otra</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </details>
  )
}

const SOURCES: { id: JobSource; label: string }[] = [
  { id: 'konica-copia', label: 'Copias (Konica)' }, { id: 'pc-print', label: 'Impresiones (PC)' },
]
type JobForm = { job_sources: JobSource[]; job_color: string; job_duplex: boolean; job_keywords: string }

/** Cómo se ofrece el producto al repartir los trabajos que detecta el agente (ver features/print/core.ts). */
function JobFields<F extends JobForm>({ f, set }: { f: F; set: <K extends keyof F>(k: K, v: F[K]) => void }) {
  const toggle = (id: JobSource, on: boolean) =>
    set('job_sources', (on ? [...f.job_sources, id] : f.job_sources.filter(s => s !== id)) as F['job_sources'])
  return (
    <details className="col-span-2 rounded border p-3 text-sm" open={f.job_sources.length > 0}>
      <summary className="min-h-11 cursor-pointer content-center font-medium">Trabajos detectados (impresiones y copias)</summary>
      <p className="mb-2 text-xs text-stone-500">Se ofrece en el panel de impresiones del POS al asignar las hojas de un trabajo del agente.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-wrap gap-4">
          {SOURCES.map(s => (
            <label key={s.id} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={f.job_sources.includes(s.id)} onChange={e => toggle(s.id, e.target.checked)} />
              {s.label}
            </label>
          ))}
        </div>
        <Field label="Color">
          <select className={input} value={f.job_color} onChange={e => set('job_color', e.target.value as F['job_color'])}>
            <option value="any">B/N o color</option><option value="bn">Solo B/N</option><option value="color">Solo color</option>
          </select>
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end">
          <input type="checkbox" className="size-5" checked={f.job_duplex} onChange={e => set('job_duplex', e.target.checked as F['job_duplex'])} />
          Sugerir en doble cara
        </label>
        <Field label="Palabras clave del documento (separadas por coma)" className="col-span-2">
          <input className={input} value={f.job_keywords} onChange={e => set('job_keywords', e.target.value as F['job_keywords'])} placeholder="record, conductor" />
        </Field>
      </div>
    </details>
  )
}

/** La foto se sube al elegirla (no depende de "Guardar"), igual que en "Poner precios". */
export function PhotoSection({ product, className = 'mt-6 border-t pt-4' }: { product: InventoryProduct; className?: string }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function onPhoto(file: File | null) {
    if (!file) return
    setBusy(true); setError('')
    try {
      await uploadProductImage(product.id, file, product.image_path)
      await qc.invalidateQueries({ queryKey: inventoryKeys.products })
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <section className={className}>
      <h3 className="mb-2 font-semibold">Foto</h3>
      <div className={busy ? 'opacity-50' : ''}><PhotoInput file={null} currentUrl={imageUrl(product.image_path)} onChange={onPhoto} /></div>
      {busy && <p className="mt-1 text-xs text-stone-500">Subiendo…</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </section>
  )
}

function StockSection({ product }: { product: InventoryProduct }) {
  const adjust = useAdjustStock()
  const { data: movements = [] } = useMovements(product.id)
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')

  async function onAdjust(e: FormEvent) {
    e.preventDefault()
    const n = num(counted)
    if (n == null || Number.isNaN(n)) return
    try { await adjust.mutateAsync({ productId: product.id, newStock: n, note }); setCounted(''); setNote('') } catch { /* abajo */ }
  }

  return (
    <section className="mt-6 border-t pt-4">
      <h3 className="mb-2 font-semibold">Stock: <span className="tabular-nums">{product.stock} {product.unit}</span></h3>
      <form onSubmit={onAdjust} className="flex flex-wrap items-end gap-2">
        <Field label="Stock contado"><input className={`${input} w-28`} inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} /></Field>
        <Field label="Motivo" className="min-w-0 flex-1"><input className={input} value={note} onChange={e => setNote(e.target.value)} placeholder="Conteo, merma, rotura…" /></Field>
        <button disabled={!counted || adjust.isPending} className="min-h-11 rounded border px-3 text-sm disabled:opacity-50">Ajustar</button>
      </form>
      {adjust.error && <p className="mt-1 text-sm text-red-600">{friendlyError(adjust.error)}</p>}

      <h4 className="mt-4 mb-1 text-sm font-medium text-stone-600">Movimientos recientes</h4>
      <ul className="divide-y text-sm">
        {movements.map(mv => (
          <li key={mv.id} className="flex gap-2 py-1.5">
            <span className="w-24 shrink-0 text-xs text-stone-500">{new Date(mv.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="flex-1">{REASONS[mv.reason]}{mv.note && <span className="text-stone-500"> · {mv.note}</span>}</span>
            <span className={`tabular-nums ${mv.qty < 0 ? 'text-red-600' : 'text-green-700'}`}>{mv.qty > 0 ? '+' : ''}{mv.qty}</span>
          </li>
        ))}
        {!movements.length && <li className="py-2 text-stone-500">Sin movimientos todavía.</li>}
      </ul>
    </section>
  )
}

const COST_SOURCE: Record<string, string> = { compra: 'Compra', manual: 'Manual', inicial: 'Inicial' }

/** Costos de compra en el tiempo; el "Costo" del formulario es solo la referencia (el último). */
function CostHistorySection({ product }: { product: InventoryProduct }) {
  const { data: history = [], isLoading } = useCostHistory([product.id])
  const purchases = history.filter(h => h.source === 'compra').map(h => h.cost)
  return (
    <section className="mt-6 border-t pt-4">
      <h3 className="mb-1 font-semibold">Historial de costos</h3>
      {purchases.length > 1 && (
        <p className="mb-2 text-xs text-stone-500">
          {purchases.length} compras · mín. {money(Math.min(...purchases))} · máx. {money(Math.max(...purchases))}
        </p>
      )}
      <ul className="divide-y text-sm">
        {history.map(h => (
          <li key={h.id} className="flex gap-2 py-1.5">
            <span className="w-24 shrink-0 text-xs text-stone-500">{new Date(h.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
            <span className="min-w-0 flex-1">
              {COST_SOURCE[h.source]}
              <span className="text-stone-500">
                {h.po_number != null && ` · OC-${String(h.po_number).padStart(4, '0')}`}
                {h.provider_name && ` · ${h.provider_name}`}
                {h.qty != null && ` · ${Number(h.qty)} ${product.unit}`}
              </span>
            </span>
            <span className="tabular-nums">{money(h.cost)}</span>
          </li>
        ))}
        {!isLoading && !history.length && <li className="py-2 text-stone-500">Sin costos registrados.</li>}
      </ul>
    </section>
  )
}
