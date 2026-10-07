import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { money } from '@/lib/format'
import {
  type PoStatus, type Provider, poLabel, STATUS_LABEL, STATUS_STYLE, usePurchaseOrders, useProviderList, whatsappUrl,
} from './api'
import ProviderSheet from './ProviderSheet'

const date = (s: string | null) => s ? new Date(s).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : ''

/** Proveedores y órdenes de compra. La pestaña va en la URL para que "atrás" desde una orden vuelva a la misma. */
export default function ProvidersPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'proveedores' ? 'proveedores' : 'ordenes'
  const setTab = (t: string) => setParams(t === 'ordenes' ? {} : { tab: t }, { replace: true })

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Proveedores</h1>
        <Link to="/proveedores/ordenes/nueva" className="flex min-h-11 items-center rounded bg-amber-700 px-3 text-sm text-white">+ Nueva orden</Link>
      </div>
      <div className="flex gap-1 border-b">
        {[['ordenes', 'Órdenes de compra'], ['proveedores', 'Proveedores']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
                  className={`min-h-11 border-b-2 px-3 text-sm ${tab === id ? 'border-amber-700 font-medium text-amber-800' : 'border-transparent text-stone-500'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'ordenes' ? <OrdersTab /> : <ProvidersTab />}
    </div>
  )
}

const STATUS_FILTERS: { id: PoStatus | 'abiertas' | 'todas'; label: string }[] = [
  { id: 'abiertas', label: 'Pendientes' }, { id: 'recibida', label: 'Recibidas' },
  { id: 'cancelada', label: 'Canceladas' }, { id: 'todas', label: 'Todas' },
]

function OrdersTab() {
  const { data: orders = [], isLoading, error } = usePurchaseOrders()
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]['id']>('abiertas')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(o =>
      (status === 'todas' || (status === 'abiertas' ? o.status === 'borrador' || o.status === 'enviada' : o.status === status))
      && (!q || o.provider_name.toLowerCase().includes(q) || poLabel(o.number).toLowerCase().includes(q)
          || (o.invoice_ref?.toLowerCase().includes(q) ?? false)))
  }, [orders, status, query])

  const openCount = orders.filter(o => o.status === 'borrador' || o.status === 'enviada').length

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(f => (
          <button key={f.id} onClick={() => setStatus(f.id)}
                  className={`min-h-11 rounded-full border px-4 text-sm ${status === f.id ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`}>
            {f.label}{f.id === 'abiertas' && <span className="ml-1 opacity-70">{openCount}</span>}
          </button>
        ))}
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar proveedor, OC o factura"
             className="min-h-11 w-full rounded border px-2 text-base" />

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">Error: {(error as Error).message}</p>}
      <ul className="divide-y rounded-lg bg-white shadow">
        {rows.map(o => (
          <li key={o.id}>
            <Link to={`/proveedores/ordenes/${o.id}`} className="flex items-center gap-3 p-3 hover:bg-amber-50">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{o.provider_name}</div>
                <div className="text-xs text-stone-500">
                  {poLabel(o.number)} · {o.item_count} producto{o.item_count === 1 ? '' : 's'}
                  {o.invoice_ref && ` · ${o.invoice_ref}`} · {date(o.received_at ?? o.ordered_at ?? o.created_at)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{money(o.total)}</div>
                <span className={`rounded px-1.5 text-xs ${STATUS_STYLE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
              </div>
            </Link>
          </li>
        ))}
        {!isLoading && !rows.length && (
          <li className="p-6 text-center text-sm text-stone-500">
            {orders.length ? 'Sin resultados' : 'Aún no hay órdenes. Crea una con “+ Nueva orden” cuando hagas un pedido o llegue mercadería.'}
          </li>
        )}
      </ul>
    </>
  )
}

function ProvidersTab() {
  const { data: providers = [], isLoading, error } = useProviderList()
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Provider | 'new' | null>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return providers.filter(p => (showInactive || p.active)
      && (!q || p.name.toLowerCase().includes(q) || (p.ruc ?? '').includes(q) || (p.contact?.toLowerCase().includes(q) ?? false)))
  }, [providers, query, showInactive])

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nombre, RUC o contacto"
               className="min-h-11 min-w-0 flex-1 rounded border px-2 text-base" />
        <label className="flex min-h-11 items-center gap-2 px-1 text-sm">
          <input type="checkbox" className="size-5" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Inactivos
        </label>
        <button onClick={() => setEditing('new')} className="min-h-11 rounded border bg-white px-3 text-sm">+ Proveedor</button>
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">Error: {(error as Error).message}</p>}
      <ul className="divide-y rounded-lg bg-white shadow">
        {rows.map(p => {
          const wa = whatsappUrl(p.phone)
          return (
            <li key={p.id} className="flex items-center gap-2 pr-2">
              <button onClick={() => setEditing(p)} className="min-w-0 flex-1 p-3 text-left hover:bg-amber-50">
                <div className="truncate font-medium">
                  {p.name}{!p.active && <span className="ml-2 rounded bg-stone-200 px-1 text-xs font-normal">inactivo</span>}
                </div>
                <div className="truncate text-xs text-stone-500">
                  {[p.ruc && `RUC ${p.ruc}`, p.contact, p.phone, `${p.product_count} productos`].filter(Boolean).join(' · ')}
                </div>
              </button>
              {wa && <a href={wa} target="_blank" rel="noreferrer" className="grid size-11 shrink-0 place-items-center rounded border" aria-label={`WhatsApp ${p.name}`}>💬</a>}
              <Link to={`/proveedores/ordenes/nueva?proveedor=${p.id}`} className="flex min-h-11 shrink-0 items-center rounded border px-2 text-xs">+ Orden</Link>
            </li>
          )
        })}
        {!isLoading && !rows.length && <li className="p-6 text-center text-sm text-stone-500">Sin proveedores</li>}
      </ul>

      {editing && <ProviderSheet provider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    </>
  )
}
