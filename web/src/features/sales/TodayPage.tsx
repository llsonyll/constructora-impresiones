import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useQueryClient } from '@tanstack/react-query'
import { localDb } from '@/db/local'
import { useAuth } from '@/features/auth/AuthProvider'
import { money } from '@/lib/format'
import type { PaymentMethod, Shift } from '@/types/domain'
import {
  type DaySale, type LineKind, PAYMENT_LABEL, SHIFT_LABEL, dayRange, salesKeys, todayLocal,
  useCashierNames, useDaySales, useVoidSale,
} from './api'
import { Breakdown, KindByShift, kindShiftMatrix } from './summary'

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`

/** Ventas del día: totales por medio de pago, turno y tipo; detalle de cada venta y anulación (admin). */
export default function TodayPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [day, setDay] = useState(todayLocal)
  const [shift, setShift] = useState<Shift | ''>('')
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [cashier, setCashier] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const qc = useQueryClient()
  const { data: synced = [], isLoading, error } = useDaySales(day)
  const { data: names = {} } = useCashierNames()
  const voidSale = useVoidSale(day)

  // Ventas que siguen en la cola del equipo (sin internet o sincronizando): también cuentan para el día.
  const outbox = useLiveQuery(() => localDb.outbox.toArray(), [], [])
  const products = useLiveQuery(() => localDb.products.toArray(), [], [])
  // Al vaciarse la cola, las ventas ya están en el servidor: recargar.
  useEffect(() => { void qc.invalidateQueries({ queryKey: salesKeys.day(day) }) }, [outbox.length, day, qc])

  const sales = useMemo(() => {
    const { from, to } = dayRange(day)
    const ids = new Set(synced.map(s => s.id))
    const services = new Set(products.filter(p => p.track_stock === false).map(p => p.id))
    const pending: DaySale[] = outbox
      .filter(s => !ids.has(s.id) && s.sold_at >= from && s.sold_at < to)
      .map(s => ({
        id: s.id, number: null, cashier_id: profile?.id ?? null, shift: s.shift, payment_method: s.payment_method,
        total: s.total, status: 'completada', sold_at: s.sold_at, customer_name: s.customer_name ?? null,
        note: s.note ?? null, pending: true,
        items: s.items.map(i => ({
          description: i.description, qty: i.qty, unit_price: i.unit_price, subtotal: Math.round(i.qty * i.unit_price * 100) / 100,
          kind: (i.product_id == null ? 'otros' : services.has(i.product_id) ? 'impresion' : 'ferreteria') as LineKind,
        })),
      }))
    return [...pending, ...synced].sort((a, b) => b.sold_at.localeCompare(a.sold_at))
  }, [synced, outbox, products, day, profile?.id])

  const filtered = sales.filter(s => (!shift || s.shift === shift) && (!method || s.payment_method === method)
    && (!cashier || s.cashier_id === cashier))
  const valid = filtered.filter(s => s.status === 'completada')
  const voided = filtered.filter(s => s.status === 'anulada')
  const listed = showVoided ? filtered : valid

  const total = valid.reduce((s, v) => s + v.total, 0)
  const sumBy = <K extends string>(keyOf: (v: DaySale) => K) =>
    valid.reduce((acc, v) => ({ ...acc, [keyOf(v)]: (acc[keyOf(v)] ?? 0) + v.total }), {} as Partial<Record<K, number>>)
  const byMethod = sumBy(v => v.payment_method)
  const matrix = kindShiftMatrix(valid)
  const pendingCount = valid.filter(v => v.pending).length
  const cashiers = [...new Set(sales.map(s => s.cashier_id).filter((x): x is string => !!x))]
  const isToday = day === todayLocal()

  async function onVoid(s: DaySale) {
    if (!confirm(`¿Anular la venta #${s.number} por ${money(s.total)}? Se repone el stock de los productos.`)) return
    try { await voidSale.mutateAsync(s.id) } catch { /* se muestra abajo */ }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">{isToday ? 'Ventas de hoy' : 'Ventas del día'}</h1>
        <input type="date" value={day} max={todayLocal()} onChange={e => e.target.value && setDay(e.target.value)}
               className="min-h-11 rounded border bg-white px-2 text-base" aria-label="Día" />
        {!isToday && <button onClick={() => setDay(todayLocal())} className="min-h-11 rounded border bg-white px-3 text-sm">Hoy</button>}
      </div>

      <section className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-3 shadow">
          <div className="text-xs text-stone-500">Total</div>
          <div className="text-2xl font-semibold tabular-nums">{money(total)}</div>
          <div className="text-xs text-stone-500">
            {valid.length} venta{valid.length === 1 ? '' : 's'}
            {pendingCount > 0 && <span className="text-amber-700"> · {pendingCount} por sincronizar</span>}
            {voided.length > 0 && ` · ${voided.length} anulada${voided.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <Breakdown title="Por medio de pago" rows={Object.entries(byMethod).map(([k, v]) => [PAYMENT_LABEL[k as PaymentMethod], v!])} />
      </section>
      <KindByShift matrix={matrix} />

      <div className="flex flex-wrap gap-2">
        {(['', 'manana', 'tarde'] as const).map(s => (
          <button key={s} onClick={() => setShift(s)} className={chip(shift === s)}>{s ? SHIFT_LABEL[s] : 'Ambos turnos'}</button>
        ))}
        <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod | '')} aria-label="Medio de pago"
                className="min-h-11 rounded-full border bg-white px-3 text-sm">
          <option value="">Todo medio de pago</option>
          {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isAdmin && cashiers.length > 1 && (
          <select value={cashier} onChange={e => setCashier(e.target.value)} aria-label="Cajero"
                  className="min-h-11 rounded-full border bg-white px-3 text-sm">
            <option value="">Todos los cajeros</option>
            {cashiers.map(id => <option key={id} value={id}>{names[id] ?? 'Cajero'}</option>)}
          </select>
        )}
        {voided.length > 0 && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} />
            Ver anuladas
          </label>
        )}
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">No se pudieron cargar las ventas: {(error as Error).message}</p>}
      {voidSale.error && <p className="text-red-600">No se pudo anular: {(voidSale.error as Error).message}</p>}

      <ul className="divide-y rounded-lg bg-white shadow">
        {listed.map(s => {
          const isOpen = open === s.id
          const anulada = s.status === 'anulada'
          return (
            <li key={s.id}>
              <button onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-amber-50">
                <span className="w-12 shrink-0 tabular-nums text-stone-500">{time(s.sold_at)}</span>
                <div className={`min-w-0 flex-1 ${anulada ? 'text-stone-400' : ''}`}>
                  <div className={`truncate text-sm ${anulada ? 'line-through' : ''}`}>{s.items.map(i => `${i.qty}× ${i.description}`).join(', ')}</div>
                  <div className="text-xs text-stone-500">
                    {s.number != null ? `#${s.number}` : <span className="text-amber-700">⏳ por sincronizar</span>}
                    {' · '}{PAYMENT_LABEL[s.payment_method]} · {SHIFT_LABEL[s.shift]}
                    {isAdmin && s.cashier_id && ` · ${names[s.cashier_id] ?? 'Cajero'}`}
                    {anulada && <span className="ml-1 rounded bg-stone-200 px-1 text-stone-600">anulada</span>}
                  </div>
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${anulada ? 'text-stone-400 line-through' : ''}`}>{money(s.total)}</span>
              </button>
              {isOpen && (
                <div className="space-y-2 border-t bg-stone-50 px-3 py-2 text-sm">
                  <table className="w-full">
                    <tbody>
                      {s.items.map((i, n) => (
                        <tr key={n}>
                          <td className="py-0.5">{i.description}</td>
                          <td className="w-24 text-right tabular-nums text-stone-500">{i.qty} × {money(i.unit_price)}</td>
                          <td className="w-20 text-right tabular-nums">{money(i.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(s.customer_name || s.note) && <p className="text-stone-500">{[s.customer_name, s.note].filter(Boolean).join(' · ')}</p>}
                  {isAdmin && !anulada && !s.pending && (
                    <div className="flex justify-end">
                      <button onClick={() => onVoid(s)} disabled={voidSale.isPending}
                              className="min-h-11 rounded border border-red-300 px-3 text-red-700 disabled:opacity-50">Anular venta</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {!isLoading && !listed.length && <li className="p-6 text-center text-stone-500">No hay ventas {isToday ? 'hoy' : 'ese día'}.</li>}
      </ul>
    </div>
  )
}
