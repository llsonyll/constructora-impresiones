import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ScanBarcode } from 'lucide-react'
import CategoryOptions from './CategoryOptions'
import { useQueryClient } from '@tanstack/react-query'
import BarcodeScanner from '@/components/BarcodeScanner'
import PhotoInput from '@/components/PhotoInput'
import Sheet from '@/components/Sheet'
import { uploadProductImage } from '@/lib/images'
import { money } from '@/lib/format'
import { normalize } from '@/lib/search'
import { findSameName, friendlyError, inventoryKeys, quickCreateProduct, useCategories } from './api'

export type CreatedProduct = Awaited<ReturnType<typeof quickCreateProduct>>

interface Props {
  initialName?: string
  initialBarcode?: string
  /** En el POS el producto se vende al instante, así que el precio es obligatorio. */
  requirePrice?: boolean
  /** Categoría sugerida (en el POS, la que está elegida o Librería en la caja de copias). */
  initialCategory?: number | null
  /** Marca sugerida: si se pasa, la hoja muestra el campo Marca (en Surtido, la de la línea). */
  initialBrand?: string
  initialUnit?: string
  /** Proveedor con que nace el producto (no se muestra). */
  providerId?: string | null
  /** Texto arriba del formulario (de dónde sale el alta). */
  intro?: ReactNode
  submitLabel?: string
  /** El producto creado o, si ya existía con ese nombre y se eligió "Usar este", el existente (`existing`). */
  onCreated: (p: CreatedProduct, existing?: boolean) => void
  onClose: () => void
}

const UNITS = ['und', 'm', 'kg', 'par', 'juego', 'paquete', 'bolsa', 'caja', 'rollo']

