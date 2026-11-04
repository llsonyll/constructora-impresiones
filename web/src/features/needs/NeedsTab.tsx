import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { type InventoryProduct, useInventory } from '@/features/inventory/api'
import QuickCreateSheet from '@/features/inventory/QuickCreateSheet'
import { poLabel, useProviderList } from '@/features/providers/api'
import { fmtNeedQty, type Need, type NeedStatus, SOURCE_SHORT, useLinkNeedProduct, useNeeds } from './api'
import NeedSheet from './NeedSheet'

const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`
const date = (s: string | null) => s ? new Date(s).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : ''
const SOURCE_STYLE: Record<Need['source'], string> = {
  pedido: 'bg-orange-100 text-orange-800', cliente: 'bg-sky-100 text-sky-800',
  stock_bajo: 'bg-violet-100 text-violet-800', manual: 'bg-stone-200 text-stone-700',
}
const FILTERS: { id: NeedStatus; label: string }[] = [
  { id: 'pendiente', label: 'Pendientes' }, { id: 'atendido', label: 'Atendidos' }, { id: 'descartado', label: 'Descartados' },
]

/** En una orden abierta (borrador o enviada): ya se pidió, falta que llegue. */
const ordered = (n: Need) => n.po_id != null && (n.po_status === 'borrador' || n.po_status === 'enviada')

/**
 * Faltantes: lo que se necesita y aún no se consiguió (líneas no atendidas por un proveedor, lo que pidió un cliente…).
 * Los pendientes se agrupan por proveedor; desde cada grupo se arma la orden de compra con los que están en el catálogo.
 */
export default function NeedsTab() {
  const { data: needs = [], isLoading, error } = useNeeds()
  const { data: products = [] } = useInventory()
  const { data: providers = [] } = useProviderList()
  const link = useLinkNeedProduct()
  const navigate = useNavigate()
  const [status, setStatus] = useState<NeedStatus>('pendiente')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Need | 'new' | null>(null)
  const [registering, setRegistering] = useState<Need | null>(null)

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const providerName = useMemo(() => new Map(providers.map(p => [p.id, p.name])), [providers])
  const counts = useMemo(() => {
    const c: Record<NeedStatus, number> = { pendiente: 0, atendido: 0, descartado: 0 }
    for (const n of needs) c[n.status]++
    return c
  }, [needs])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return needs.filter(n => n.status === status && (!q
      || n.description.toLowerCase().includes(q)
      || (n.product_id && byId.get(n.product_id)?.name.toLowerCase().includes(q))
      || (n.reference?.toLowerCase().includes(q) ?? false)
      || (n.provider_id && providerName.get(n.provider_id)?.toLowerCase().includes(q))))
  }, [needs, status, query, byId, providerName])

  // Pendientes por proveedor (los "sin proveedor" al final).
  const groups = useMemo(() => {
    const m = new Map<string, Need[]>()
    for (const n of rows) {
      const k = n.provider_id ?? ''
      m.set(k, [...(m.get(k) ?? []), n])
    }
    return [...m.entries()]
      .map(([pid, items]) => ({ pid, name: pid ? providerName.get(pid) ?? 'Proveedor' : 'Sin proveedor', items }))
      .sort((a, b) => (a.pid ? 0 : 1) - (b.pid ? 0 : 1) || a.name.localeCompare(b.name))
  }, [rows, providerName])

  function makeOrder(pid: string, items: Need[]) {
    const ready = items.filter(n => n.product_id && !ordered(n))
    if (!ready.length) return toast('Primero registra en el catálogo los productos de este grupo.')
    const qs = new URLSearchParams({ faltantes: ready.map(n => n.id).join(',') })
    if (pid) qs.set('proveedor', pid)
    navigate(`/proveedores/ordenes/nueva?${qs}`)
  }

  async function onRegistered(n: Need, p: Pick<InventoryProduct, 'id' | 'name'>) {
    setRegistering(null)
    try { await link.mutateAsync({ id: n.id, product_id: p.id }); toast(`Registrado: ${p.name}`) }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setStatus(f.id)} className={chip(status === f.id)}>
            {f.label}{f.id === 'pendiente' && <span className="ml-1 opacity-70">{counts.pendiente}</span>}
          </button>
        ))}
        <button onClick={() => setEditing('new')} className="ml-auto min-h-11 rounded border bg-white px-3 text-sm">+ Faltante</button>
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar producto, proveedor o referencia"
             className="min-h-11 w-full rounded border px-2 text-base" />
      {status !== 'pendiente' && <p className="text-xs text-stone-500">Se muestran los de los últimos 60 días.</p>}

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">Error: {(error as Error).message}</p>}

      {status === 'pendiente' ? groups.map(g => {
        const ready = g.items.filter(n => n.product_id && !ordered(n)).length
        return (
          <section key={g.pid} className="overflow-hidden rounded-lg bg-white shadow">
            <header className="flex items-center gap-2 border-b bg-stone-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{g.name}</div>
                <div className="text-xs text-stone-500">{g.items.length} pendiente{g.items.length === 1 ? '' : 's'}</div>
              </div>
              {ready > 0 && (
                <button onClick={() => makeOrder(g.pid, g.items)} className="min-h-11 shrink-0 rounded bg-amber-700 px-3 text-xs text-white">
                  Pedir {ready} en una orden
                </button>
              )}
            </header>
            <ul className="divide-y">{g.items.map(n => <NeedRow key={n.id} n={n} product={n.product_id ? byId.get(n.product_id) : undefined}
                                                           onOpen={() => setEditing(n)} onRegister={() => setRegistering(n)} />)}</ul>
          </section>
        )
      }) : (
        <ul className="divide-y rounded-lg bg-white shadow">
          {rows.map(n => <NeedRow key={n.id} n={n} product={n.product_id ? byId.get(n.product_id) : undefined}
                                  providerName={n.provider_id ? providerName.get(n.provider_id) : undefined}
                                  onOpen={() => setEditing(n)} />)}
        </ul>
      )}
      {!isLoading && !rows.length && (
        <p className="rounded-lg bg-white p-6 text-center text-sm text-stone-500 shadow">
          {status === 'pendiente'
            ? 'No hay faltantes pendientes. Anota aquí lo que un cliente pidió y no había, o lo que un proveedor no atendió.'
            : 'Nada en los últimos 60 días.'}
        </p>
      )}

      {editing && <NeedSheet need={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {registering && (
        <QuickCreateSheet initialName={registering.description.toUpperCase()}
                          onCreated={p => onRegistered(registering, p)} onClose={() => setRegistering(null)} />
      )}
    </>
  )
}

function NeedRow({ n, product, providerName, onOpen, onRegister }: {
  n: Need; product?: InventoryProduct; providerName?: string; onOpen: () => void; onRegister?: () => void
}) {
  const qty = fmtNeedQty(n)
  return (
    <li className="flex items-center gap-2 pr-2">
      <button onClick={onOpen} className="min-w-0 flex-1 p-3 text-left hover:bg-amber-50">
        <div className="text-sm">
          {n.description}{qty && <span className="ml-1 font-semibold tabular-nums">· {qty}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500">
          <span className={`rounded px-1.5 ${SOURCE_STYLE[n.source]}`}>{SOURCE_SHORT[n.source]}</span>
          {product
            ? <span>{product.sku} · stock {product.stock} {product.unit}</span>
            : <span className="text-orange-700">No está en el catálogo</span>}
          {providerName && <span>{providerName}</span>}
          {n.reference && <span>{n.reference}</span>}
          {n.po_number != null && n.status === 'pendiente' && ordered(n) && (
            <span className="rounded bg-blue-100 px-1.5 text-blue-800">Pedido en {poLabel(n.po_number)}</span>
          )}
          {n.status === 'atendido' && n.po_number != null && <span>Llegó con {poLabel(n.po_number)}</span>}
          <span>{date(n.status === 'pendiente' ? n.created_at : n.resolved_at)}</span>
        </div>
      </button>
      {!product && onRegister && (
        <button onClick={onRegister} className="min-h-11 shrink-0 rounded border px-2 text-xs">Registrar</button>
      )}
    </li>
  )
}
