import { Fragment } from 'react'
import { CAJAS, CAJA_ICON, CAJA_LABEL } from '@/lib/caja'
import { money } from '@/lib/format'
import type { Caja, PaymentMethod, Shift } from '@/types/domain'
import { type DaySale, PAYMENT_LABEL, SHIFT_LABEL } from './api'

// Bloques de resumen compartidos por "Hoy" y "Reportes".

export const SHIFTS: Shift[] = ['manana', 'tarde']

export type CajaShiftMatrix = Record<Caja, Record<Shift, number>>

/** Caja × turno con el total de cada venta (pasar solo ventas completadas). */
export function cajaShiftMatrix(sales: DaySale[]): CajaShiftMatrix {
  const m = Object.fromEntries(CAJAS.map(c => [c, { manana: 0, tarde: 0 }])) as CajaShiftMatrix
  for (const v of sales) m[v.caja][v.shift] += v.total
  return m
}

/** Suma por categoría de las líneas, de mayor a menor. */
export function byCategory(sales: DaySale[]): [string, number][] {
  const m = new Map<string, number>()
  for (const v of sales) for (const i of v.items) m.set(i.category, (m.get(i.category) ?? 0) + i.subtotal)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

/** Tabla caja × turno con totales por fila y columna (siempre muestra las dos cajas y los dos turnos). */
export function CajaByShift({ matrix }: { matrix: CajaShiftMatrix }) {
  const rowTotal = (c: Caja) => matrix[c].manana + matrix[c].tarde
  const colTotal = (t: Shift) => CAJAS.reduce((s, c) => s + matrix[c][t], 0)
  const cell = (n: number, strong = false) =>
    <td className={`px-2 py-1.5 text-right tabular-nums ${strong ? 'font-semibold' : ''} ${n ? '' : 'text-stone-400'}`}>{money(n)}</td>
  return (
    <section className="overflow-x-auto rounded-lg bg-white p-3 shadow">
      <div className="mb-1 text-xs text-stone-500">Por caja y turno</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-stone-500">
            <th className="py-1 text-left font-normal">Caja</th>
            {SHIFTS.map(t => <th key={t} className="px-2 py-1 text-right font-normal">{SHIFT_LABEL[t]}</th>)}
            <th className="px-2 py-1 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {CAJAS.map(c => (
            <tr key={c}>
              <td className="py-1.5">{CAJA_ICON[c]} {CAJA_LABEL[c]}</td>
              {SHIFTS.map(t => <Fragment key={t}>{cell(matrix[c][t])}</Fragment>)}
              {cell(rowTotal(c), true)}
            </tr>
          ))}
          <tr className="border-t-2">
            <td className="py-1.5 font-semibold">Total</td>
            {SHIFTS.map(t => <Fragment key={t}>{cell(colTotal(t), true)}</Fragment>)}
            {cell(CAJAS.reduce((s, c) => s + rowTotal(c), 0), true)}
          </tr>
        </tbody>
      </table>
    </section>
  )
}

/** Tarjeta de una caja: total, número de ventas y desglose por medio de pago (para cuadrar esa caja). */
export function CajaCard({ caja, sales }: { caja: Caja; sales: DaySale[] }) {
  const mine = sales.filter(v => v.caja === caja)
  const total = mine.reduce((s, v) => s + v.total, 0)
  const byMethod = new Map<PaymentMethod, number>()
  for (const v of mine) byMethod.set(v.payment_method, (byMethod.get(v.payment_method) ?? 0) + v.total)
  return (
    <div className="rounded-lg bg-white p-3 shadow">
      <div className="text-xs text-stone-500">{CAJA_ICON[caja]} {CAJA_LABEL[caja]}</div>
      <div className="text-2xl font-semibold tabular-nums">{money(total)}</div>
      <div className="mb-1 text-xs text-stone-500">{mine.length} venta{mine.length === 1 ? '' : 's'}</div>
      {[...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => (
        <div key={m} className="flex justify-between text-sm"><span>{PAYMENT_LABEL[m]}</span><span className="tabular-nums">{money(v)}</span></div>
      ))}
    </div>
  )
}

export function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="rounded-lg bg-white p-3 text-sm shadow">
      <div className="mb-1 text-xs text-stone-500">{title}</div>
      {rows.length ? rows.map(([label, v]) => (
        <div key={label} className="flex justify-between"><span>{label}</span><span className="tabular-nums">{money(v)}</span></div>
      )) : <div className="text-stone-400">—</div>}
    </div>
  )
}
