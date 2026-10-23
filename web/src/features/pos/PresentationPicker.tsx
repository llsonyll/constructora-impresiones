import { useState } from 'react'
import Sheet from '@/components/Sheet'
import { money, round2 } from '@/lib/format'
import type { Presentation, Product } from '@/types/domain'

/** Una línea a agregar al ticket: la unidad base (factor 1) o una presentación. */
export interface PickedLine { description: string; qty: number; unit_price: number; factor: number; label: string }

/** Descripción de la línea de una presentación: "TIRAFON DE 8x1 PULGADA · Docena". */
export const presentationLabel = (p: Pick<Product, 'name'>, pr: Presentation) => `${p.name} · ${pr.name}`

/** Opciones de venta de un producto: su unidad base y sus presentaciones, de la más chica a la más grande. */
export function saleOptions(p: Pick<Product, 'name' | 'unit' | 'price' | 'presentations'>) {
  return [
    { key: 'base', label: p.unit, detail: '', price: p.price, factor: 1, description: p.name },
    ...[...(p.presentations ?? [])].sort((a, b) => a.qty - b.qty).map(pr => ({
      key: pr.name, label: pr.name, detail: `${pr.qty} ${p.unit}`, price: pr.price, factor: pr.qty, description: presentationLabel(p, pr),
    })),
  ]
}

/**
 * Producto que se vende por unidad, docena, ciento, bolsa…: el cajero elige cuántas de cada una.
 * "1 docena y 3 sueltos" = Docena +1, unidad +3, Agregar (dos líneas en el ticket; el stock baja 15).
 */
export default function PresentationPicker({ product, accent, onAdd, onClose }: {
  product: Product; accent: string; onAdd: (lines: PickedLine[]) => void; onClose: () => void
}) {
  const options = saleOptions(product)
  const [qty, setQty] = useState<Record<string, number>>({})
  const bump = (key: string, d: number) => setQty(s => ({ ...s, [key]: Math.max(0, (s[key] ?? 0) + d) }))
  const picked = options.filter(o => (qty[o.key] ?? 0) > 0)
  const total = round2(picked.reduce((s, o) => s + round2(qty[o.key] * o.price), 0))
  const units = picked.reduce((s, o) => s + qty[o.key] * o.factor, 0)

  const add = () => onAdd(picked.map(o => ({ description: o.description, qty: qty[o.key], unit_price: o.price, factor: o.factor, label: o.label })))

  return (
    <Sheet onClose={onClose} label={`Presentación de ${product.name}`} className="space-y-3 sm:max-w-sm">
      <div>
        <div className="font-semibold">{product.name}</div>
        {product.track_stock !== false && <div className="text-sm text-stone-500">Stock {product.stock} {product.unit}</div>}
      </div>
      <ul className="divide-y rounded-lg border">
        {options.map(o => (
          <li key={o.key} className="flex items-center gap-2 py-1 pl-3">
            {/* Tocar el nombre suma 1 (lo más común: una docena, un ciento). */}
            <button onClick={() => bump(o.key, 1)} className="min-h-11 min-w-0 flex-1 text-left">
              <span className="block font-medium">{o.factor === 1 ? `Suelto (${o.label})` : o.label}{o.detail && <span className="ml-1 text-xs font-normal text-stone-500">({o.detail})</span>}</span>
              <span className="text-sm tabular-nums text-stone-600">{money(o.price)}</span>
            </button>
            <div className="flex items-center rounded border">
              <button className="grid size-11 place-items-center text-lg" onClick={() => bump(o.key, -1)} aria-label={`Menos ${o.label}`}>−</button>
              <span className="w-8 text-center tabular-nums" aria-label={`Cantidad de ${o.label}`}>{qty[o.key] ?? 0}</span>
              <button className="grid size-11 place-items-center text-lg" onClick={() => bump(o.key, 1)} aria-label={`Más ${o.label}`}>+</button>
            </div>
          </li>
        ))}
      </ul>
      <button onClick={add} disabled={!picked.length}
              className={`flex min-h-12 w-full items-center justify-between rounded-lg px-4 font-medium text-white disabled:opacity-40 ${accent}`}>
        <span>Agregar{units > 0 && <span className="ml-1 text-sm font-normal opacity-80">({units} {product.unit})</span>}</span>
        <span className="tabular-nums">{money(total)}</span>
      </button>
    </Sheet>
  )
}
