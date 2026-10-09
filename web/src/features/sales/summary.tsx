import { Fragment } from 'react'
import { money } from '@/lib/format'
import type { Shift } from '@/types/domain'
import { type DaySale, KIND_LABEL, type LineKind, SHIFT_LABEL } from './api'

// Bloques de resumen compartidos por "Hoy" y "Reportes".

export const KINDS: LineKind[] = ['ferreteria', 'impresion', 'otros']
export const SHIFTS: Shift[] = ['manana', 'tarde']

export type KindShiftMatrix = Record<LineKind, Record<Shift, number>>

/** Tipo × turno: cada línea suma a su tipo en el turno de su venta (pasar solo ventas completadas). */
export function kindShiftMatrix(sales: DaySale[]): KindShiftMatrix {
  const m = Object.fromEntries(KINDS.map(k => [k, { manana: 0, tarde: 0 }])) as KindShiftMatrix
  for (const v of sales) for (const i of v.items) m[i.kind][v.shift] += i.subtotal
  return m
}

/** Tabla tipo × turno con totales por fila y columna (siempre muestra los tres tipos y los dos turnos). */
export function KindByShift({ matrix }: { matrix: KindShiftMatrix }) {
  const rowTotal = (k: LineKind) => matrix[k].manana + matrix[k].tarde
  const colTotal = (t: Shift) => KINDS.reduce((s, k) => s + matrix[k][t], 0)
  const cell = (n: number, strong = false) =>
    <td className={`px-2 py-1.5 text-right tabular-nums ${strong ? 'font-semibold' : ''} ${n ? '' : 'text-stone-400'}`}>{money(n)}</td>
  return (
    <section className="overflow-x-auto rounded-lg bg-white p-3 shadow">
      <div className="mb-1 text-xs text-stone-500">Por tipo y turno</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-stone-500">
            <th className="py-1 text-left font-normal">Tipo</th>
            {SHIFTS.map(t => <th key={t} className="px-2 py-1 text-right font-normal">{SHIFT_LABEL[t]}</th>)}
            <th className="px-2 py-1 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {KINDS.map(k => (
            <tr key={k}>
              <td className="py-1.5">{KIND_LABEL[k]}</td>
              {SHIFTS.map(t => <Fragment key={t}>{cell(matrix[k][t])}</Fragment>)}
              {cell(rowTotal(k), true)}
            </tr>
          ))}
          <tr className="border-t-2">
            <td className="py-1.5 font-semibold">Total</td>
            {SHIFTS.map(t => <Fragment key={t}>{cell(colTotal(t), true)}</Fragment>)}
            {cell(KINDS.reduce((s, k) => s + rowTotal(k), 0), true)}
          </tr>
        </tbody>
      </table>
    </section>
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
