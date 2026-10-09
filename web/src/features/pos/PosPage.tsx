import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import BarcodeScanner from '@/components/BarcodeScanner'
import { localDb } from '@/db/local'
import { useAuth } from '@/features/auth/AuthProvider'
import QuickCreateSheet from '@/features/inventory/QuickCreateSheet'
import PrintJobsPanel from '@/features/print/PrintJobsPanel'
import { usePrintAgent } from '@/features/print/usePrintAgent'
import { describirJob } from '@shared/print/core.js'
import { CAJAS, CAJA_ICON, CAJA_LABEL, CAJA_THEME, bumpUsage, cajaOf, readUsage, useCajaPref } from '@/lib/caja'
import { imageUrl } from '@/lib/images'
import { igvBreakdown, money } from '@/lib/format'
import { useOverlay } from '@/lib/overlay'
import type { Caja, Category, PaymentMethod, Product } from '@/types/domain'
import { useCart } from './useCart'
import { checkout } from './checkout'
import QtyPad from './QtyPad'

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
  const [paying, setPaying] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [caja, setCaja] = useCajaPref()
  const [category, setCategory] = useState<number | null>(null)
  const [padFor, setPadFor] = useState<Product | null>(null)
  const agent = usePrintAgent()
  // Bloqueo síncrono contra el doble toque: el estado `paying` recién se aplica en el siguiente render.
  const payingRef = useRef(false)
  // Un id por ticket: si el cobro se reintenta, se reutiliza y no se duplica la venta.
  const saleIdRef = useRef<Record<Caja, string | null>>({ ferreteria: null, copias: null })
  // Un ticket por caja: se puede atender a alguien en copias sin perder el ticket de ferretería a medias.
  const carts: Record<Caja, ReturnType<typeof useCart>> = { ferreteria: useCart(), copias: useCart() }
  const { lines, total, dispatch } = carts[caja]
  const theme = CAJA_THEME[caja]
  // En el celular el ticket es una hoja a pantalla completa: "atrás" la cierra. En escritorio es una columna fija.
  useOverlay(() => setTicketOpen(false), ticketOpen && !matchMedia('(min-width: 768px)').matches)

  const products = useLiveQuery(() => localDb.products.toArray(), [], [])
  const categories = useLiveQuery(() => localDb.categories.toArray(), [], [] as Category[])
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const [usage, setUsage] = useState(readUsage)
  const pendingCount = useLiveQuery(() => localDb.outbox.count(), [], 0)

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t) }, [flash])
  useEffect(() => { if (!agent.ultimoNuevo) return; const t = setTimeout(agent.descartarAviso, 8000); return () => clearTimeout(t) }, [agent.ultimoNuevo])

  const inCaja = useMemo(() => products.filter(p => cajaOf(p, catMap) === caja), [products, catMap, caja])
  // Categorías de esta caja que tienen productos, en orden alfabético.
  const cajaCats = useMemo(() => {
    const ids = new Set(inCaja.map(p => p.category_id))
    return categories.filter(c => c.caja === caja && ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))
  }, [categories, inCaja, caja])
  useEffect(() => { setCategory(null) }, [caja])

  const matches = (p: Product, q: string) => p.sku.toLowerCase() === q || p.barcode === q ||
    p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.brand?.toLowerCase().includes(q) ?? false)

  // Sin búsqueda: lo más usado en este equipo primero (servicios antes que productos en copias).
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = category == null ? inCaja : inCaja.filter(p => p.category_id === category)
    const found = q ? pool.filter(p => matches(p, q)) : pool
    const sorted = [...found].sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0)
      || Number(a.track_stock) - Number(b.track_stock) || a.name.localeCompare(b.name))
    return sorted.slice(0, q || category != null ? 60 : 36)
  }, [inCaja, query, category, usage])

  // Coincidencias en la otra caja: se ofrecen para cambiar de caja sin perder la búsqueda.
  const otherCaja: Caja = caja === 'ferreteria' ? 'copias' : 'ferreteria'
  const otherMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q.length >= 2 ? products.filter(p => cajaOf(p, catMap) === otherCaja && matches(p, q)).length : 0
  }, [products, catMap, otherCaja, query])

  const used = (id: string) => { bumpUsage(id); setUsage(readUsage()) }

  /** Agrega al ticket de la caja del producto (si es de la otra caja, cambia a ella y avisa). */
  function add(p: Product, qty = 1) {
    const target = cajaOf(p, catMap)
    if (qty === 1) carts[target].dispatch({ type: 'addProduct', product: p })
    else carts[target].dispatch({ type: 'addLine', product_id: p.id, description: p.name, qty, unit_price: p.price })
    used(p.id)
    if (target !== caja) { setCaja(target); setFlash({ text: `${p.name} es de ${CAJA_LABEL[target]}: cambiaste a esa caja`, tone: 'warn' }) }
    else setFlash({ text: `+${qty} ${p.name}`, tone: 'ok' })
  }

  /** Tocar una tarjeta: los servicios (copias, impresiones) piden cantidad; el resto suma 1. */
  const tap = (p: Product) => (p.track_stock === false ? setPadFor(p) : add(p))

  /** Código escaneado o tecleado por un lector USB: agrega si existe; si no, ofrece crearlo. */
  function handleCode(code: string) {
    const exact = products.find(p => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())
    if (exact) { tap(exact); setQuery(''); return }
    if (canCreate && online) setCreating({ barcode: code })
    else {
      setCustomDesc(`Código ${code}`); setTicketOpen(true)
      setFlash({ text: online ? 'No está en el catálogo: agrégalo como ítem libre' : 'Sin internet: agrégalo como ítem libre', tone: 'warn' })
    }
  }

  async function pay() {
    if (!lines.length || payingRef.current) return
    payingRef.current = true
    setPaying(true)
    const ids = saleIdRef.current
    ids[caja] ??= crypto.randomUUID()
    try {
      await checkout(lines, caja, method, {}, ids[caja]!)
      ids[caja] = null
      dispatch({ type: 'clear' })
      setTicketOpen(false)
      setFlash({ text: `Venta registrada en ${CAJA_LABEL[caja]}`, tone: 'ok' })
    } catch {
      setFlash({ text: 'No se pudo registrar la venta. Intenta de nuevo.', tone: 'warn' })
    } finally {
      payingRef.current = false
      setPaying(false)
    }
  }

  const count = lines.length
  const countOf = (c: Caja) => carts[c].lines.length

  return (
    <div className="grid gap-4 p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] md:grid-cols-[1fr_22rem] md:p-4 md:pb-4">
      <section>
        {/* Caja: cada una con su ticket, su catálogo y su color. */}
        <div role="tablist" aria-label="Caja" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-stone-200 p-1">
          {CAJAS.map(c => (
            <button key={c} role="tab" aria-selected={caja === c} onClick={() => setCaja(c)}
                    className={`flex min-h-12 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium
                                ${caja === c ? `${CAJA_THEME[c].solid} text-white shadow` : 'text-stone-600'}`}>
              <span aria-hidden>{CAJA_ICON[c]}</span>{CAJA_LABEL[c]}
              {countOf(c) > 0 && (
                <span className={`rounded-full px-1.5 text-xs ${caja === c ? 'bg-white/25' : 'bg-white'}`}>{countOf(c)}</span>
              )}
            </button>
          ))}
        </div>
        <div className="mb-3 flex gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && query.trim() && handleCode(query.trim())}
                 placeholder={`Buscar en ${CAJA_LABEL[caja]}…`} className="min-w-0 flex-1 rounded-lg border p-3 text-base" />
          {query && <button onClick={() => setQuery('')} className="grid min-w-11 shrink-0 place-items-center rounded-lg border bg-white" aria-label="Limpiar búsqueda">✕</button>}
          <button onClick={() => setScanning(true)} className={`min-w-12 shrink-0 rounded-lg px-4 text-white ${theme.solid}`} aria-label="Escanear código">📷</button>
          {(caja === 'copias' || agent.pendientes.length > 0) && <button onClick={() => setPrintOpen(true)} aria-label={`Trabajos de impresión (${agent.pendientes.length} pendientes)`}
                  className="relative min-w-12 shrink-0 rounded-lg border bg-white px-3">
            🖨️
            {agent.pendientes.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-xs text-white">{agent.pendientes.length}</span>
            )}
          </button>}
        </div>
        {cajaCats.length > 1 && (
          <div className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {[{ id: null as number | null, name: 'Todo' }, ...cajaCats].map(c => (
              <button key={c.id ?? 'todo'} onClick={() => setCategory(c.id)} aria-pressed={category === c.id}
                      className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${category === c.id ? `${theme.border} ${theme.solid} text-white` : 'bg-white'}`}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        {agent.ultimoNuevo && (
          <div role="status" className="mb-3 flex items-center gap-2 rounded-lg bg-stone-900 p-2 pl-3 text-sm text-white">
            <span className="min-w-0 flex-1">🖨️ Nuevo trabajo: {describirJob(agent.ultimoNuevo)}</span>
            <button onClick={() => { agent.descartarAviso(); setPrintOpen(true) }} className="min-h-11 rounded bg-amber-600 px-3">Asignar</button>
            <button onClick={agent.descartarAviso} className="grid size-11 place-items-center" aria-label="Cerrar aviso">✕</button>
          </div>
        )}
        {!online && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">Sin internet: las ventas se guardan en el equipo y se envían al reconectar.</p>}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {results.map(p => {
            const img = imageUrl(p.image_path)
            const service = p.track_stock === false
            return (
              <button key={p.id} onClick={() => tap(p)}
                      className={`overflow-hidden rounded-lg border bg-white text-left active:bg-stone-50 ${service ? `border-l-4 ${theme.border}` : ''}`}>
                {img && <img src={img} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />}
                <div className={service ? 'p-3' : 'p-2.5'}>
                  <div className={`line-clamp-2 font-medium ${service ? 'text-base' : 'text-sm'}`}>{p.name}</div>
                  <div className="mt-1 flex justify-between text-sm">
                    <span className="font-semibold">{money(p.price)}</span>
                    {p.track_stock === false
                      ? <span className="text-stone-500">por {p.unit}</span>
                      : <span className={p.stock <= p.min_stock ? 'text-red-600' : 'text-stone-500'}>{p.stock} {p.unit}</span>}
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
        {otherMatches > 0 && (
          <button onClick={() => setCaja(otherCaja)} className="mt-3 min-h-11 w-full rounded-lg border border-dashed bg-white px-3 text-sm text-stone-600">
            {otherMatches} resultado{otherMatches === 1 ? '' : 's'} en {CAJA_ICON[otherCaja]} {CAJA_LABEL[otherCaja]} →
          </button>
        )}
      </section>

      {/* Ticket: columna fija en escritorio; en el celular, hoja a pantalla completa que se abre desde la barra inferior. */}
      <aside className={`${ticketOpen ? 'fixed inset-0 z-30 overflow-y-auto overscroll-contain' : 'hidden'} space-y-3 bg-white
                         px-safe-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-safe-4
                         md:static md:block md:h-fit md:rounded-xl md:p-4 md:shadow md:sticky md:top-4`}>
        <div className="flex items-center">
          <h2 className="flex-1 font-semibold">
            Ticket <span className={`ml-1 rounded px-2 py-0.5 text-xs ${theme.soft} ${theme.text}`}>{CAJA_ICON[caja]} {CAJA_LABEL[caja]}</span>
            {pendingCount > 0 && <span className="ml-2 rounded bg-amber-100 px-2 text-xs text-amber-800">{pendingCount} por sincronizar</span>}
          </h2>
          <button onClick={() => setTicketOpen(false)} className="-mr-2 grid size-11 place-items-center text-xl md:hidden" aria-label="Cerrar ticket">✕</button>
        </div>
        <ul className="divide-y">
          {lines.map(l => (
            <li key={l.key} className="flex items-center gap-1.5 py-1 text-sm">
              <span className="min-w-0 flex-1 break-words">{l.description}</span>
              <div className="flex items-center rounded border">
                <button className="grid size-11 place-items-center text-lg" onClick={() => dispatch({ type: 'setQty', key: l.key, qty: l.qty - 1 })} aria-label="Menos">−</button>
                <input type="number" min={0} step="any" value={l.qty} className="min-h-11 w-12 border-x text-center text-base"
                       onChange={e => dispatch({ type: 'setQty', key: l.key, qty: Number(e.target.value) })} />
                <button className="grid size-11 place-items-center text-lg" onClick={() => dispatch({ type: 'setQty', key: l.key, qty: l.qty + 1 })} aria-label="Más">+</button>
              </div>
              <span className="w-16 shrink-0 text-right">{money(l.qty * l.unit_price)}</span>
              <button aria-label="Quitar" onClick={() => dispatch({ type: 'remove', key: l.key })} className="-mr-2 grid size-11 shrink-0 place-items-center text-stone-500">✕</button>
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
          <input value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Ítem libre" className="min-h-11 min-w-0 flex-1 rounded border px-2 text-base md:text-sm" />
          <input value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="S/" inputMode="decimal" className="min-h-11 w-20 rounded border px-2 text-base md:text-sm" />
          <button className="min-w-11 rounded border px-3 text-sm" aria-label="Agregar ítem libre">+</button>
        </form>

        <div className="flex flex-wrap gap-1">
          {METHODS.map(m => (
            <button key={m.id} onClick={() => setMethod(m.id)}
                    className={`min-h-11 flex-1 rounded border px-3 text-sm ${method === m.id ? `${theme.solid} text-white` : ''}`}>{m.label}</button>
          ))}
        </div>

        <dl className="space-y-0.5 text-sm text-stone-500">
          <div className="flex justify-between"><dt>Op. gravada</dt><dd>{money(igvBreakdown(total).base)}</dd></div>
          <div className="flex justify-between"><dt>IGV (18%)</dt><dd>{money(igvBreakdown(total).igv)}</dd></div>
        </dl>
        <div className="flex items-baseline justify-between text-lg font-semibold">
          <span>Total</span><span>{money(total)}</span>
        </div>
        <button disabled={!lines.length || paying} onClick={pay} aria-busy={paying}
                className={`w-full rounded-lg p-3 font-medium text-white disabled:opacity-40 ${theme.solid}`}>
          {paying ? 'Registrando…' : `Cobrar ${money(total)}`}
        </button>
      </aside>

      {/* Barra inferior (solo celular) */}
      {!ticketOpen && (
        <button onClick={() => setTicketOpen(true)}
                className={`fixed inset-x-3 bottom-safe-3 z-20 flex items-center justify-between rounded-xl p-4 text-white shadow-lg md:hidden ${theme.solid}`}>
          <span>{CAJA_ICON[caja]} {count ? `${count} ítem${count === 1 ? '' : 's'}` : 'Ticket vacío'}</span>
          <span className="font-semibold">{money(total)} →</span>
        </button>
      )}

      {flash && (
        // Abajo, sobre la barra del ticket: no tapa el buscador ni las líneas del ticket.
        <div role="status" className={`pointer-events-none fixed inset-x-3 bottom-safe-20 z-40 truncate rounded-lg px-4 py-2 text-center text-sm text-white shadow
                                        md:inset-x-auto md:bottom-4 md:left-1/2 md:max-w-md md:-translate-x-1/2
                                        ${flash.tone === 'ok' ? 'bg-stone-900/90' : 'bg-amber-700'}`}>{flash.text}</div>
      )}

      {printOpen && (
        <PrintJobsPanel agent={agent} products={products} onClose={() => setPrintOpen(false)}
                        onAdd={(printLines, resto) => {
                          // Las impresiones siempre van a la caja de copias.
                          for (const l of printLines) { carts.copias.dispatch({ type: 'addLine', ...l }); used(l.product_id) }
                          setCaja('copias')
                          setFlash({ text: resto > 0 ? `Agregado al ticket · quedan ${resto} hoja${resto === 1 ? '' : 's'} pendiente${resto === 1 ? '' : 's'}` : 'Agregado al ticket', tone: 'ok' })
                        }} />
      )}

      {padFor && (
        <QtyPad product={padFor} accent={CAJA_THEME[cajaOf(padFor, catMap)].solid} onClose={() => setPadFor(null)}
                onAdd={qty => { add(padFor, qty); setPadFor(null) }} />
      )}

      {scanning && <BarcodeScanner onClose={() => setScanning(false)} onDetected={c => { setScanning(false); handleCode(c) }} />}

      {creating && (
        <QuickCreateSheet initialBarcode={creating.barcode} initialName={creating.name} requirePrice
                          initialCategory={category ?? (caja === 'copias' ? categories.find(c => c.name === 'Librería')?.id : null)}
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
