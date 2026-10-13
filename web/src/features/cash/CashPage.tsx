import { useMemo, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import PageHeader from '@/components/PageHeader'
import { localDb } from '@/db/local'
import { useAuth } from '@/features/auth/AuthProvider'
import { PAYMENT_LABEL, SHIFT_LABEL, dayRange, todayLocal, useCashierNames, useDaySales } from '@/features/sales/api'
import CajaIcon from '@/components/CajaIcon'
import { CAJAS, CAJA_LABEL, CAJA_THEME } from '@/lib/caja'
import { currentShift, money, round2 } from '@/lib/format'
import type { Caja, PaymentMethod, Shift } from '@/types/domain'
import {
  type CashClosure, type CashExpense, friendlyCashError, useAddExpense, useCloseCash, useClosures, useDeleteExpense, useExpenses, useReopenCash,
} from './api'

const SHIFTS: Shift[] = ['manana', 'tarde']
const time = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' })
}
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return todayLocal(d) }
const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() === '' || Number.isNaN(v) ? null : v }

function Diff({ value, big = false }: { value: number; big?: boolean }) {
  const v = round2(value)
  const cls = v === 0 ? 'text-green-700' : v > 0 ? 'text-sky-700' : 'text-red-600'
  return <span className={`${cls} tabular-nums ${big ? 'text-lg font-semibold' : ''}`}>{v === 0 ? 'Cuadra ✓' : v > 0 ? `Sobra ${money(v)}` : `Falta ${money(-v)}`}</span>
}

/**
 * Cierre de caja por caja y turno: ventas por medio de pago, gastos pagados con el efectivo de la caja y
 * efectivo esperado (sin monto de apertura) contra el contado. Abajo, el historial de cierres.
 */
