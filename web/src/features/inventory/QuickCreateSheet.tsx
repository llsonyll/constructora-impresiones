import { useState, type FormEvent } from 'react'
import CategoryOptions from './CategoryOptions'
import { useQueryClient } from '@tanstack/react-query'
import BarcodeScanner from '@/components/BarcodeScanner'
import PhotoInput from '@/components/PhotoInput'
import Sheet from '@/components/Sheet'
import { uploadProductImage } from '@/lib/images'
import { friendlyError, inventoryKeys, quickCreateProduct, useCategories } from './api'

export type CreatedProduct = Awaited<ReturnType<typeof quickCreateProduct>>

interface Props {
  initialName?: string
  initialBarcode?: string
  /** En el POS el producto se vende al instante, así que el precio es obligatorio. */
  requirePrice?: boolean
  /** Categoría sugerida (en el POS, la que está elegida o Librería en la caja de copias). */
  initialCategory?: number | null
  onCreated: (p: CreatedProduct) => void
  onClose: () => void
}

const UNITS = ['und', 'm', 'kg', 'par', 'juego', 'paquete', 'bolsa', 'caja', 'rollo']

/** Alta rápida desde el celular: nombre + precio (+ código, foto, categoría opcionales). */
export default function QuickCreateSheet({ initialName = '', initialBarcode = '', requirePrice = false, initialCategory = null, onCreated, onClose }: Props) {
  const qc = useQueryClient()
  const { data: categories = [] } = useCategories()
  const [name, setName] = useState(initialName)
  const [price, setPrice] = useState('')
  const [barcode, setBarcode] = useState(initialBarcode)
  const initialCat = initialCategory?.toString() ?? ''
  const [category, setCategory] = useState(initialCat)
  const [unit, setUnit] = useState('und')
  const [photo, setPhoto] = useState<File | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const p = price.trim() ? Number(price.replace(',', '.')) : null
    if (p != null && (Number.isNaN(p) || p < 0)) return setError('Precio inválido')
    setSaving(true); setError('')
    try {
      const created = await quickCreateProduct({
        name: name.trim().toUpperCase(), price: p, barcode: barcode.trim() || null,
        category_id: category ? Number(category) : null, unit,
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
  const dirty = name !== initialName || price !== '' || barcode !== initialBarcode || category !== initialCat || unit !== 'und' || !!photo
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
        <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="Nombre (ej. TUBO PVC 1/2 PAVCO)" required autoFocus={!initialName} />
        <div className="flex gap-2">
          <input className={input} value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal"
                 placeholder={requirePrice ? 'Precio S/ (con IGV)' : 'Precio S/ (opcional)'} required={requirePrice}
                 autoFocus={!!initialName} />
          <select className="rounded-lg border p-3 text-base" value={unit} onChange={e => setUnit(e.target.value)}>
            {UNITS.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <input className={input} value={barcode} onChange={e => setBarcode(e.target.value)} inputMode="numeric" placeholder="Código de barras (opcional)" />
          <button type="button" onClick={() => setScanning(true)} className="min-w-12 shrink-0 rounded-lg border px-3" aria-label="Escanear código">📷</button>
        </div>
        <select className={input} value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Categoría (opcional)</option>
          <CategoryOptions categories={categories} />
        </select>
        <PhotoInput file={photo} onChange={setPhoto} />
        <p className="text-xs text-stone-500">Se crea con SKU automático y marcado “por revisar” para completar costo y categoría luego.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={saving || !name.trim() || (requirePrice && !price.trim())} className="w-full rounded-lg bg-amber-700 p-3 font-medium text-white disabled:opacity-50">
          {saving ? 'Creando…' : 'Crear producto'}
        </button>
      </form>
    </Sheet>
    {/* Fuera de la hoja: el panel de Vaul usa transform y atraparía a un hijo `fixed`; la hoja se oculta mientras tanto. */}
    {scanning && <BarcodeScanner onClose={() => setScanning(false)} onDetected={c => { setBarcode(c); setScanning(false) }} />}
    </>
  )
}
