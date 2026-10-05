import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import BarcodeScanner from '@/components/BarcodeScanner'
import { IGV_RATE, money, round2 } from '@/lib/format'
import { type InventoryProduct, useInventory } from '@/features/inventory/api'
import QuickCreateSheet from '@/features/inventory/QuickCreateSheet'
import {
  friendlyPoError, type PoDraft, poLabel, type ReceiptLine, STATUS_LABEL, STATUS_STYLE, useDeletePurchaseOrder,
  usePurchaseOrder, useProviderList, useReceivePurchaseOrder, useSavePurchaseOrder, useSetPoStatus, useUpdateInvoiceRef, whatsappUrl,
} from './api'
import ReceiptSummary from './ReceiptSummary'

/** auto: el costo es el propuesto (último costo), no uno escrito; se convierte si se cambia "incluyen IGV". */
interface Line { key: string; product_id: string; qty: string; unit_cost: string; auto?: boolean }
interface Form { provider_id: string; invoice_ref: string; note: string; costs_include_igv: boolean; lines: Line[] }

const num = (s: string) => Number(s.replace(',', '.'))
const valid = (s: string) => s.trim() !== '' && !Number.isNaN(num(s))
const fmtQty = (n: number) => String(Number(n.toFixed(3)))
const LOW_MARGIN = 0.15
let keySeq = 0
const newKey = () => `l${++keySeq}`

/** Costo que se propone al agregar un producto: el último costo (con IGV), pasado a sin IGV si la orden lo pide. */
function defaultCost(p: InventoryProduct, includeIgv: boolean) {
  if (p.cost == null) return ''
  return String(includeIgv ? p.cost : round4(p.cost / (1 + IGV_RATE)))
}
const round4 = (n: number) => Math.round(n * 10000) / 10000

