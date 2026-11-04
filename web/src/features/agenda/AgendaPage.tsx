import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '@/components/PageHeader'
import { useAuth } from '@/features/auth/AuthProvider'
import { money } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  type AgendaEvent, type AgendaKind, KIND, KINDS, type Occurrence, addDays, alerts, dayKey, daysInMonth, expand, indexLabel,
  longDate, monthTitle, relativeDay, repeatLabel, shortDate, ymd,
} from './agenda'
import { friendlyAgendaError, useAgenda, useSetOccurrence } from './api'
import EventSheet from './EventSheet'
import OccurrenceSheet, { DONE_VERB } from './OccurrenceSheet'

const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const FILTER_KEY = 'agenda.kinds'

function loadKinds(): AgendaKind[] {
  try {
    const v = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null') as AgendaKind[] | null
    if (Array.isArray(v)) return v.filter(k => KINDS.includes(k))
  } catch { /* sin almacenamiento */ }
  return KINDS
}

/**
 * Agenda del negocio: pagos de servicios, recepción de pedidos, cuotas y facturas y visitas de mantenimiento de la
 * fotocopiadora e impresora. Calendario del mes, lo vencido arriba, el día elegido y los próximos 30 días.
 */
export default function AgendaPage() {
  const today = dayKey()
  const { data, isLoading, error } = useAgenda()
  const events = data?.events ?? []
  const rows = data?.rows ?? []
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 } })
  const [selected, setSelected] = useState(today)
  const [kinds, setKinds] = useState<AgendaKind[]>(loadKinds)
  const [open, setOpen] = useState<Occurrence | null>(null)
  const [editing, setEditing] = useState<{ event: AgendaEvent | null; date?: string } | null>(null)

  function toggleKind(k: AgendaKind) {
    const next = kinds.includes(k) ? kinds.filter(x => x !== k) : [...kinds, k]
    const value = next.length ? next : KINDS
    setKinds(value)
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(value)) } catch { /* sin almacenamiento */ }
  }

  const visible = useMemo(() => events.filter(e => kinds.includes(e.kind)), [events, kinds])

  // Cuadrícula de lunes a domingo que cubre el mes.
  const grid = useMemo(() => {
    const first = ymd(month.y, month.m, 1)
    const lead = (new Date(month.y, month.m - 1, 1).getDay() + 6) % 7
    const start = addDays(first, -lead)
    const cells = Math.ceil((lead + daysInMonth(month.y, month.m)) / 7) * 7
    return Array.from({ length: cells }, (_, i) => addDays(start, i))
  }, [month])
  const gridOccs = useMemo(() => expand(visible, rows, grid[0], grid[grid.length - 1], today), [visible, rows, grid, today])
  const byDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>()
    for (const o of gridOccs) m.set(o.date, [...(m.get(o.date) ?? []), o])
    return m
  }, [gridOccs])

  const { overdue } = useMemo(() => alerts(visible, rows, today), [visible, rows, today])
  const dayList = useMemo(() => expand(visible, rows, selected, selected, today), [visible, rows, selected, today])
  const upcoming = useMemo(() => expand(visible, rows, addDays(today, 1), addDays(today, 30), today).filter(o => !o.done), [visible, rows, today])
  const monthTotal = useMemo(() => gridOccs
    .filter(o => o.date.startsWith(ymd(month.y, month.m, 1).slice(0, 8)) && (o.event.kind === 'servicio' || o.event.kind === 'pago'))
    .reduce((a, o) => a + (o.row?.amount ?? o.event.amount ?? 0), 0), [gridOccs, month])

  const shiftMonth = (n: number) => setMonth(({ y, m }) => { const t = y * 12 + (m - 1) + n; return { y: Math.floor(t / 12), m: t % 12 + 1 } })
  const goToday = () => { const d = new Date(); setMonth({ y: d.getFullYear(), m: d.getMonth() + 1 }); setSelected(today) }
  const pick = (d: string) => {
    setSelected(d)
    const [y, m] = d.split('-').map(Number)
    if (y !== month.y || m !== month.m) setMonth({ y, m })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title="Agenda">
        <button onClick={() => setEditing({ event: null, date: selected })}
                className="flex min-h-11 items-center gap-1 rounded-lg bg-amber-700 px-3 text-sm font-medium text-white">
          <Plus className="size-4" />Nuevo
        </button>
      </PageHeader>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">No se pudo cargar la agenda: {friendlyAgendaError(error)}</p>}

      {overdue.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-3 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-red-800">Vencidos sin marcar ({overdue.length})</h2>
          <ul className="divide-y divide-red-100">
            {overdue.slice(0, 8).map(o => <Item key={`${o.event.id}|${o.occurrence}`} occ={o} onOpen={() => setOpen(o)} showDate />)}
          </ul>
          {overdue.length > 8 && <p className="pt-1 text-xs text-red-700">y {overdue.length - 8} más…</p>}
        </section>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
        {KINDS.map(k => {
          const K = KIND[k], on = kinds.includes(k)
          return (
            <button key={k} onClick={() => toggleKind(k)} aria-pressed={on}
                    className={cn('flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm', on ? `${K.soft} ${K.text} border-current` : 'bg-white text-stone-400')}>
              <span className={cn('size-2 rounded-full', on ? K.dot : 'bg-stone-300')} />{K.short}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-start">
        <section className="rounded-lg bg-white p-2 shadow sm:p-3">
          <div className="mb-2 flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} aria-label="Mes anterior" className="grid size-11 place-items-center rounded-lg active:bg-stone-100"><ChevronLeft className="size-5" /></button>
            <h2 className="flex-1 text-center font-semibold first-letter:uppercase">{monthTitle(month.y, month.m)}</h2>
            <button onClick={() => shiftMonth(1)} aria-label="Mes siguiente" className="grid size-11 place-items-center rounded-lg active:bg-stone-100"><ChevronRight className="size-5" /></button>
            <button onClick={goToday} className="min-h-11 rounded-lg border px-3 text-sm">Hoy</button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-stone-500" aria-hidden>
            {WEEK.map((w, i) => <div key={i} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-stone-200">
            {grid.map(d => {
              const list = byDay.get(d) ?? []
              const inMonth = Number(d.slice(5, 7)) === month.m
              const late = list.some(o => o.overdue)
              const pending = list.filter(o => !o.done && !o.history).length
              return (
                <button key={d} onClick={() => pick(d)} aria-pressed={selected === d}
                        aria-label={`${longDate(d)}${list.length ? `, ${list.length} ${list.length === 1 ? 'evento' : 'eventos'}` : ''}${late ? ', con vencidos' : ''}`}
                        className={cn('flex min-h-14 flex-col items-stretch gap-0.5 p-1 text-left sm:min-h-20',
                                      selected === d ? 'bg-amber-50 ring-2 ring-inset ring-amber-600' : 'bg-white',
                                      !inMonth && 'bg-stone-50 text-stone-400')}>
                  <span className={cn('grid size-6 place-items-center self-center rounded-full text-sm sm:self-start',
                                      d === today && 'bg-amber-700 font-semibold text-white', late && d !== today && 'text-red-600 font-semibold')}>
                    {Number(d.slice(8))}
                  </span>
                  {/* Celular: puntos por evento; desde sm, los títulos. */}
                  <span className="flex flex-wrap justify-center gap-0.5 sm:hidden">
                    {list.slice(0, 4).map(o => (
                      <span key={`${o.event.id}|${o.occurrence}`}
                            className={cn('size-1.5 rounded-full', o.done ? 'bg-stone-300' : o.overdue ? 'bg-red-500' : KIND[o.event.kind].dot)} />
                    ))}
                  </span>
                  <span className="hidden space-y-0.5 sm:block">
                    {list.slice(0, 3).map(o => (
                      <span key={`${o.event.id}|${o.occurrence}`}
                            className={cn('block truncate rounded px-1 text-[11px] leading-4',
                                          o.done ? 'bg-stone-100 text-stone-400 line-through' : o.overdue ? 'bg-red-100 text-red-700' : `${KIND[o.event.kind].soft} ${KIND[o.event.kind].text}`)}>
                        {o.event.title}
                      </span>
                    ))}
                    {list.length > 3 && <span className="block px-1 text-[11px] text-stone-500">+{list.length - 3}</span>}
                  </span>
                  {pending > 0 && list.length > 4 && <span className="text-center text-[10px] text-stone-500 sm:hidden">+{list.length - 4}</span>}
                </button>
              )
            })}
          </div>
          {monthTotal > 0 && (
            <p className="mt-2 text-right text-xs text-stone-500">Servicios y cuotas del mes: <span className="font-medium tabular-nums text-stone-700">{money(monthTotal)}</span></p>
          )}
        </section>

        <div className="space-y-3">
          <section className="rounded-lg bg-white p-3 shadow">
            <div className="mb-1 flex items-baseline gap-2">
              <h2 className="flex-1 font-semibold first-letter:uppercase">{longDate(selected)}</h2>
              <span className="text-xs text-stone-500">{relativeDay(selected, today)}</span>
            </div>
            {isLoading && <p className="py-2 text-sm text-stone-500">Cargando…</p>}
            <ul className="divide-y">
              {dayList.map(o => <Item key={`${o.event.id}|${o.occurrence}`} occ={o} onOpen={() => setOpen(o)} />)}
            </ul>
            {!isLoading && !dayList.length && <p className="py-2 text-sm text-stone-500">Nada anotado este día.</p>}
            <button onClick={() => setEditing({ event: null, date: selected })}
                    className="mt-2 flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-sm text-amber-800">
              <Plus className="size-4" />Agregar el {shortDate(selected)}
            </button>
          </section>

          <section className="rounded-lg bg-white p-3 shadow">
            <h2 className="mb-1 font-semibold">Próximos 30 días</h2>
            <ul className="divide-y">
              {upcoming.map(o => <Item key={`${o.event.id}|${o.occurrence}`} occ={o} onOpen={() => setOpen(o)} showDate />)}
            </ul>
            {!isLoading && !upcoming.length && (
              <p className="py-2 text-sm text-stone-500">
                {events.length ? 'Nada pendiente en los próximos 30 días.' : 'Todavía no hay nada en la agenda. Toca «Nuevo» para anotar la luz, una cuota o la visita del técnico.'}
              </p>
            )}
          </section>
        </div>
      </div>

      {open && !editing && (
        <OccurrenceSheet occ={open} onClose={() => setOpen(null)} onEdit={() => setEditing({ event: open.event })} />
      )}
      {editing && (
        <EventSheet event={editing.event} defaults={editing.date ? { start_date: editing.date } : undefined}
                    onClose={() => { setEditing(null); setOpen(null) }} />
      )}
    </div>
  )
}

/** Renglón de una fecha: tocarlo abre el detalle; el ✓ la marca hecha / pagada con el monto aproximado. */
function Item({ occ, onOpen, showDate = false }: { occ: Occurrence; onOpen: () => void; showDate?: boolean }) {
  const { profile } = useAuth()
  const setOcc = useSetOccurrence()
  const ev = occ.event
  const K = KIND[ev.kind]
  const amount = occ.row?.amount ?? ev.amount
  const sub = [
    showDate && `${relativeDay(occ.date)} · ${shortDate(occ.date)}`,
    indexLabel(occ) || (ev.repeat_unit && repeatLabel({ ...ev, repeat_until: null })),
    amount != null && money(amount),
    ev.provider_name,
  ].filter(Boolean).join(' · ')

  async function quickDone() {
    try {
      await setOcc.mutateAsync({ event_id: ev.id, occurrence: occ.occurrence, done_at: new Date().toISOString(), done_by: profile?.id ?? null, amount: ev.amount, note: null })
      toast.success(`${ev.title}: ${DONE_VERB[ev.kind].done.toLowerCase()} ✓`, {
        action: { label: 'Deshacer', onClick: () => setOcc.mutate({ event_id: ev.id, occurrence: occ.occurrence, done_at: null, done_by: null, amount: null, note: null }) },
      })
    } catch (err) { toast.error(friendlyAgendaError(err)) }
  }

  return (
    <li className="flex items-center gap-2">
      <button onClick={onOpen} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-1.5 text-left">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', occ.done ? 'bg-stone-100 text-stone-400' : `${K.soft} ${K.text}`)}>
          <K.icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm font-medium', occ.done && 'text-stone-400 line-through')}>{ev.title}</span>
          <span className={cn('block truncate text-xs', occ.overdue ? 'text-red-600' : 'text-stone-500')}>
            {occ.overdue && !showDate && 'Vencido · '}{sub || K.short}
          </span>
        </span>
      </button>
      {occ.done
        ? <span className="grid size-11 shrink-0 place-items-center text-green-700" aria-label={DONE_VERB[ev.kind].done}><Check className="size-5" /></span>
        : !occ.history && (
          <button onClick={quickDone} disabled={setOcc.isPending} aria-label={`${DONE_VERB[ev.kind].action}: ${ev.title}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full border text-stone-500 active:bg-green-50">
            <Check className="size-5" />
          </button>
        )}
    </li>
  )
}
