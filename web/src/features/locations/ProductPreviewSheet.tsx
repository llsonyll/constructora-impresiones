import { useMemo, useState } from 'react'
import { MapPin, Package } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Sheet from '@/components/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { type InventoryProduct, useCategories } from '@/features/inventory/api'
import { useCarts } from '@/features/pos/useCart'
import { CAJA_LABEL, cajaOf, saveCajaPref } from '@/lib/caja'
import { imageUrl } from '@/lib/images'
import { money } from '@/lib/format'

/**
 * Vista rápida de un producto desde Ubicaciones: foto, stock, precio de venta y dónde está; con
 * "Agregar al ticket" (de la caja del producto) para quien puede vender.
 */
export default function ProductPreviewSheet({ product: p, hereLocationId, onClose }: {
  product: InventoryProduct; hereLocationId?: number; onClose: () => void
}) {
  const { profile } = useAuth()
  const canSell = profile?.role === 'admin' || profile?.role === 'cajero'
  const { data: categories = [] } = useCategories()
  const caja = cajaOf(p, useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]))
  const carts = useCarts()
  const navigate = useNavigate()
  const [qty, setQty] = useState(1)
  // Confirmación dentro de la hoja: en el celular un aviso abajo quedaría tapado por la propia hoja.
  const [added, setAdded] = useState<number | null>(null)

  const img = imageUrl(p.image_path)
  const sellable = p.active && p.price != null
  const inTicket = carts[caja].lines.filter(l => l.product_id === p.id).reduce((s, l) => s + l.qty, 0)
  const here = p.locations.find(l => l.location_id === hereLocationId)

  function addToTicket() {
    if (!sellable || !(qty > 0)) return
    const unit_price = p.price!
    carts[caja].dispatch({ type: 'addLine', product_id: p.id, description: p.name, qty, unit_price })
    saveCajaPref(caja)   // el POS se abre en la caja donde quedó el producto
    setAdded(qty)
    setQty(1)
  }

  function undo() {
    if (added == null) return
    carts[caja].dispatch({ type: 'undoAdd', product_id: p.id, unit_price: p.price!, qty: added })
    setAdded(null)
  }

  return (
    <Sheet onClose={onClose} label={p.name} className="space-y-3 sm:max-w-md">
      <div className="flex gap-3">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-stone-100">
          {img ? <img src={img} alt="" className="size-full object-cover" />
               : <Package className="size-10 text-stone-400" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-3 font-semibold leading-snug">{p.name}</h2>
          <p className="text-xs text-stone-500">{p.sku}{p.brand && ` · ${p.brand}`}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {p.price != null ? money(p.price) : <span className="text-base font-normal text-amber-700">Sin precio</span>}
            <span className="ml-1 text-xs font-normal text-stone-500">/ {p.unit}</span>
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-stone-50 p-2">
          <dt className="text-xs text-stone-500">Stock</dt>
          <dd className={`text-lg font-semibold tabular-nums ${p.stock <= p.min_stock ? 'text-red-600' : ''}`}>{p.stock} {p.unit}</dd>
        </div>
        <div className="rounded-lg bg-stone-50 p-2">
          <dt className="text-xs text-stone-500">{here ? 'Aquí (referencial)' : 'Caja'}</dt>
          <dd className="text-lg font-semibold tabular-nums">{here ? (here.qty != null ? `~${here.qty}` : '—') : CAJA_LABEL[caja]}</dd>
        </div>
      </dl>

      {p.locations.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs">
          {p.locations.map(l => (
            <span key={l.location_id} className={`rounded-full border px-2 py-1 font-mono ${l.location_id === hereLocationId ? 'border-amber-700 bg-amber-50' : ''}`}>
              <MapPin className="mr-0.5 inline size-3 align-[-0.1em]" />{l.code}{l.is_primary && ' ★'}
            </span>
          ))}
        </div>
      )}

      {canSell && (sellable ? (
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border">
              <button onClick={() => setQty(q => Math.max(1, q - 1))} className="grid size-11 place-items-center text-lg" aria-label="Menos">−</button>
              <input type="number" min={1} inputMode="numeric" value={qty} aria-label="Cantidad"
                     onChange={e => setQty(Math.max(0, Number(e.target.value)))}
                     className="min-h-11 w-14 border-x text-center text-base tabular-nums" />
              <button onClick={() => setQty(q => q + 1)} className="grid size-11 place-items-center text-lg" aria-label="Más">+</button>
            </div>
            <button onClick={addToTicket} disabled={!(qty > 0)}
                    className="min-h-11 flex-1 rounded-lg bg-amber-700 px-3 font-medium text-white disabled:opacity-40">
              Agregar {money(qty * p.price!)}
            </button>
          </div>
          {added != null ? (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-green-50 p-2 text-sm text-green-900">
              <span className="min-w-0 flex-1">✓ +{added} al ticket de {CAJA_LABEL[caja]} ({inTicket} en total)</span>
              <button onClick={undo} className="min-h-11 rounded border border-green-700/30 bg-white px-3">Deshacer</button>
              <button onClick={() => navigate('/ventas')} className="min-h-11 rounded bg-green-700 px-3 text-white">Ver ticket</button>
            </div>
          ) : (
            <p className="text-xs text-stone-500">
              Va al ticket de <b>{CAJA_LABEL[caja]}</b>{inTicket > 0 && ` · ya hay ${inTicket} en el ticket`}
              {p.track_stock && qty > p.stock && <span className="text-amber-700"> · supera el stock</span>}
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          {p.price == null ? 'Sin precio de venta: ponle precio en Inventario para poder venderlo.' : 'Producto inactivo: no se vende en el POS.'}
        </p>
      ))}
    </Sheet>
  )
}
