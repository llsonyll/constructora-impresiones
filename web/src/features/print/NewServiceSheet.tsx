import { useState, type FormEvent } from 'react'
import Sheet from '@/components/Sheet'
import { friendlyError } from '@/features/inventory/api'
import { supabase } from '@/lib/supabase'
import type { Product } from '@/types/domain'

export type ServiceKind = 'fotocopia' | 'impresion' | 'otro'

/** Valores iniciales (p. ej. desde un trabajo del agente: tipo y color ya conocidos). */
export interface ServicePrefill { kind?: ServiceKind; color?: boolean | null; duplex?: boolean }

const KINDS: { id: ServiceKind; label: string; hint: string }[] = [
  { id: 'fotocopia', label: 'Fotocopia', hint: 'Copias en la Konica' },
  { id: 'impresion', label: 'Impresión', hint: 'Desde la PC' },
  { id: 'otro', label: 'Otro servicio', hint: 'Escaneo, anillado, trámite…' },
]

const input = 'min-h-11 w-full rounded border px-2 text-base'

/**
 * Alta de un servicio de la caja Copias desde Ventas (admin y cajero) con la RPC `create_copy_service`:
 * queda sin stock, en Fotocopias o Impresiones, y — si es fotocopia o impresión — listo para repartir
 * las hojas de los trabajos que detecta el agente.
 */
export default function NewServiceSheet({ prefill = {}, onCreated, onClose }: {
  prefill?: ServicePrefill; onCreated: (p: Product) => void; onClose: () => void
}) {
  const [kind, setKind] = useState<ServiceKind>(prefill.kind ?? 'fotocopia')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [unit, setUnit] = useState(prefill.kind === 'otro' ? 'und' : 'hoja')
  const [color, setColor] = useState<'bn' | 'color' | 'ambos'>(prefill.color == null ? 'bn' : prefill.color ? 'color' : 'bn')
  const [duplex, setDuplex] = useState(prefill.duplex ?? false)
  const [keywords, setKeywords] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const job = kind !== 'otro'
  const priceNum = Number(price.replace(',', '.'))

  function pickKind(k: ServiceKind) {
    setKind(k)
    setUnit(k === 'otro' ? 'und' : 'hoja')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !(priceNum > 0)) return
    setSaving(true); setError('')
    const { data, error: err } = await supabase.rpc('create_copy_service', { p: {
      kind, name: name.trim(), price: priceNum, unit,
      color: !job || color === 'ambos' ? '' : String(color === 'color'),
      duplex: job && duplex,
      keywords: kind === 'impresion' ? keywords.split(',') : [],
    } })
    setSaving(false)
    if (err) { setError(err.code === '42501' ? 'No tienes permiso para crear servicios.' : friendlyError(err)); return }
    const row = data as Product & Record<string, unknown>
    onCreated({
      id: row.id, sku: row.sku, barcode: row.barcode, name: row.name, brand: row.brand, category_id: row.category_id,
      unit: row.unit, price: Number(row.price), stock: Number(row.stock), min_stock: Number(row.min_stock), active: row.active,
      image_path: row.image_path, track_stock: row.track_stock, job_sources: row.job_sources, job_color: row.job_color,
      job_duplex: row.job_duplex, job_keywords: row.job_keywords, locations: [],
    })
  }

  return (
    <Sheet onClose={onClose} label="Nuevo servicio" dismissible={!name && !price} className="space-y-3 sm:max-w-md">
      <h2 className="text-lg font-semibold">Nuevo servicio de copias</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-3 gap-1">
          {KINDS.map(k => (
            <button type="button" key={k.id} role="radio" aria-checked={kind === k.id} onClick={() => pickKind(k.id)}
                    className={`min-h-14 rounded-lg border px-2 text-sm leading-tight ${kind === k.id ? 'border-sky-700 bg-sky-700 text-white' : 'bg-white'}`}>
              <span className="block font-medium">{k.label}</span>
              <span className={`block text-xs ${kind === k.id ? 'text-white/80' : 'text-stone-500'}`}>{k.hint}</span>
            </button>
          ))}
        </div>

        <label className="block text-sm"><span className="mb-1 block text-xs text-stone-500">Nombre</span>
          <input className={input} value={name} onChange={e => setName(e.target.value)} required autoFocus
                 placeholder={kind === 'fotocopia' ? 'Fotocopia A3 B/N' : kind === 'impresion' ? 'Impresión foto 10x15' : 'Anillado'} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm"><span className="mb-1 block text-xs text-stone-500">Precio (S/)</span>
            <input className={input} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} required placeholder="0.50" />
          </label>
          <label className="block text-sm"><span className="mb-1 block text-xs text-stone-500">Se cobra por</span>
            <select className={input} value={unit} onChange={e => setUnit(e.target.value)}>
              <option value="hoja">hoja</option><option value="und">unidad</option>
            </select>
          </label>
        </div>

        {job && (
          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-xs text-stone-500">Para repartir los trabajos que detecta el agente</legend>
            <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Color">
              {([['bn', 'B/N'], ['color', 'Color'], ['ambos', 'B/N o color']] as const).map(([id, label]) => (
                <button type="button" key={id} role="radio" aria-checked={color === id} onClick={() => setColor(id)}
                        className={`min-h-11 rounded border text-sm ${color === id ? 'border-sky-700 bg-sky-50 font-medium text-sky-800' : 'bg-white'}`}>{label}</button>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={duplex} onChange={e => setDuplex(e.target.checked)} />
              Sugerir en trabajos doble cara
            </label>
            {kind === 'impresion' && (
              <label className="block text-sm"><span className="mb-1 block text-xs text-stone-500">Palabras del nombre del documento (opcional, separadas por coma)</span>
                <input className={input} value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="record, sunarp" />
              </label>
            )}
          </fieldset>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded border px-4">Cancelar</button>
          <button disabled={saving || !name.trim() || !(priceNum > 0)} className="min-h-11 rounded bg-sky-700 px-4 text-white disabled:opacity-40">
            {saving ? 'Guardando…' : 'Crear servicio'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