/** Alta rápida desde el celular: nombre + precio (+ código, foto, categoría opcionales). */
export default function QuickCreateSheet({ initialName = '', initialBarcode = '', requirePrice = false, initialCategory = null, initialBrand, initialUnit = 'und', providerId = null, intro, submitLabel = 'Crear producto', onCreated, onClose }: Props) {
  const qc = useQueryClient()
  const { data: categories = [] } = useCategories()
  const [name, setName] = useState(initialName)
  const [price, setPrice] = useState('')
  const [barcode, setBarcode] = useState(initialBarcode)
  const initialCat = initialCategory?.toString() ?? ''
  const [category, setCategory] = useState(initialCat)
  const [unit, setUnit] = useState(initialUnit)
  const [brand, setBrand] = useState(initialBrand ?? '')
  const [photo, setPhoto] = useState<File | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Productos con el mismo nombre (activos o no). `ackFor`: nombre para el que ya se confirmó "crear otro igual".
  const [dupes, setDupes] = useState<CreatedProduct[]>([])
  const [dupesFor, setDupesFor] = useState('')
  const [ackFor, setAckFor] = useState('')
  const key = normalize(name)

  useEffect(() => {
    if (key.length < 3) { setDupes([]); setDupesFor(key); return }
    let stale = false
    const t = setTimeout(() => {
      findSameName(name).then(d => { if (!stale) { setDupes(d); setDupesFor(key) } }).catch(() => { /* sin red: no se avisa */ })
    }, 400)
    return () => { stale = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const visibleDupes = dupesFor === key ? dupes : []
  /** En Ventas solo sirve uno que se pueda vender (activo y con precio). */
  const usable = (p: CreatedProduct) => !requirePrice || (p.active && p.price != null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const p = price.trim() ? Number(price.replace(',', '.')) : null
    if (p != null && (Number.isNaN(p) || p < 0)) return setError('Precio inválido')
    setSaving(true); setError('')
    try {
      // Comprobación final, por si se tocó Crear antes de que llegara el aviso. Con el aviso a la vista, el botón
      // ya dice "Crear otro igual de todas formas": ese toque crea.
      if (ackFor !== key && !visibleDupes.length) {
        const d = await findSameName(name).catch(() => [])
        if (d.length) { setDupes(d); setDupesFor(key); setAckFor(key); return }
      }
      const created = await quickCreateProduct({
        name: name.trim().toUpperCase(), price: p, barcode: barcode.trim() || null,
        category_id: category ? Number(category) : null, unit,
        ...(initialBrand !== undefined && { brand: brand.trim().toUpperCase() || null }),
        ...(providerId && { provider_id: providerId }),
      })
      if (photo) {
        try { created.image_path = await uploadProductImage(created.id, photo) }
        catch (err) { alert(`Producto creado, pero la foto no se subió: ${friendlyError(err)}`) }
      }
      qc.invalidateQueries({ queryKey: inventoryKeys.products })
      onCreated(created)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  // Tocar fuera o "atrás" no debe perder lo escrito sin preguntar.
  const dirty = name !== initialName || price !== '' || barcode !== initialBarcode || category !== initialCat || unit !== initialUnit || brand !== (initialBrand ?? '') || !!photo
  const requestClose = () => { if (!dirty || confirm('¿Descartar este producto nuevo?')) onClose() }

  const input = 'w-full rounded-lg border p-3 text-base'
  return (
    <>
    {/* Con cambios no se cierra arrastrando: Vaul ya habría deslizado la hoja antes del "¿Descartar?". */}
    <Sheet onClose={requestClose} label="Nuevo producto" hidden={scanning} dismissible={!dirty}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex items-center">
          <h2 className="flex-1 text-lg font-semibold">Nuevo producto</h2>
          <button type="button" onClick={requestClose} aria-label="Cerrar" className="-mr-2 grid size-11 place-items-center text-xl">✕</button>
        </div>
        {intro}
        <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="Nombre (ej. TUBO PVC 1/2 PAVCO)" required autoFocus={!initialName} />
        <div className="flex gap-2">
          <input className={input} value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal"
                 placeholder={requirePrice ? 'Precio S/ (con IGV)' : 'Precio S/ (opcional)'} required={requirePrice}
                 autoFocus={!!initialName} />
          <select className="rounded-lg border p-3 text-base" value={unit} onChange={e => setUnit(e.target.value)}>
            {[...new Set([...UNITS, initialUnit])].map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <input className={input} value={barcode} onChange={e => setBarcode(e.target.value)} inputMode="numeric" placeholder="Código de barras (opcional)" />
          <button type="button" onClick={() => setScanning(true)} className="min-w-12 shrink-0 rounded-lg border px-3" aria-label="Escanear código"><ScanBarcode className="mx-auto size-6" /></button>
        </div>
        {visibleDupes.length > 0 && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <p className="font-medium">Ya existe un producto con este nombre:</p>
            <ul className="space-y-2">
              {visibleDupes.map(p => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{p.name}</span>
                    <span className="text-xs text-amber-800">
                      {p.sku} · {p.price != null ? money(p.price) : 'sin precio'}{!p.active && ' · inactivo'}
                      {p.track_stock && ` · stock ${Number(p.stock)}`}
                    </span>
                  </span>
                  {usable(p)
                    ? <button type="button" onClick={() => onCreated(p, true)} className="min-h-10 shrink-0 rounded-lg bg-amber-700 px-3 text-white">Usar este</button>
                    : <span className="max-w-[9rem] shrink-0 text-right text-xs">Sin precio: pide que se lo pongan en Inventario</span>}
                </li>
              ))}
            </ul>
            <p className="text-xs">Si de verdad es otro producto, cambia el nombre para distinguirlo.</p>
          </div>
        )}
        {initialBrand !== undefined && <input className={input} value={brand} onChange={e => setBrand(e.target.value)} placeholder="Marca (opcional)" aria-label="Marca" />}
        <select className={input} value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Categoría (opcional)</option>
          <CategoryOptions categories={categories} />
        </select>
        <PhotoInput file={photo} onChange={setPhoto} />
        <p className="text-xs text-stone-500">Se crea con SKU automático y marcado “por revisar” para completar costo y categoría luego.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={saving || !name.trim() || (requirePrice && !price.trim())} className={`w-full rounded-lg p-3 font-medium disabled:opacity-50 ${visibleDupes.length ? 'border border-amber-700 bg-white text-amber-800' : 'bg-amber-700 text-white'}`}>
          {saving ? 'Creando…' : visibleDupes.length ? 'Crear otro igual de todas formas' : submitLabel}
        </button>
      </form>
    </Sheet>
    {/* Fuera de la hoja: el panel de Vaul usa transform y atraparía a un hijo `fixed`; la hoja se oculta mientras tanto. */}
    {scanning && <BarcodeScanner onClose={() => setScanning(false)} onDetected={c => { setBarcode(c); setScanning(false) }} />}
    </>
  )
}
