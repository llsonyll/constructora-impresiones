import { useEffect, useState } from 'react'
import Sheet from '@/components/Sheet'
import { money } from '@/lib/format'
import type { Product } from '@/types/domain'

// Atajos: agregan esa cantidad de una vez (de dos dígitos para no confundirse con el teclado).
const PRESETS = [10, 20, 50, 100]

/**
 * Cantidad rápida para copias e impresiones: teclado grande, el número reemplaza al 1 inicial.
 * "15 copias B/N" = tocar el producto, 1, 5, Agregar. También acepta el teclado físico (dígitos, ⌫, Enter).
 */
export default function QtyPad({ product, accent, onAdd, onClose }: {
  product: Product; accent: string; onAdd: (qty: number) => void; onClose: () => void
}) {
  const [digits, setDigits] = useState('')
  const qty = Number(digits || '1')

  const press = (d: string) => setDigits(s => (s + d).replace(/^0+/, '').slice(0, 4))
  const back = () => setDigits(s => s.slice(0, -1))
  const done = (n = qty) => { if (n > 0) onAdd(n) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') back()
      else if (e.key === 'Enter') { e.preventDefault(); done() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const key = 'grid min-h-14 place-items-center rounded-lg border bg-white text-2xl font-medium active:bg-stone-100'
  return (
    <Sheet onClose={onClose} label={`Cantidad de ${product.name}`} className="space-y-3 sm:max-w-sm">
      <div>
        <div className="font-semibold">{product.name}</div>
        <div className="text-sm text-stone-500">{money(product.price)} por {product.unit}</div>
      </div>
      <div className="flex items-baseline justify-between rounded-lg bg-stone-100 px-4 py-2" aria-live="polite">
        <span className={`text-4xl font-semibold tabular-nums ${digits ? '' : 'text-stone-400'}`}>{qty}</span>
        <span className="text-lg tabular-nums text-stone-600">{money(Math.round(qty * product.price * 100) / 100)}</span>
      </div>
      <div className="flex gap-1.5">
        {PRESETS.map(n => (
          <button key={n} onClick={() => done(n)} aria-label={`Agregar ${n}`} className="min-h-11 flex-1 rounded-full border bg-white text-sm">{n} ✓</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} onClick={() => press(d)} className={key}>{d}</button>)}
        <button onClick={back} className={key} aria-label="Borrar">⌫</button>
        <button onClick={() => press('0')} className={key}>0</button>
        <button onClick={() => done()} className={`${key} border-transparent text-lg text-white ${accent}`}>Agregar</button>
      </div>
    </Sheet>
  )
}