export default function PurchaseOrderPage() {
  const { id: routeId } = useParams()
  const isNew = routeId === 'nueva'
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const { data: order, isLoading, error: loadError } = usePurchaseOrder(isNew ? undefined : routeId)
  const { data: products = [] } = useInventory()
  const { data: providers = [] } = useProviderList()
  const save = useSavePurchaseOrder()
  const setStatus = useSetPoStatus()
  const receive = useReceivePurchaseOrder()
  const remove = useDeletePurchaseOrder()
  const updateRef = useUpdateInvoiceRef()

  const [form, setForm] = useState<Form | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [creating, setCreating] = useState<{ barcode?: string; name?: string } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ReceiptLine[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Carga inicial del formulario (una sola vez por orden; los refetch no pisan lo que se está editando).
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    const key = isNew ? 'nueva' : order?.id
    if (!key || loadedFor.current === key) return
    loadedFor.current = key
    const f: Form = isNew
      ? { provider_id: params.get('proveedor') ?? '', invoice_ref: '', note: '', costs_include_igv: true, lines: [] }
      : {
          provider_id: order!.provider_id, invoice_ref: order!.invoice_ref ?? '', note: order!.note ?? '',
          costs_include_igv: order!.costs_include_igv,
          lines: order!.items.map(i => ({ key: newKey(), product_id: i.product_id, qty: fmtQty(i.qty), unit_cost: String(i.unit_cost) })),
        }
    setForm(f); setSavedSnapshot(isNew ? '' : JSON.stringify(strip(f)))
  }, [isNew, order, params])

  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t) }, [flash])

  const status = isNew ? 'borrador' : order?.status ?? 'borrador'
  const editable = status === 'borrador' || status === 'enviada'
  const dirty = !!form && (isNew ? form.lines.length > 0 || !!form.provider_id && !params.get('proveedor') : JSON.stringify(strip(form)) !== savedSnapshot)

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const provider = providers.find(p => p.id === form?.provider_id)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return products.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      || (p.brand?.toLowerCase().includes(q) ?? false) || (p.barcode?.includes(q) ?? false)).slice(0, 8)
  }, [products, query])

  if (!isNew && isLoading) return <p className="p-6 text-stone-500">Cargando…</p>
  if (loadError) return <p className="p-6 text-red-600">Error: {friendlyPoError(loadError)}</p>
  if (!form) return null

  const update = (patch: Partial<Form>) => setForm(f => f && { ...f, ...patch })
  const updateLine = (key: string, patch: Partial<Line>) =>
    setForm(f => f && { ...f, lines: f.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) })

  /** Los costos propuestos se convierten (con ↔ sin IGV); los escritos a mano se respetan tal cual. */
  function toggleIgv(include: boolean) {
    setForm(f => f && {
      ...f, costs_include_igv: include,
      lines: f.lines.map(l => (l.auto && valid(l.unit_cost)
        ? { ...l, unit_cost: String(round4(include ? num(l.unit_cost) * (1 + IGV_RATE) : num(l.unit_cost) / (1 + IGV_RATE))) }
        : l)),
    })
  }

  function addProduct(p: Pick<InventoryProduct, 'id' | 'name'> & Partial<InventoryProduct>, qty = 1) {
    setForm(f => {
      if (!f) return f
      const existing = f.lines.find(l => l.product_id === p.id)
      if (existing) return { ...f, lines: f.lines.map(l => (l === existing ? { ...l, qty: fmtQty(num(l.qty || '0') + qty) } : l)) }
      const full = byId.get(p.id)
      const cost = full ? defaultCost(full, f.costs_include_igv) : ''
      return { ...f, lines: [...f.lines, { key: newKey(), product_id: p.id, qty: fmtQty(qty), unit_cost: cost, auto: true }] }
    })
    setFlash(`+${fmtQty(qty)} ${p.name}`)
    setQuery('')
  }

  function handleCode(raw: string) {
    const code = raw.trim()
    if (!code) return
    const hit = products.find(p => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())
    if (hit) return addProduct(hit)
    if (results.length === 1) return addProduct(results[0])
    if (/^\d{6,}$/.test(code)) setCreating({ barcode: code })
  }

  function addLowStock() {
    if (!form) return
    const inOrder = new Set(form.lines.map(l => l.product_id))
    const low = products.filter(p => p.provider_id === form.provider_id && !inOrder.has(p.id) && p.stock <= p.min_stock)
    if (!low.length) return setFlash('Ningún producto de este proveedor está bajo el mínimo')
    setForm(f => f && {
      ...f,
      lines: [...f.lines, ...low.map(p => ({
        key: newKey(), product_id: p.id, qty: fmtQty(Math.max(p.min_stock - p.stock, 1)), unit_cost: defaultCost(p, f.costs_include_igv), auto: true,
      }))],
    })
    setFlash(`Se agregaron ${low.length} productos con stock bajo`)
  }

  const lineSubtotal = (l: Line) => (valid(l.qty) && valid(l.unit_cost) ? round2(num(l.qty) * num(l.unit_cost)) : 0)
  const subtotal = round2(form.lines.reduce((s, l) => s + lineSubtotal(l), 0))
  const total = form.costs_include_igv ? subtotal : round2(subtotal * (1 + IGV_RATE))
  const invalidLines = form.lines.filter(l => !valid(l.qty) || num(l.qty) <= 0 || !valid(l.unit_cost) || num(l.unit_cost) < 0)

  function toDraft(): PoDraft {
    return {
      id: isNew ? undefined : routeId, provider_id: form!.provider_id, invoice_ref: form!.invoice_ref, note: form!.note,
      costs_include_igv: form!.costs_include_igv,
      items: form!.lines.map(l => ({ product_id: l.product_id, qty: num(l.qty), unit_cost: num(l.unit_cost) })),
    }
  }

  /** Guarda si hace falta; devuelve el id de la orden o null si no se pudo. */
  async function persist(): Promise<string | null> {
    setActionError('')
    if (!form!.provider_id) { setActionError('Elige un proveedor.'); return null }
    if (invalidLines.length) { setActionError('Revisa cantidades y costos: hay líneas incompletas.'); return null }
    if (!isNew && !dirty) return routeId!
    try {
      const id = await save.mutateAsync(toDraft())
      setSavedSnapshot(JSON.stringify(strip(form!)))
      if (isNew) { loadedFor.current = id; navigate(`/proveedores/ordenes/${id}`, { replace: true }) }
      return id
    } catch (e) { setActionError(friendlyPoError(e)); return null }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) { setActionError(friendlyPoError(e)) } finally { setBusy(false) }
  }

  const onSave = () => run(async () => { if (await persist()) setFlash('Orden guardada') })

  const onMarkSent = () => run(async () => {
    const id = await persist(); if (!id) return
    await setStatus.mutateAsync({ id, status: 'enviada' })
    setFlash('Marcada como enviada')
  })

  const onReceive = () => run(async () => {
    if (!form.lines.length) return setActionError('Agrega al menos un producto.')
    const units = form.lines.reduce((s, l) => s + (valid(l.qty) ? num(l.qty) : 0), 0)
    if (!confirm(`¿Recibir la mercadería? Entrarán ${fmtQty(units)} unidades de ${form.lines.length} productos al stock y se actualizarán los costos. No se puede deshacer.`)) return
    const id = await persist(); if (!id) return
    setReceipt(await receive.mutateAsync(id))
    setFlash(null)
    window.scrollTo({ top: 0 })
  })

  const onCancelOrder = () => run(async () => {
    if (!confirm('¿Cancelar esta orden? No mueve stock.')) return
    await setStatus.mutateAsync({ id: routeId!, status: 'cancelada' })
  })

  const onReopen = () => run(async () => { await setStatus.mutateAsync({ id: routeId!, status: 'borrador' }) })

  const onDelete = () => run(async () => {
    if (!confirm('¿Eliminar esta orden definitivamente?')) return
    await remove.mutateAsync(routeId!)
    setSavedSnapshot(JSON.stringify(strip(form)))
    navigate('/proveedores', { replace: true })
  })

  const back = () => { if (!dirty || confirm('Tienes cambios sin guardar. ¿Salir igual?')) navigate('/proveedores') }

  const waText = [
    `Hola${provider?.contact ? ` ${provider.contact}` : ''}, pedido de Ferretería La Constructora${!isNew && order ? ` (${poLabel(order.number)})` : ''}:`,
    ...form.lines.map(l => { const p = byId.get(l.product_id); return `• ${l.qty} ${p?.unit ?? ''} ${p?.name ?? ''}` }),
    form.note && `Nota: ${form.note}`, 'Gracias.',
  ].filter(Boolean).join('\n')
  const wa = whatsappUrl(provider?.phone ?? null, waText)

  return (
    <div className="space-y-3 p-4 pb-[calc(10rem+env(safe-area-inset-bottom))]">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={back} className="-ml-1 flex min-h-11 items-center px-1 text-sm text-amber-800">← Proveedores</button>
        <h1 className="text-lg font-semibold">{isNew ? 'Nueva orden de compra' : order && poLabel(order.number)}</h1>
        <span className={`rounded px-1.5 text-xs ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
        {dirty && <span className="text-xs text-amber-700">● sin guardar</span>}
      </div>

      {receipt ? (
        <ReceiptSummary lines={receipt} onDone={() => setReceipt(null)} />
      ) : (
        <>
          {/* Cabecera */}
          <div className="grid gap-3 rounded-lg bg-white p-3 shadow sm:grid-cols-3">
            <label className="block text-sm sm:col-span-1">
              <span className="mb-1 block text-xs text-stone-500">Proveedor</span>
              <select value={form.provider_id} disabled={!editable} onChange={e => update({ provider_id: e.target.value })}
                      className="min-h-11 w-full rounded border px-2 text-base sm:text-sm">
                <option value="">— Elegir —</option>
                {providers.filter(p => p.active || p.id === form.provider_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-stone-500">N° factura / guía</span>
              <input value={form.invoice_ref} onChange={e => update({ invoice_ref: e.target.value })} placeholder="F001-000123"
                     disabled={status === 'cancelada'} className="min-h-11 w-full rounded border px-2 text-base sm:text-sm" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-stone-500">Nota</span>
              <input value={form.note} onChange={e => update({ note: e.target.value })} disabled={!editable}
                     className="min-h-11 w-full rounded border px-2 text-base sm:text-sm" />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" className="size-5" checked={form.costs_include_igv} disabled={!editable}
                     onChange={e => toggleIgv(e.target.checked)} />
              Los costos de esta orden incluyen IGV
              {!form.costs_include_igv && <span className="text-xs text-stone-500">(se sumará 18% al costo del producto)</span>}
            </label>
          </div>

          {/* Agregar productos */}
          {editable && (
            <div className="relative space-y-2">
              <div className="flex gap-2">
                <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCode(query) } }}
                       placeholder="Agregar producto: nombre, SKU o código" enterKeyHint="done"
                       className="min-h-11 min-w-0 flex-1 rounded border px-2 text-base" />
                <button onClick={() => setScanning(true)} className="min-h-11 shrink-0 rounded bg-amber-700 px-4 text-white" aria-label="Escanear producto">📷</button>
              </div>
              {query.trim().length >= 2 && (
                <ul className="absolute inset-x-0 top-12 z-10 max-h-80 divide-y overflow-y-auto rounded-lg border bg-white shadow-lg">
                  {results.map(p => (
                    <li key={p.id}>
                      <button onClick={() => { addProduct(p); searchRef.current?.focus() }} className="flex w-full items-center gap-2 p-3 text-left hover:bg-amber-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{p.name}</span>
                          <span className="text-xs text-stone-500">{p.sku} · stock {p.stock} {p.unit}{p.cost != null && ` · costo ${money(p.cost)}`}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button onClick={() => setCreating({ name: query.trim() })} className="w-full p-3 text-left text-sm text-amber-800 hover:bg-amber-50">
                      + Crear producto «{query.trim()}»
                    </button>
                  </li>
                </ul>
              )}
              {form.provider_id && (
                <button onClick={addLowStock} className="min-h-11 rounded border bg-white px-3 text-sm">
                  + Agregar los de stock bajo de {provider?.name ?? 'este proveedor'}
                </button>
              )}
            </div>
          )}

          {/* Líneas */}
          <ul className="divide-y rounded-lg bg-white shadow">
            {form.lines.map(l => {
              const p = byId.get(l.product_id)
              const costWithIgv = valid(l.unit_cost) ? num(l.unit_cost) * (form.costs_include_igv ? 1 : 1 + IGV_RATE) : null
              const m = p?.price && costWithIgv != null ? (p.price - costWithIgv) / p.price : null
              const bad = invalidLines.includes(l)
              return (
                <li key={l.key} className="space-y-2 p-3">
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{p?.name ?? 'Producto'}</div>
                      <div className="text-xs text-stone-500">
                        {p?.sku} · stock {p?.stock ?? '—'} {p?.unit}
                        {p?.cost != null && <> · último costo {money(p.cost)}</>}
                        {p?.price != null
                          ? <> · precio {money(p.price)}{m != null && <span className={m < LOW_MARGIN ? 'font-medium text-red-600' : ''}> (margen {Math.round(m * 100)}%)</span>}</>
                          : <span className="text-amber-700"> · sin precio</span>}
                      </div>
                    </div>
                    {editable && (
                      <button onClick={() => setForm(f => f && { ...f, lines: f.lines.filter(x => x.key !== l.key) })}
                              className="-mr-2 grid size-11 shrink-0 place-items-center text-stone-500" aria-label={`Quitar ${p?.name ?? ''}`}>✕</button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-stone-500">Cantidad
                      <input inputMode="decimal" value={l.qty} disabled={!editable} onChange={e => updateLine(l.key, { qty: e.target.value })}
                             className={`mt-0.5 block min-h-11 w-24 rounded border px-2 text-right text-base tabular-nums ${bad && !(valid(l.qty) && num(l.qty) > 0) ? 'border-red-500' : ''}`} />
                    </label>
                    <label className="text-xs text-stone-500">Costo unit. {form.costs_include_igv ? '(con IGV)' : '(sin IGV)'}
                      <input inputMode="decimal" value={l.unit_cost} disabled={!editable} placeholder="0.00"
                             onChange={e => updateLine(l.key, { unit_cost: e.target.value, auto: false })}
                             className={`mt-0.5 block min-h-11 w-28 rounded border px-2 text-right text-base tabular-nums ${bad && !valid(l.unit_cost) ? 'border-red-500' : ''}`} />
                    </label>
                    <div className="ml-auto pb-2 text-right text-sm font-medium tabular-nums">{money(lineSubtotal(l))}</div>
                  </div>
                </li>
              )
            })}
            {!form.lines.length && (
              <li className="p-6 text-center text-sm text-stone-500">
                {editable ? 'Busca o escanea productos para agregarlos a la orden.' : 'Sin productos'}
              </li>
            )}
          </ul>

          <dl className="ml-auto max-w-xs space-y-0.5 text-sm">
            {!form.costs_include_igv && <>
              <div className="flex justify-between text-stone-500"><dt>Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
              <div className="flex justify-between text-stone-500"><dt>IGV (18%)</dt><dd className="tabular-nums">{money(round2(total - subtotal))}</dd></div>
            </>}
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
          </dl>

          {!isNew && order && (
            <p className="text-xs text-stone-500">
              Creada {new Date(order.created_at).toLocaleString('es-PE')}
              {order.ordered_at && ` · enviada ${new Date(order.ordered_at).toLocaleString('es-PE')}`}
              {order.received_at && ` · recibida ${new Date(order.received_at).toLocaleString('es-PE')}`}
            </p>
          )}
        </>
      )}

      {/* Acciones */}
      {!receipt && (
        <div className="fixed inset-x-0 bottom-0 z-20 space-y-2 border-t bg-white px-safe-3 pt-3 pb-safe-3 shadow">
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm">{form.lines.length} productos · <strong>{money(total)}</strong></span>
            {editable && <>
              {(dirty || isNew) && (
                <button onClick={onSave} disabled={busy} className="min-h-11 rounded border px-3 text-sm disabled:opacity-50">Guardar</button>
              )}
              {status === 'borrador' && !isNew && !dirty && wa && form.lines.length > 0 && (
                // El enlace abre WhatsApp en el mismo toque (sin bloqueo de ventanas emergentes) y marca la orden como enviada.
                <a href={wa} target="_blank" rel="noreferrer" onClick={() => setStatus.mutate({ id: routeId!, status: 'enviada' })}
                   className="flex min-h-11 items-center rounded border px-3 text-sm">💬 Pedir por WhatsApp</a>
              )}
              {status === 'borrador' && form.lines.length > 0 && (
                <button onClick={onMarkSent} disabled={busy} className="min-h-11 rounded border px-3 text-sm disabled:opacity-50">Marcar enviada</button>
              )}
              <button onClick={onReceive} disabled={busy || !form.lines.length}
                      className="min-h-11 rounded bg-amber-700 px-4 text-sm text-white disabled:opacity-50">
                {receive.isPending ? 'Recibiendo…' : 'Recibir mercadería'}
              </button>
            </>}
            {!isNew && editable && (
              <button onClick={onCancelOrder} disabled={busy} className="min-h-11 px-2 text-sm text-red-700 disabled:opacity-50">Cancelar orden</button>
            )}
            {status === 'recibida' && dirty && (
              // Recibida: solo se puede completar el N° de factura/guía.
              <button onClick={() => run(async () => {
                await updateRef.mutateAsync({ id: routeId!, invoice_ref: form.invoice_ref })
                setSavedSnapshot(JSON.stringify(strip(form))); setFlash('N° de factura guardado')
              })} disabled={busy} className="min-h-11 rounded bg-amber-700 px-4 text-sm text-white disabled:opacity-50">Guardar N° de factura</button>
            )}
            {status === 'cancelada' && <>
              <button onClick={onReopen} disabled={busy} className="min-h-11 rounded border px-3 text-sm">Reabrir</button>
              <button onClick={onDelete} disabled={busy} className="min-h-11 px-2 text-sm text-red-700">Eliminar</button>
            </>}
            {status === 'recibida' && <Link to="/inventario" className="flex min-h-11 items-center rounded border px-3 text-sm">Ver inventario</Link>}
          </div>
        </div>
      )}

      {flash && (
        <div role="status" className="pointer-events-none fixed inset-x-3 bottom-36 z-40 truncate rounded-lg bg-stone-900/90 px-4 py-2 text-center text-sm text-white shadow
                                      md:inset-x-auto md:left-1/2 md:max-w-md md:-translate-x-1/2">{flash}</div>
      )}

      {scanning && <BarcodeScanner title="Agregar a la orden" onClose={() => setScanning(false)}
                                   onDetected={c => { setScanning(false); handleCode(c) }} />}

      {creating && (
        <QuickCreateSheet initialBarcode={creating.barcode} initialName={creating.name}
                          onClose={() => setCreating(null)}
                          onCreated={p => { setCreating(null); addProduct(p) }} />
      )}
    </div>
  )
}

/** Lo que cuenta para "sin guardar" (sin las claves internas de las líneas). */
function strip(f: Form) {
  return { ...f, lines: f.lines.map(({ product_id, qty, unit_cost }) => ({ product_id, qty, unit_cost })) }
}
