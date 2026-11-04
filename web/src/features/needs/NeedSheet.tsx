import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import Sheet from '@/components/Sheet'
import { rankBy, withCode } from '@/lib/search'
import { useProductMatcher } from '@/hooks/use-product-search'
import { useInventory } from '@/features/inventory/api'
import { useProviderList } from '@/features/providers/api'
import { type Need, type NeedSource, SOURCE_LABEL, useSaveNeed, useSetNeedStatus } from './api'

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`block text-sm ${className}`}><span className="mb-1 block text-xs text-stone-500">{label}</span>{children}</label>
}
const input = 'min-h-11 w-full rounded border px-2 py-2 text-base sm:text-sm'
const SOURCES: NeedSource[] = ['cliente', 'pedido', 'stock_bajo', 'manual']

interface Props {
  need: Need | null
  onClose: () => void
}

/** Alta y edición de un faltante. Puede ser un producto del catálogo o solo una descripción. */
export default function NeedSheet({ need, onClose }: Props) {
  const { data: products = [] } = useInventory()
  const { data: providers = [] } = useProviderList()
  const save = useSaveNeed()
  const setStatus = useSetNeedStatus()
  const [initial] = useState(() => ({
    product_id: need?.product_id ?? null as string | null, description: need?.description ?? '',
    qty: need?.qty != null ? String(need.qty) : '', unit: need?.unit ?? '', source: need?.source ?? 'cliente' as NeedSource,
    provider_id: need?.provider_id ?? '', reference: need?.reference ?? '', notes: need?.notes ?? '',
  }))
  const [f, setF] = useState(initial)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const requestClose = () => { if (!dirty || confirm('Tienes cambios sin guardar. ¿Descartarlos?')) onClose() }
  const [error, setError] = useState('')

  const product = products.find(p => p.id === f.product_id)
  const [query, setQuery] = useState('')
  const textScore = useProductMatcher(query)
  const results = useMemo(() => {
    if (query.trim().length < 2) return []
    return rankBy(products.filter(p => p.track_stock), withCode(query, textScore)).slice(0, 6)
  }, [products, query, textScore])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const qty = f.qty.trim() ? Number(f.qty.replace(',', '.')) : null
    if (qty != null && (Number.isNaN(qty) || qty <= 0)) return setError('La cantidad debe ser mayor que 0.')
    const description = f.description.trim() || product?.name || ''
    if (!description) return setError('Escribe qué falta o elige un producto del catálogo.')
    try {
      await save.mutateAsync({
        id: need?.id, product_id: f.product_id, description, qty, unit: f.unit, source: f.source,
        provider_id: f.provider_id || null, reference: f.reference, notes: f.notes,
      })
      onClose()
    } catch (err) { setError((err as Error).message) }
  }

  async function changeStatus(status: Need['status']) {
    if (!need) return
    try { await setStatus.mutateAsync({ ids: [need.id], status }); onClose() } catch (err) { setError((err as Error).message) }
  }

  const title = need ? 'Faltante' : 'Nuevo faltante'
  return (
    <Sheet onClose={requestClose} label={title} dismissible={!dirty} className="sm:max-w-lg">
      <div className="mb-3 flex items-center pt-2">
        <h2 className="flex-1 text-lg font-semibold">{title}</h2>
        <button onClick={requestClose} aria-label="Cerrar" className="-mr-2 grid size-11 place-items-center text-xl">✕</button>
      </div>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 pb-2">
        <div className="col-span-2 space-y-1">
          <span className="block text-xs text-stone-500">Producto del catálogo (opcional)</span>
          {product ? (
            <div className="flex items-center gap-2 rounded border bg-stone-50 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{product.name}</div>
                <div className="text-xs text-stone-500">{product.sku} · stock {product.stock} {product.unit}</div>
              </div>
              <button type="button" onClick={() => set('product_id', null)} className="min-h-11 shrink-0 rounded border px-2 text-xs">Quitar</button>
            </div>
          ) : (
            <div className="relative">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nombre, SKU o código"
                     className={input} />
              {results.length > 0 && (
                <ul className="absolute inset-x-0 top-12 z-10 max-h-64 divide-y overflow-y-auto rounded-lg border bg-white shadow-lg">
                  {results.map(p => (
                    <li key={p.id}>
                      <button type="button" className="w-full p-3 text-left hover:bg-amber-50"
                              onClick={() => { setF(s => ({ ...s, product_id: p.id, description: s.description || p.name, provider_id: s.provider_id || p.provider_id || '' })); setQuery('') }}>
                        <span className="block truncate text-sm">{p.name}</span>
                        <span className="text-xs text-stone-500">{p.sku} · stock {p.stock} {p.unit}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <Field label={product ? 'Descripción (como se pidió)' : 'Qué falta'} className="col-span-2">
          <input className={input} value={f.description} onChange={e => set('description', e.target.value)}
                 placeholder={product?.name ?? 'Ej. Acople 7/8 a 1/2'} autoFocus={!need} />
        </Field>
        <Field label="Cantidad">
          <input className={input} value={f.qty} onChange={e => set('qty', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Unidad">
          <input className={input} value={f.unit} onChange={e => set('unit', e.target.value)} placeholder={product?.unit ?? 'und, cajas…'} list="need-units" />
          <datalist id="need-units">{['und', 'cajas', 'paquetes', 'juegos', 'rollos', 'm', 'kg'].map(u => <option key={u} value={u} />)}</datalist>
        </Field>
        <Field label="Origen">
          <select className={input} value={f.source} onChange={e => set('source', e.target.value as NeedSource)}>
            {SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Proveedor">
          <select className={input} value={f.provider_id} onChange={e => set('provider_id', e.target.value)}>
            <option value="">— Sin proveedor —</option>
            {providers.filter(p => p.active || p.id === f.provider_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Referencia (nota de venta, cliente…)" className="col-span-2">
          <input className={input} value={f.reference} onChange={e => set('reference', e.target.value)} />
        </Field>
        <Field label="Notas" className="col-span-2">
          <textarea className={input} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
        {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
        <div className="col-span-2 flex flex-wrap justify-end gap-2">
          {need?.status === 'pendiente' && <>
            <button type="button" onClick={() => changeStatus('descartado')} className="min-h-11 rounded border px-3 text-sm text-red-700">Descartar</button>
            <button type="button" onClick={() => changeStatus('atendido')} className="mr-auto min-h-11 rounded border px-3 text-sm text-green-800">Ya llegó</button>
          </>}
          {need && need.status !== 'pendiente' && (
            <button type="button" onClick={() => changeStatus('pendiente')} className="mr-auto min-h-11 rounded border px-3 text-sm">Reabrir</button>
          )}
          <button type="button" onClick={requestClose} className="min-h-11 rounded border px-4 text-sm">Cancelar</button>
          <button disabled={save.isPending} className="min-h-11 rounded bg-amber-700 px-4 text-sm text-white disabled:opacity-50">
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
