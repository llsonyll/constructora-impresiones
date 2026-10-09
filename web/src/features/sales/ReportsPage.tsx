import { useMemo, useState } from 'react'
import { CAJAS, CAJA_ICON, CAJA_LABEL } from '@/lib/caja'
import { money, round2 } from '@/lib/format'
import type { Caja, PaymentMethod, Shift } from '@/types/domain'
import { PAYMENT_LABEL, SHIFT_LABEL, todayLocal, useCashierNames, useRangeSales } from './api'
import { Breakdown, CajaByShift, byCategory, cajaShiftMatrix } from './summary'

const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`
const dayOf = (iso: string) => todayLocal(new Date(iso))
const shiftDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return todayLocal(new Date(y, m - 1, d + n))
}
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' })
}

/** Atajos de rango (fechas locales, ambos extremos inclusive). */
function presets(today: string): { id: string; label: string; from: string; to: string }[] {
  const [y, m] = today.split('-').map(Number)
  return [
    { id: 'hoy', label: 'Hoy', from: today, to: today },
    { id: 'ayer', label: 'Ayer', from: shiftDays(today, -1), to: shiftDays(today, -1) },
    { id: '7d', label: 'Últimos 7 días', from: shiftDays(today, -6), to: today },
    { id: 'mes', label: 'Este mes', from: todayLocal(new Date(y, m - 1, 1)), to: today },
    { id: 'mes-1', label: 'Mes pasado', from: todayLocal(new Date(y, m - 2, 1)), to: todayLocal(new Date(y, m - 1, 0)) },
  ]
}

interface ProductRow { key: string; name: string; category: string; qty: number; total: number; cost: number | null }

/** Reportes por rango de fechas (admin): totales, caja × turno, categorías, por día, productos y exportación CSV. */
export default function ReportsPage() {
  const today = todayLocal()
  const ranges = presets(today)
  const [from, setFrom] = useState(ranges[3].from)
  const [to, setTo] = useState(today)
  const [caja, setCaja] = useState<Caja | ''>('')
  const [shift, setShift] = useState<Shift | ''>('')
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [cashier, setCashier] = useState('')
  const [category, setCategory] = useState('')

  const { data: sales = [], isLoading, isFetching, error } = useRangeSales(from, to)
  const { data: names = {} } = useCashierNames()

  const filtered = useMemo(() => sales.filter(s => (!caja || s.caja === caja) && (!shift || s.shift === shift) && (!method || s.payment_method === method)
    && (!cashier || s.cashier_id === cashier)), [sales, caja, shift, method, cashier])
  const valid = useMemo(() => filtered.filter(s => s.status === 'completada'), [filtered])
  const voided = filtered.filter(s => s.status === 'anulada')

  const total = valid.reduce((s, v) => s + v.total, 0)
  const byMethod = valid.reduce((acc, v) => ({ ...acc, [v.payment_method]: (acc[v.payment_method] ?? 0) + v.total }),
    {} as Partial<Record<PaymentMethod, number>>)
  const matrix = cajaShiftMatrix(valid)
  const categories = byCategory(valid)
  const cashiers = [...new Set(sales.map(s => s.cashier_id).filter((x): x is string => !!x))]

  // Margen: solo líneas con costo registrado (snapshot al vender); se informa qué parte de las ventas lo tiene.
  const lines = valid.flatMap(v => v.items)
  const withCost = lines.filter(i => i.unit_cost != null)
  const margin = withCost.reduce((s, i) => s + i.subtotal - i.qty * i.unit_cost!, 0)
  const costCoverage = total ? withCost.reduce((s, i) => s + i.subtotal, 0) / total : 0

  const byDay = useMemo(() => {
    const map = new Map<string, { count: number } & Record<Caja, number>>()
    for (const v of valid) {
      const d = dayOf(v.sold_at)
      const row = map.get(d) ?? { count: 0, ferreteria: 0, copias: 0 }
      row.count++
      row[v.caja] += v.total
      map.set(d, row)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [valid])

  const products = useMemo(() => {
    const map = new Map<string, ProductRow>()
    for (const v of valid) for (const i of v.items) {
      if (category && i.category !== category) continue
      const key = i.product_id ?? `libre:${i.description.trim().toLowerCase()}`
      const row = map.get(key) ?? { key, name: i.description, category: i.category, qty: 0, total: 0, cost: 0 }
      row.qty += i.qty
      row.total += i.subtotal
      row.cost = row.cost == null || i.unit_cost == null ? null : row.cost + i.qty * i.unit_cost
      map.set(key, row)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [valid, category])
  const [showAll, setShowAll] = useState(false)

  function exportCsv() {
    const header = ['Venta', 'Fecha', 'Hora', 'Turno', 'Cajero', 'Pago', 'Estado', 'Caja', 'Categoria', 'Producto', 'Cantidad',
                    'PrecioUnitario', 'Subtotal', 'CostoUnitario', 'TotalVenta']
    const rows = filtered.slice().reverse().flatMap(v => v.items.map(i => [
      v.number ?? '', dayOf(v.sold_at),
      new Date(v.sold_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      SHIFT_LABEL[v.shift], v.cashier_id ? names[v.cashier_id] ?? '' : '', PAYMENT_LABEL[v.payment_method], v.status,
      CAJA_LABEL[v.caja], i.category, i.description, i.qty, i.unit_price.toFixed(2), i.subtotal.toFixed(2),
      i.unit_cost == null ? '' : i.unit_cost.toFixed(2), v.total.toFixed(2),
    ]))
    const csv = [header, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    // BOM: Excel abre el UTF-8 con tildes correctamente.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `ventas_${from}_a_${to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const activePreset = ranges.find(r => r.from === from && r.to === to)?.id
  const badRange = from > to

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Reportes</h1>
        <button onClick={exportCsv} disabled={!filtered.length} className="min-h-11 rounded border bg-white px-3 text-sm disabled:opacity-40">
          Exportar CSV
        </button>
      </div>

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
        {(['', ...CAJAS] as const).map(c => (
          <button key={c} onClick={() => { setCaja(c); setCategory('') }} className={chip(caja === c)}>{c ? `${CAJA_ICON[c]} ${CAJA_LABEL[c]}` : 'Ambas cajas'}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(['', 'manana', 'tarde'] as const).map(s => (
          <button key={s} onClick={() => setShift(s)} className={chip(shift === s)}>{s ? SHIFT_LABEL[s] : 'Ambos turnos'}</button>
        ))}
        <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod | '')} aria-label="Medio de pago"
                className="min-h-11 rounded-full border bg-white px-3 text-sm">
          <option value="">Todo medio de pago</option>
          {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {cashiers.length > 1 && (
          <select value={cashier} onChange={e => setCashier(e.target.value)} aria-label="Cajero"
                  className="min-h-11 rounded-full border bg-white px-3 text-sm">
            <option value="">Todos los cajeros</option>
            {cashiers.map(id => <option key={id} value={id}>{names[id] ?? 'Cajero'}</option>)}
          </select>
        )}
      </div>

      {badRange && <p className="text-red-600">La fecha “desde” es posterior a “hasta”.</p>}
      {isLoading && !badRange && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">No se pudieron cargar las ventas: {(error as Error).message}</p>}

      <section className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
        <Kpi label="Total del período" value={money(total)} big />
        <Kpi label="Ventas" value={String(valid.length)} sub={voided.length ? `${voided.length} anulada${voided.length === 1 ? '' : 's'} (${money(voided.reduce((s, v) => s + v.total, 0))})` : undefined} />
        <Kpi label="Ticket promedio" value={money(valid.length ? total / valid.length : 0)} />
        <Kpi label="Margen estimado" value={withCost.length ? money(margin) : '—'}
             sub={withCost.length ? `sobre ${Math.round(costCoverage * 100)}% de las ventas (con costo)` : 'sin costos registrados'} />
      </section>

      <section className="grid gap-2 md:grid-cols-3">
        <Breakdown title="Por medio de pago" rows={Object.entries(byMethod).map(([k, v]) => [PAYMENT_LABEL[k as PaymentMethod], v!])} />
        <Breakdown title="Por categoría" rows={categories} />
        <CajaByShift matrix={matrix} />
      </section>

      <section className="overflow-x-auto rounded-lg bg-white p-3 shadow">
        <div className="mb-1 text-xs text-stone-500">Por día</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-stone-500">
              <th className="py-1 text-left font-normal">Día</th>
              <th className="px-2 py-1 text-right font-normal">Ventas</th>
              {CAJAS.map(c => <th key={c} className="px-2 py-1 text-right font-normal max-sm:hidden">{CAJA_LABEL[c]}</th>)}
              <th className="px-2 py-1 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {byDay.map(([d, r]) => (
              <tr key={d}>
                <td className="py-1.5 capitalize">{dayLabel(d)}</td>
                <td className="px-2 text-right tabular-nums">{r.count}</td>
                {CAJAS.map(c => <td key={c} className={`px-2 text-right tabular-nums max-sm:hidden ${r[c] ? '' : 'text-stone-400'}`}>{money(r[c])}</td>)}
                <td className="px-2 text-right font-semibold tabular-nums">{money(round2(r.ferreteria + r.copias))}</td>
              </tr>
            ))}
            {!byDay.length && <tr><td colSpan={5} className="py-4 text-center text-stone-500">Sin ventas en el período.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-lg bg-white p-3 shadow">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-stone-500">Productos más vendidos</span>
          <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Categoría"
                  className="min-h-11 rounded-full border bg-white px-3 text-sm">
            <option value="">Todas las categorías</option>
            {categories.map(([name]) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-stone-500">
              <th className="py-1 text-left font-normal">Producto</th>
              <th className="px-2 py-1 text-right font-normal">Cantidad</th>
              <th className="px-2 py-1 text-right font-normal">Total</th>
              <th className="px-2 py-1 text-right font-normal max-sm:hidden">Margen</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(showAll ? products : products.slice(0, 20)).map(p => (
              <tr key={p.key}>
                <td className="py-1.5">{p.name}<span className="ml-1 text-xs text-stone-400">{p.category}</span></td>
                <td className="px-2 text-right tabular-nums">{round2(p.qty)}</td>
                <td className="px-2 text-right tabular-nums">{money(p.total)}</td>
                <td className="px-2 text-right tabular-nums max-sm:hidden">
                  {p.cost == null ? <span className="text-stone-400">—</span> : `${money(p.total - p.cost)} (${p.total ? Math.round((1 - p.cost / p.total) * 100) : 0}%)`}
                </td>
              </tr>
            ))}
            {!products.length && <tr><td colSpan={4} className="py-4 text-center text-stone-500">Sin productos vendidos.</td></tr>}
          </tbody>
        </table>
        {products.length > 20 && (
          <button onClick={() => setShowAll(v => !v)} className="mt-2 min-h-11 w-full rounded border text-sm">
            {showAll ? 'Ver solo los 20 primeros' : `Ver los ${products.length}`}
          </button>
        )}
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, big = false }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className={`rounded-lg bg-white p-3 shadow ${big ? 'max-sm:col-span-2' : ''}`}>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`${big ? 'text-2xl' : 'text-xl'} font-semibold tabular-nums`}>{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  )
}

