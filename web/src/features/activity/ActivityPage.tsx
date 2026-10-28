import { useMemo, useState } from 'react'
import { Bot, Boxes, ChevronDown, Package, ShoppingCart, Truck, type LucideIcon } from 'lucide-react'
import FilterBar from '@/components/FilterBar'
import PageHeader from '@/components/PageHeader'
import { money } from '@/lib/format'
import { todayLocal, useCashierNames } from '@/features/sales/api'
import type { Presentation } from '@/types/domain'
import { KIND_LABEL, useActivity, type ActivityChange, type ActivityKind, type ActivityRow, type StockLine } from './api'

const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`
const shiftDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return todayLocal(new Date(y, m - 1, d + n))
}
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long' })
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const KINDS: ActivityKind[] = ['venta', 'producto', 'compra', 'stock']
const KIND_ICON: Record<ActivityKind, LucideIcon> = { venta: ShoppingCart, producto: Package, compra: Truck, stock: Boxes }
const KIND_COLOR: Record<ActivityKind, string> = {
  venta: 'bg-amber-100 text-amber-800', producto: 'bg-sky-100 text-sky-800',
  compra: 'bg-emerald-100 text-emerald-800', stock: 'bg-violet-100 text-violet-800',
}

/** Nombre de cada campo del producto en el detalle de una edición. */
const FIELD_LABEL: Record<string, string> = {
  name: 'Nombre', sku: 'SKU', barcode: 'Código de barras', brand: 'Marca', category_id: 'Categoría',
  provider_id: 'Proveedor', unit: 'Unidad', price: 'Precio', cost: 'Costo', min_stock: 'Stock mínimo',
  active: 'Activo (a la venta)', needs_review: 'Por revisar', notes: 'Notas', image_path: 'Foto',
  track_stock: 'Lleva stock', job_sources: 'Trabajos: origen', job_color: 'Trabajos: color',
  job_duplex: 'Trabajos: doble cara', job_keywords: 'Trabajos: palabras clave',
  presentations: 'Presentaciones', aliases: 'Otros nombres',
}

function fieldValue(key: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (key === 'image_path') return 'con foto'
  if (key === 'price' || key === 'cost') return money(Number(v))
  if (key === 'job_color') return v ? 'Color' : 'B/N'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (key === 'presentations' && Array.isArray(v)) {
    return (v as Presentation[]).map(p => `${p.name} (${p.qty}) ${money(p.price)}`).join(' · ') || '—'
  }
  if (Array.isArray(v)) return v.join(', ') || '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** La nota del ajuste, si el resumen no la dice ya (en un conteo es el título). */
const noteOf = (r: ActivityRow) => (r.details.note && !r.summary.includes(r.details.note) ? r.details.note : null)
/** Venta hecha sin conexión: se registró al sincronizar, más de 5 min después de cobrarla. */
const syncedLate = (r: ActivityRow) =>
  !!r.details.sold_at && new Date(r.created_at).getTime() - new Date(r.details.sold_at).getTime() > 5 * 60_000

const signed = (n: number) => `${n > 0 ? '+' : ''}${Number(n.toFixed(3))}`

/** Bitácora (admin): ventas, productos, compras y stock, con quién lo hizo y el detalle de cada cambio. */
export default function ActivityPage() {
  const today = todayLocal()
  const ranges = [
    { id: 'hoy', label: 'Hoy', from: today, to: today },
    { id: 'ayer', label: 'Ayer', from: shiftDays(today, -1), to: shiftDays(today, -1) },
    { id: '7d', label: 'Últimos 7 días', from: shiftDays(today, -6), to: today },
    { id: '30d', label: 'Últimos 30 días', from: shiftDays(today, -29), to: today },
  ]
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [kind, setKind] = useState<ActivityKind | ''>('')
  const [actor, setActor] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  const { data, isLoading, isFetching, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useActivity({ from, to, kind, actor, q })
  const { data: names = {} } = useCashierNames()
  const rows = useMemo(() => data?.pages.flat() ?? [], [data])

  // Agrupadas por día local, en el orden en que llegan (más reciente primero).
  const byDay = useMemo(() => {
    const groups: [string, ActivityRow[]][] = []
    for (const r of rows) {
      const d = todayLocal(new Date(r.created_at))
      if (groups.at(-1)?.[0] === d) groups.at(-1)![1].push(r)
      else groups.push([d, [r]])
    }
    return groups
  }, [rows])

  const activePreset = ranges.find(r => r.from === from && r.to === to)?.id
  const badRange = from > to
  const filterSummary = [
    activePreset === 'hoy' ? '' : ranges.find(r => r.id === activePreset)?.label ?? `${from} – ${to}`,
    kind && KIND_LABEL[kind], actor && (names[actor] ?? 'Usuario'), q.trim() && `“${q.trim()}”`,
  ].filter(Boolean).join(' · ')
  const resetFilters = () => { setFrom(today); setTo(today); setKind(''); setActor(''); setQ('') }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 md:p-4">
      <PageHeader title="Actividad" />

      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto, OC-0012, venta #…"
             aria-label="Buscar en la actividad" className="min-h-11 w-full rounded-lg border bg-white px-3 text-base" />

      <FilterBar summary={filterSummary} onReset={filterSummary ? resetFilters : undefined}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-500">Desde
            <input type="date" value={from} max={today} onChange={e => e.target.value && setFrom(e.target.value)}
                   className="mt-1 block min-h-11 rounded border bg-white px-2 text-base text-stone-900" />
          </label>
          <label className="text-xs text-stone-500">Hasta
            <input type="date" value={to} max={today} onChange={e => e.target.value && setTo(e.target.value)}
                   className="mt-1 block min-h-11 rounded border bg-white px-2 text-base text-stone-900" />
          </label>
          {ranges.map(r => (
            <button key={r.id} onClick={() => { setFrom(r.from); setTo(r.to) }} className={chip(activePreset === r.id)}>{r.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(['', ...KINDS] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>{k ? KIND_LABEL[k] : 'Todo'}</button>
          ))}
          <select value={actor} onChange={e => setActor(e.target.value)} aria-label="Usuario"
                  className="min-h-11 rounded-full border bg-white px-3 text-sm">
            <option value="">Todos los usuarios</option>
            {Object.entries(names).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>
      </FilterBar>

      {badRange && <p className="text-red-600">La fecha “desde” es posterior a “hasta”.</p>}
      {isLoading && !badRange && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">No se pudo cargar la actividad: {(error as Error).message}</p>}
      {!isLoading && !error && !badRange && !rows.length && (
        <p className="rounded-lg bg-white p-6 text-center text-stone-500 shadow">No hay actividad con estos filtros.</p>
      )}

      <div className={`space-y-3 ${isFetching && !isFetchingNextPage && !isLoading ? 'opacity-60' : ''}`}>
        {byDay.map(([day, list]) => (
          <section key={day} className="rounded-lg bg-white shadow">
            <h2 className="border-b px-3 py-2 text-xs font-medium text-stone-500 first-letter:uppercase">{dayLabel(day)}</h2>
            <ul className="divide-y">
              {list.map(r => (
                <ActivityItem key={r.id} row={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
                className="min-h-12 w-full rounded-lg border bg-white text-sm disabled:opacity-60">
          {isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
        </button>
      )}
    </div>
  )
}

function ActivityItem({ row: r, open, onToggle }: { row: ActivityRow; open: boolean; onToggle: () => void }) {
  const Icon = KIND_ICON[r.kind]
  // Costo y foto ya se leen completos en el resumen: sin desplegable.
  const changes = Object.keys(r.details.changes ?? {}).filter(k => k !== 'cost' && k !== 'image_path')
  const hasDetail = !!(changes.length || Array.isArray(r.details.items) || noteOf(r) || r.details.customer_name || syncedLate(r))
  return (
    <li>
      <button onClick={hasDetail ? onToggle : undefined} aria-expanded={hasDetail ? open : undefined}
              className={`flex w-full items-start gap-3 px-3 py-2 text-left ${hasDetail ? 'active:bg-stone-50' : 'cursor-default'}`}>
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${KIND_COLOR[r.kind]}`}><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{r.summary}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
            <span className="tabular-nums">{timeOf(r.created_at)}</span>
            <span>{r.actor_name ?? 'Sistema'}</span>
            {r.via === 'claude' && <span className="inline-flex items-center gap-0.5 rounded bg-stone-100 px-1"><Bot className="size-3" />vía Claude</span>}
          </span>
        </span>
        {hasDetail && <ChevronDown className={`mt-1.5 size-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && hasDetail && <div className="px-3 pb-3 pl-14 text-sm"><Detail row={r} /></div>}
    </li>
  )
}

function Detail({ row: r }: { row: ActivityRow }) {
  const d = r.details
  return (
    <div className="space-y-1">
      {d.changes && (
        <dl className="space-y-1">
          {Object.entries(d.changes).map(([k, c]: [string, ActivityChange]) => (
            <div key={k}>
              <dt className="text-xs text-stone-500">{FIELD_LABEL[k] ?? k}</dt>
              <dd className="break-words">
                <span className="text-stone-500 line-through decoration-stone-300">{fieldValue(k, c.antes)}</span>
                {' → '}<span className="font-medium">{fieldValue(k, c.despues)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {Array.isArray(d.items) && (
        <ul className="divide-y rounded border">
          {(d.items as StockLine[]).map(i => (
            <li key={i.product_id} className="flex gap-2 px-2 py-1">
              <span className="min-w-0 flex-1">{i.name} <span className="text-xs text-stone-500">{i.sku}</span></span>
              <span className={`tabular-nums ${i.qty < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{signed(i.qty)}</span>
              <span className="w-24 text-right tabular-nums text-stone-500">queda {Number(i.stock.toFixed(3))} {i.unit}</span>
            </li>
          ))}
        </ul>
      )}
      {noteOf(r) && <p className="text-stone-600">Nota: {noteOf(r)}</p>}
      {d.customer_name && <p className="text-stone-600">Cliente: {d.customer_name}</p>}
      {syncedLate(r) && (
        <p className="text-stone-600">Cobrada sin conexión el {new Date(d.sold_at!).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}; se registró al sincronizar.</p>
      )}
    </div>
  )
}
