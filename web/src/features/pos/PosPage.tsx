import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import BarcodeScanner from '@/components/BarcodeScanner'
import { localDb } from '@/db/local'
import { useAuth } from '@/features/auth/AuthProvider'
import QuickCreateSheet from '@/features/inventory/QuickCreateSheet'
import { imageUrl } from '@/lib/images'
import { igvBreakdown, money } from '@/lib/format'
import type { PaymentMethod, Product } from '@/types/domain'
import { useCart } from './useCart'
import { checkout } from './checkout'

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' }, { id: 'yape', label: 'Yape' },
  { id: 'plin', label: 'Plin' }, { id: 'tarjeta', label: 'Tarjeta' },
]

export default function PosPage() {
  const { profile } = useAuth()
  // Alta de productos desde la caja: por ahora solo admin/almacén (RLS de products igual lo exige).
  const canCreate = profile?.role === 'admin' || profile?.role === 'almacen'
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [scanning, setScanning] = useState(false)
  const [creating, setCreating] = useState<{ barcode?: string; name?: string } | null>(null)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const { lines, total, dispatch } = useCart()

  const products = useLiveQuery(() => localDb.products.toArray(), [], [])
  const pendingCount = useLiveQuery(() => localDb.outbox.count(), [], 0)

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t) }, [flash])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products.slice(0, 24)
    return products.filter(p => p.sku.toLowerCase() === q || p.barcode === q ||
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) ||
      (p.brand?.toLowerCase().includes(q) ?? false)).slice(0, 48)
  }, [products, query])

  const add = (p: Product) => { dispatch({ type: 'addProduct', product: p }); setFlash({ text: `+1 ${p.name}`, tone: 'ok' }) }

  /** Código escaneado o tecleado por un lector USB: agrega si existe; si no, ofrece crearlo. */
  function handleCode(code: string) {
    const exact = products.find(p => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())
    if (exact) { add(exact); setQuery(''); return }
    if (canCreate && online) setCreating({ barcode: code })
    else {
      setCustomDesc(`Código ${code}`); setTicketOpen(true)
      setFlash({ text: online ? 'No está en el catálogo: agrégalo como ítem libre' : 'Sin internet: agrégalo como ítem libre', tone: 'warn' })
    }
  }

  async function pay() {
    if (!lines.length) return
    await checkout(lines, method)
    dispatch({ type: 'clear' })
    setTicketOpen(false)
    setFlash({ text: 'Venta registrada', tone: 'ok' })
  }

  const count = lines.reduce((s, l) => s + l.qty, 0)

  return (
    <div className="grid gap-4 p-3 pb-24 md:grid-cols-[1fr_22rem] md:p-4 md:pb-4">
      <section>
        <div className="mb-3 flex gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && query.trim() && handleCode(query.trim())}
                 placeholder="Buscar producto…" className="min-w-0 flex-1 rounded-lg border p-3 text-base" />
          <button onClick={() => setScanning(true)} className="shrink-0 rounded-lg bg-amber-700 px-4 text-white" aria-label="Escanear código">📷</button>
        </div>
        {!online && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">Sin internet: las ventas se guardan en el equipo y se envían al reconectar.</p>}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {results.map(p => {
            const img = imageUrl(p.image_path)
            return (
              <button key={p.id} onClick={() => add(p)} className="overflow-hidden rounded-lg border bg-white text-left hover:border-amber-600 active:bg-amber-50">
                {img && <img src={img} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />}
                <div className="p-2.5">
                  <div className="line-clamp-2 text-sm font-medium">{p.name}</div>
                  <div className="mt-1 flex justify-between text-sm">
                    <span className="font-semibold">{money(p.price)}</span>
                    <span className={p.stock <= p.min_stock ? 'text-red-600' : 'text-stone-500'}>{p.stock} {p.unit}</span>
                  </div>
                </div>
              </button>
            )
          })}
          {query.trim().length >= 2 && canCreate && online && !results.some(p => p.name.toLowerCase() === query.trim().toLowerCase()) && (
            <button onClick={() => setCreating({ name: query.trim() })}
                    className="grid min-h-24 place-items-center rounded-lg border border-dashed bg-white p-3 text-sm text-amber-800">
              + Crear «{query.trim()}»
            </button>
          )}
          {!results.length && !(canCreate && online) && <p className="col-span-full text-stone-500">Sin resultados. Usa “ítem libre” en el ticket.</p>}
        </div>
      </section>

      {/* Ticket: columna fija en escritorio; en el celular, hoja a pantalla completa que se abre desde la barra inferior. */}
      <aside className={`${ticketOpen ? 'fixed inset-0 z-30 overflow-y-auto' : 'hidden'} space-y-3 bg-white p-4
                         md:static md:block md:h-fit md:rounded-xl md:shadow md:sticky md:top-4`}>
        <div className="flex items-center">
          <h2 className="flex-1 font-semibold">
            Ticket {pendingCount > 0 && <span className="ml-2 rounded bg-amber-100 px-2 text-xs text-amber-800">{pendingCount} por sincronizar</span>}
          </h2>
          <button onClick={() => setTicketOpen(false)} className="px-2 text-xl md:hidden" aria-label="Cerrar ticket">✕</button>
        </div>
        <ul className="divide-y">
          {lines.map(l => (
            <li key={l.key} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">{l.description}</span>
              <div className="flex items-center rounded border">
                <button className="px-2.5 py-1" onClick={() => dispatch({ type: 'setQty', key: l.key, qty: l.qty - 1 })} aria-label="Menos">−</button>
                <input type="number" min={0} step="any" value={l.qty} className="w-12 border-x p-1 text-center"
                       onChange={e => dispatch({ type: 'setQty', key: l.key, qty: Number(e.target.value) })} />
                <button className="px-2.5 py-1" onClick={() => dispatch({ type: 'setQty', key: l.key, qty: l.qty + 1 })} aria-label="Más">+</button>
              </div>
              <span className="w-20 text-right">{money(l.qty * l.unit_price)}</span>
              <button aria-label="Quitar" onClick={() => dispatch({ type: 'remove', key: l.key })} className="px-1">✕</button>
            </li>
          ))}
          {!lines.length && <li className="py-4 text-center text-sm text-stone-500">Ticket vacío</li>}
        </ul>

        <form className="flex gap-1" onSubmit={e => {
          e.preventDefault()
          const price = Number(customPrice.replace(',', '.'))
          if (!customDesc || !(price >= 0)) return
          dispatch({ type: 'addCustom', description: customDesc, qty: 1, unit_price: price })
          setCustomDesc(''); setCustomPrice('')
        }}>
          <input value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Ítem libre" className="min-w-0 flex-1 rounded border p-2 text-sm" />
          <input value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="S/" inputMode="decimal" className="w-20 rounded border p-2 text-sm" />
          <button className="rounded border px-3 text-sm">+</button>
        </form>

        <div className="flex flex-wrap gap-1">
          {METHODS.map(m => (
            <button key={m.id} onClick={() => setMethod(m.id)}
                    className={`rounded border px-3 py-2 text-sm ${method === m.id ? 'bg-amber-700 text-white' : ''}`}>{m.label}</button>
          ))}
        </div>

        <dl className="space-y-0.5 text-sm text-stone-500">
          <div className="flex justify-between"><dt>Op. gravada</dt><dd>{money(igvBreakdown(total).base)}</dd></div>
          <div className="flex justify-between"><dt>IGV (18%)</dt><dd>{money(igvBreakdown(total).igv)}</dd></div>
        </dl>
        <div className="flex items-baseline justify-between text-lg font-semibold">
          <span>Total</span><span>{money(total)}</span>
        </div>
        <button disabled={!lines.length} onClick={pay}
                className="w-full rounded-lg bg-amber-700 p-3 font-medium text-white disabled:opacity-40">Cobrar {money(total)}</button>
      </aside>

      {/* Barra inferior (solo celular) */}
      {!ticketOpen && (
        <button onClick={() => setTicketOpen(true)}
                className="fixed inset-x-3 bottom-3 z-20 flex items-center justify-between rounded-xl bg-amber-700 p-4 text-white shadow-lg md:hidden">
          <span>{count ? `${count} ítem${count === 1 ? '' : 's'}` : 'Ticket vacío'}</span>
          <span className="font-semibold">{money(total)} →</span>
        </button>
      )}

      {flash && (
        // Abajo, sobre la barra del ticket: no tapa el buscador ni las líneas del ticket.
        <div role="status" className={`pointer-events-none fixed inset-x-3 bottom-20 z-40 truncate rounded-lg px-4 py-2 text-center text-sm text-white shadow
                                        md:inset-x-auto md:bottom-4 md:left-1/2 md:max-w-md md:-translate-x-1/2
                                        ${flash.tone === 'ok' ? 'bg-stone-900/90' : 'bg-amber-700'}`}>{flash.text}</div>
      )}

      {scanning && <BarcodeScanner onClose={() => setScanning(false)} onDetected={c => { setScanning(false); handleCode(c) }} />}

      {creating && (
        <QuickCreateSheet initialBarcode={creating.barcode} initialName={creating.name} requirePrice
                          onClose={() => setCreating(null)}
                          onCreated={async p => {
                            setCreating(null); setQuery('')
                            const product: Product = { ...p, price: p.price! }
                            await localDb.products.put(product)  // disponible offline sin esperar al próximo refresco
                            add(product)
                          }} />
      )}
    </div>
  )
}
