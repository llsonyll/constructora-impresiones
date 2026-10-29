import { useState } from 'react'
import { Barcode, MapPin, Package } from 'lucide-react'
import Sheet from '@/components/Sheet'
import ZoomImage from '@/components/ZoomImage'
import { imageUrl } from '@/lib/images'
import { money, round2 } from '@/lib/format'
import type { Product } from '@/types/domain'
import { saleOptions, type PickedLine } from './PresentationPicker'

/**
 * Detalle de un producto desde el POS (botón sobre la tarjeta; tocar la tarjeta sigue agregando 1):
 * foto con zoom, datos para decidir y cuántos agregar (por unidad o presentación). Cerrar no agrega nada.
 */
export default function ProductDetailSheet({ product: p, category, inTicket, accent, onAdd, onClose }: {
  product: Product; category?: string; inTicket: number; accent: string
  onAdd: (lines: PickedLine[]) => void; onClose: () => void
}) {
  const img = imageUrl(p.image_path)
  const options = saleOptions(p)
  const [optKey, setOptKey] = useState('base')
  const opt = options.find(o => o.key === optKey) ?? options[0]
  // Texto: deja escribir "1.5" o "1,5" (metros, kilos) sin que el campo lo corrija a mitad de camino.
  const [qtyText, setQtyText] = useState('1')
  const qty = Number(qtyText.replace(',', '.'))
  const valid = qty > 0 && Number.isFinite(qty)
  const units = valid ? round2(qty * opt.factor) : 0
  const service = p.track_stock === false
  const overStock = !service && units + inTicket > p.stock

  const step = (d: number) => setQtyText(String(Math.max(1, round2((valid ? qty : 0) + d))))
  const add = () => {
    if (valid) onAdd([{ description: opt.description, qty, unit_price: opt.price, factor: opt.factor, label: opt.label }])
  }

  return (
    <Sheet onClose={onClose} label={`Detalle de ${p.name}`} className="space-y-3 sm:max-w-lg">
      {img ? <ZoomImage src={img} alt={p.name} className="aspect-[4/3] w-full" />
           : <div className="grid aspect-[3/1] place-items-center rounded-lg bg-stone-100 text-sm text-stone-500">
               <span className="grid justify-items-center gap-1"><Package className="size-10 text-stone-400" aria-hidden />Sin foto</span>
             </div>}

      <div>
        <h2 className="font-semibold leading-snug">{p.name}</h2>
        <p className="text-xs text-stone-500">
          {p.sku}{p.brand && ` · ${p.brand}`}{category && ` · ${category}`}
          {p.barcode && <span className="ml-1 whitespace-nowrap font-mono"><Barcode className="mr-0.5 inline size-3.5 align-[-0.15em]" />{p.barcode}</span>}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {money(p.price)}<span className="ml-1 text-sm font-normal text-stone-500">/ {p.unit}</span>
        </p>
        {!!p.aliases?.length && <p className="text-xs text-stone-500">También: {p.aliases.join(', ')}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-stone-50 p-2">
          <dt className="text-xs text-stone-500">Stock</dt>
          <dd className={`text-lg font-semibold tabular-nums ${!service && p.stock <= p.min_stock ? 'text-red-600' : ''}`}>
            {service ? 'Servicio' : `${p.stock} ${p.unit}`}
            {!service && p.min_stock > 0 && <span className="ml-1 text-xs font-normal text-stone-500">mín. {p.min_stock}</span>}
          </dd>
        </div>
        <div className="rounded-lg bg-stone-50 p-2">
          <dt className="text-xs text-stone-500">En el ticket</dt>
          <dd className="text-lg font-semibold tabular-nums">{inTicket > 0 ? `${inTicket} ${p.unit}` : '—'}</dd>
        </div>
      </dl>

      {!!p.locations?.length && (
        <div className="flex flex-wrap gap-1 text-xs">
          {p.locations.map((c, i) => (
            <span key={c} className="rounded-full border px-2 py-1 font-mono">
              <MapPin className="mr-0.5 inline size-3 align-[-0.1em]" />{c}{i === 0 && p.locations!.length > 1 && ' ★'}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2 border-t pt-3">
        {options.length > 1 && (
          <div role="radiogroup" aria-label="Presentación" className="flex flex-wrap gap-1.5">
            {options.map(o => (
              <button key={o.key} type="button" role="radio" aria-checked={o.key === opt.key} onClick={() => setOptKey(o.key)}
                      className={`min-h-11 rounded-lg border px-3 text-left text-sm ${o.key === opt.key ? `${accent} border-transparent text-white` : 'bg-white'}`}>
                <span className="block font-medium">{o.factor === 1 ? `Suelto (${o.label})` : o.label}{o.detail && <span className="ml-1 text-xs font-normal opacity-75">({o.detail})</span>}</span>
                <span className="text-xs tabular-nums opacity-80">{money(o.price)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border">
            <button type="button" onClick={() => step(-1)} className="grid size-11 place-items-center text-lg" aria-label="Menos">−</button>
            <input value={qtyText} onChange={e => setQtyText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
                   onFocus={e => e.target.select()} inputMode="decimal" aria-label="Cantidad"
                   className="min-h-11 w-16 border-x text-center text-base tabular-nums" />
            <button type="button" onClick={() => step(1)} className="grid size-11 place-items-center text-lg" aria-label="Más">+</button>
          </div>
          <span className="min-w-0 flex-1 text-sm text-stone-600">
            {opt.factor === 1 ? p.unit : `${opt.label}${valid ? ` = ${units} ${p.unit}` : ''}`}
          </span>
        </div>
        {overStock && <p className="text-xs text-amber-700">Supera el stock ({p.stock} {p.unit}{inTicket > 0 && `, ya hay ${inTicket} en el ticket`})</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="min-h-12 rounded-lg border px-4 font-medium text-stone-700">Cerrar</button>
          <button type="button" onClick={add} disabled={!valid}
                  className={`flex min-h-12 flex-1 items-center justify-between gap-2 rounded-lg px-4 font-medium text-white disabled:opacity-40 ${accent}`}>
            <span>Agregar al ticket</span>
            <span className="tabular-nums">{valid ? money(round2(qty * opt.price)) : '—'}</span>
          </button>
        </div>
      </div>
    </Sheet>
  )
}