export default function CashPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [day, setDay] = useState(todayLocal)
  const [caja, setCaja] = useState<Caja>(() => { try { return localStorage.getItem('pos.caja') === 'copias' ? 'copias' : 'ferreteria' } catch { return 'ferreteria' } })
  const [shift, setShift] = useState<Shift>(() => currentShift() as Shift)

  const { data: sales = [], isLoading } = useDaySales(day)
  const { data: expenses = [] } = useExpenses(day)
  const { data: closures = [] } = useClosures(daysAgo(30), todayLocal())
  const { data: dayClosures = [] } = useClosures(day, day)
  const { data: names = {} } = useCashierNames()
  const outbox = useLiveQuery(() => localDb.outbox.toArray(), [], [])

  const closure = dayClosures.find(c => c.caja === caja && c.shift === shift) ?? null
  const mySales = sales.filter(s => s.status === 'completada' && s.caja === caja && s.shift === shift)
  const myExpenses = expenses.filter(e => e.caja === caja && e.shift === shift)
  const byMethod = useMemo(() => {
    const m = new Map<PaymentMethod, number>()
    for (const s of mySales) m.set(s.payment_method, round2((m.get(s.payment_method) ?? 0) + s.total))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [mySales])
  const total = round2(mySales.reduce((a, s) => a + s.total, 0))
  const cash = round2(mySales.filter(s => s.payment_method === 'efectivo').reduce((a, s) => a + s.total, 0))
  const spent = round2(myExpenses.reduce((a, e) => a + e.amount, 0))
  const expected = round2(cash - spent)
  // Ventas guardadas en este equipo que aún no llegan al servidor: el cierre no las vería.
  const { from, to } = dayRange(day)
  const pending = outbox.filter(s => (s.caja ?? 'ferreteria') === caja && s.shift === shift && s.sold_at >= from && s.sold_at < to).length
  const theme = CAJA_THEME[caja]

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title="Cierre de caja">
        <input type="date" value={day} max={todayLocal()} onChange={e => e.target.value && setDay(e.target.value)}
               className="min-h-11 rounded-lg border bg-white px-2 text-base" aria-label="Día" />
      </PageHeader>

      <div role="tablist" aria-label="Caja" className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200 p-1">
        {CAJAS.map(c => {
          const closed = dayClosures.filter(x => x.caja === c).length
          return (
            <button key={c} role="tab" aria-selected={caja === c} onClick={() => setCaja(c)}
                    className={`flex min-h-12 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium ${caja === c ? `${CAJA_THEME[c].solid} text-white shadow` : 'text-stone-600'}`}>
              <CajaIcon caja={c} />{CAJA_LABEL[c]}
              {closed > 0 && <span className={`whitespace-nowrap rounded-full px-1.5 text-xs ${caja === c ? 'bg-white/25' : 'bg-white'}`}>{closed}/2 ✓</span>}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SHIFTS.map(t => {
          const done = dayClosures.some(x => x.caja === caja && x.shift === t)
          return (
            <button key={t} onClick={() => setShift(t)} aria-pressed={shift === t}
                    className={`min-h-11 rounded-full border px-4 text-sm ${shift === t ? `${theme.border} ${theme.solid} text-white` : 'bg-white'}`}>
              {SHIFT_LABEL[t]}{done ? ' ✓ cerrado' : ''}
            </button>
          )
        })}
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {closure
        ? <ClosedCard closure={closure} liveTotal={total} closedBy={names[closure.closed_by] ?? 'Usuario'} canReopen={isAdmin} />
        : <OpenShift key={`${caja}-${day}-${shift}`} caja={caja} day={day} shift={shift} total={total} count={mySales.length}
                     byMethod={byMethod} cash={cash} expected={expected} pending={pending}
                     expenses={myExpenses} names={names} myId={profile?.id} isAdmin={isAdmin} />}

      <section className="rounded-lg bg-white p-3 shadow">
        <h2 className="mb-1 text-xs text-stone-500">Últimos cierres (30 días)</h2>
        <ul className="divide-y">
          {closures.map(c => (
            <li key={c.id}>
              <button onClick={() => { setDay(c.day); setCaja(c.caja); setShift(c.shift) }}
                      className="flex w-full items-center gap-2 py-2 text-left text-sm">
                <span className="min-w-0 flex-1">
                  <span className="capitalize">{dayLabel(c.day)}</span> · {SHIFT_LABEL[c.shift]} · <CajaIcon caja={c.caja} />
                  <span className="block text-xs text-stone-500">{money(c.total_sales)} · {names[c.closed_by] ?? 'Usuario'}</span>
                </span>
                <Diff value={c.difference} />
              </button>
            </li>
          ))}
          {!closures.length && <li className="py-3 text-center text-sm text-stone-500">Todavía no hay cierres.</li>}
        </ul>
      </section>
    </div>
  )
}

function OpenShift({ caja, day, shift, total, count, byMethod, cash, expected, pending, expenses, names, myId, isAdmin }: {
  caja: Caja; day: string; shift: Shift; total: number; count: number; byMethod: [PaymentMethod, number][]; cash: number
  expected: number; pending: number; expenses: CashExpense[]; names: Record<string, string>
  myId?: string; isAdmin: boolean
}) {
  const add = useAddExpense()
  const del = useDeleteExpense()
  const close = useCloseCash()
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const c = num(counted)
  const theme = CAJA_THEME[caja]

  async function onExpense(e: FormEvent) {
    e.preventDefault()
    const a = num(amount)
    if (a == null || a <= 0 || !desc.trim()) return setError('Pon el monto y en qué se gastó.')
    setError('')
    try { await add.mutateAsync({ caja, day, shift, amount: a, description: desc.trim() }); setAmount(''); setDesc('') }
    catch (err) { setError(friendlyCashError(err)) }
  }

  async function onClose(e: FormEvent) {
    e.preventDefault()
    if (c == null || c < 0) return setError('Escribe el efectivo que contaste.')
    const d = round2(c - expected)
    if (!confirm(`¿Cerrar ${CAJA_LABEL[caja]} · ${SHIFT_LABEL[shift]}?\nEsperado ${money(expected)} · contado ${money(c)} · ${d === 0 ? 'cuadra' : d > 0 ? `sobra ${money(d)}` : `falta ${money(-d)}`}`)) return
    setError('')
    try { await close.mutateAsync({ caja, day, shift, counted: c, note }) } catch (err) { setError(friendlyCashError(err)) }
  }

  return (
    <>
      <section className="space-y-1 rounded-lg bg-white p-3 text-sm shadow">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-stone-500">Ventas del turno ({count})</span>
          <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
        </div>
        {byMethod.map(([m, v]) => (
          <div key={m} className="flex justify-between"><span>{PAYMENT_LABEL[m]}</span><span className="tabular-nums">{money(v)}</span></div>
        ))}
        {!byMethod.length && <p className="text-stone-400">Sin ventas en este turno.</p>}
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 text-sm shadow">
        <div className="text-xs text-stone-500">Gastos pagados con el efectivo de esta caja</div>
        <ul className="divide-y">
          {expenses.map(x => (
            <li key={x.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 py-1.5">{x.description}
                <span className="block text-xs text-stone-500">{time(x.created_at)} · {names[x.created_by] ?? 'Usuario'}</span>
              </span>
              <span className="tabular-nums">−{money(x.amount)}</span>
              {(isAdmin || x.created_by === myId) && (
                <button onClick={() => { if (confirm(`¿Quitar el gasto «${x.description}»?`)) del.mutate({ id: x.id, day: x.day }) }}
                        aria-label={`Quitar gasto ${x.description}`} className="grid size-11 place-items-center text-stone-500">✕</button>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={onExpense} className="grid grid-cols-[5.5rem_1fr] gap-2 sm:grid-cols-[6rem_1fr_auto]">
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="S/" aria-label="Monto del gasto"
                 className="min-h-11 rounded-lg border px-2 text-base tabular-nums" />
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="En qué (delivery, limpieza…)" aria-label="Descripción del gasto"
                 className="min-h-11 min-w-0 rounded-lg border px-2 text-base" />
          <button disabled={add.isPending} className="min-h-11 rounded-lg border px-3 text-sm max-sm:col-span-2">+ Agregar gasto</button>
        </form>
      </section>

      <form onSubmit={onClose} className={`space-y-2 rounded-lg border-2 ${theme.border} bg-white p-3 text-sm shadow`}>
        <div className="space-y-0.5">
          <div className="flex justify-between"><span>Ventas en efectivo</span><span className="tabular-nums">{money(cash)}</span></div>
          <div className="flex justify-between"><span>Gastos</span><span className="tabular-nums">−{money(round2(cash - expected))}</span></div>
          <div className="flex items-baseline justify-between border-t pt-1 font-semibold">
            <span>Efectivo esperado</span><span className="text-lg tabular-nums">{money(expected)}</span>
          </div>
        </div>
        <label className="block text-xs text-stone-500">Efectivo contado
          <input value={counted} onChange={e => setCounted(e.target.value)} inputMode="decimal" placeholder="0.00"
                 className="mt-1 min-h-12 w-full rounded-lg border px-3 text-2xl font-semibold tabular-nums text-stone-900" />
        </label>
        {c != null && <div className="text-right"><Diff value={c - expected} big /></div>}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (opcional): p. ej. faltó vuelto"
               aria-label="Nota del cierre" className="min-h-11 w-full rounded-lg border px-2 text-base" />
        {pending > 0 && (
          <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
            Hay {pending} venta{pending === 1 ? '' : 's'} de este turno guardada{pending === 1 ? '' : 's'} en este equipo sin enviar.
            Conéctate a internet y espera a que se sincronicen antes de cerrar.
          </p>
        )}
        {error && <p className="text-red-600">{error}</p>}
        <button disabled={close.isPending || pending > 0 || c == null}
                className={`min-h-12 w-full rounded-lg font-medium text-white disabled:opacity-40 ${theme.solid}`}>
          {close.isPending ? 'Cerrando…' : `Cerrar ${CAJA_LABEL[caja]} · ${SHIFT_LABEL[shift]}`}
        </button>
      </form>
    </>
  )
}

function ClosedCard({ closure: c, liveTotal, closedBy, canReopen }: { closure: CashClosure; liveTotal: number; closedBy: string; canReopen: boolean }) {
  const reopen = useReopenCash()
  const [error, setError] = useState('')
  const changed = Math.abs(liveTotal - c.total_sales) >= 0.005
  async function onReopen() {
    if (!confirm('¿Reabrir este turno? Se borra el cierre y se puede volver a contar y cerrar.')) return
    try { await reopen.mutateAsync(c.id) } catch (e) { setError(friendlyCashError(e)) }
  }
  return (
    <section className="space-y-2 rounded-lg bg-white p-3 text-sm shadow">
      <div className="flex items-center justify-between">
        <span className="font-semibold">✓ Cerrado</span>
        <span className="text-xs text-stone-500">{closedBy} · {time(c.closed_at)}</span>
      </div>
      <div className="space-y-0.5">
        <div className="flex justify-between"><span>Ventas ({c.sales_count})</span><span className="tabular-nums">{money(c.total_sales)}</span></div>
        {(Object.entries(c.by_method) as [PaymentMethod, number][]).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
          <div key={m} className="flex justify-between pl-3 text-stone-600"><span>{PAYMENT_LABEL[m]}</span><span className="tabular-nums">{money(v)}</span></div>
        ))}
        <div className="flex justify-between"><span>Gastos</span><span className="tabular-nums">−{money(c.expenses)}</span></div>
        <div className="flex justify-between border-t pt-1"><span>Efectivo esperado</span><span className="tabular-nums">{money(c.expected_cash)}</span></div>
        <div className="flex justify-between font-semibold"><span>Efectivo contado</span><span className="tabular-nums">{money(c.counted_cash)}</span></div>
        <div className="text-right"><Diff value={c.difference} big /></div>
      </div>
      {c.note && <p className="rounded bg-stone-50 p-2 text-stone-600">{c.note}</p>}
      {changed && (
        <p className="rounded bg-amber-50 p-2 text-amber-900">
          Las ventas cambiaron después del cierre (ahora suman {money(liveTotal)}), por ejemplo por una anulación.
          {canReopen && ' Reabre el turno para volver a cerrarlo.'}
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
      {canReopen && (
        <button onClick={onReopen} disabled={reopen.isPending} className="min-h-11 rounded-lg border px-3 text-sm">Reabrir turno</button>
      )}
    </section>
  )
}
