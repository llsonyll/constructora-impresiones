import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import Sheet from '@/components/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { poLabel, whatsappUrl } from '@/features/providers/api'
import { useCashierNames } from '@/features/sales/api'
import { money } from '@/lib/format'
import { cn } from '@/lib/utils'
import { type AgendaKind, KIND, type Occurrence, indexLabel, longDate, relativeDay, repeatLabel, shortDate } from './agenda'
import { friendlyAgendaError, useSetOccurrence } from './api'

export const DONE_VERB: Record<AgendaKind, { action: string; done: string }> = {
  servicio: { action: 'Marcar como pagado', done: 'Pagado' },
  pago: { action: 'Marcar como pagado', done: 'Pagado' },
  pedido: { action: 'Marcar como recibido', done: 'Recibido' },
  mantenimiento: { action: 'Marcar como hecho', done: 'Hecho' },
  otro: { action: 'Marcar como hecho', done: 'Hecho' },
}

const input = 'min-h-11 w-full rounded-lg border bg-white px-2 py-2 text-base sm:text-sm'
const when = (iso: string) => new Date(iso).toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Una fecha de un evento: ver el detalle, marcarla hecha / pagada (con el monto real), deshacer o cambiarla de día. */
export default function OccurrenceSheet({ occ, onClose, onEdit }: { occ: Occurrence; onClose: () => void; onEdit: () => void }) {
  const { profile } = useAuth()
  const { data: names = {} } = useCashierNames()
  const setOcc = useSetOccurrence()
  const ev = occ.event
  const K = KIND[ev.kind]
  const verb = DONE_VERB[ev.kind]
  const canEdit = profile?.role === 'admin' || ev.created_by === profile?.id
  const canPo = profile?.role === 'admin' || profile?.role === 'almacen'
  const [amount, setAmount] = useState(ev.amount != null ? String(ev.amount) : '')
  const [note, setNote] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveTo, setMoveTo] = useState(occ.date)
  const [error, setError] = useState('')
  const key = { event_id: ev.id, occurrence: occ.occurrence }
  const wa = whatsappUrl(ev.provider_phone, `Hola, sobre ${ev.title.toLowerCase()} del ${shortDate(occ.date)}: `)

  async function run(p: Parameters<typeof setOcc.mutateAsync>[0], msg: string, close = true) {
    setError('')
    try { await setOcc.mutateAsync(p); toast.success(msg); if (close) onClose() } catch (err) { setError(friendlyAgendaError(err)) }
  }

  function markDone() {
    const a = amount.trim() ? Number(amount.replace(',', '.')) : null
    if (a != null && (Number.isNaN(a) || a < 0)) return setError('El monto no es válido.')
    run({ ...key, done_at: new Date().toISOString(), done_by: profile?.id ?? null, amount: a, note: note.trim() || null }, `${verb.done} ✓`)
  }
  const undo = () => run({ ...key, done_at: null, done_by: null, amount: null, note: null }, 'Vuelve a estar pendiente')
  function move() {
    if (!moveTo) return
    run({ ...key, moved_to: moveTo === occ.occurrence ? null : moveTo }, `Pasado al ${shortDate(moveTo)}`)
  }

  const status = occ.done ? { label: `${verb.done} ✓`, cls: 'bg-green-100 text-green-800' }
    : occ.overdue ? { label: 'Vencido', cls: 'bg-red-100 text-red-700' }
    : occ.history ? { label: 'Antes de anotarlo', cls: 'bg-stone-100 text-stone-600' }
    : { label: 'Pendiente', cls: 'bg-stone-100 text-stone-700' }

  return (
    <Sheet onClose={onClose} label={ev.title} className="space-y-3 sm:max-w-md">
      <div className="flex items-start gap-3 pt-2">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-full', K.soft, K.text)}><K.icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">{ev.title}</h2>
          <div className="text-sm text-stone-500">{K.short}{indexLabel(occ) && ` · ${indexLabel(occ)}`}</div>
        </div>
        <button onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-1 grid size-11 place-items-center text-xl">✕</button>
      </div>

      <div className="space-y-1 rounded-lg bg-stone-50 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium first-letter:uppercase">{longDate(occ.date)}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.cls)}>{status.label}</span>
        </div>
        <div className="text-stone-500">
          {relativeDay(occ.date)}
          {occ.row?.moved_to && ` · cambiado del ${shortDate(occ.occurrence)}`}
        </div>
        {ev.repeat_unit && <div className="text-stone-600">↻ {repeatLabel(ev)}</div>}
        {ev.amount != null && <div>Monto aproximado: <span className="tabular-nums">{money(ev.amount)}</span></div>}
        {ev.provider_name && (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{ev.provider_name}</span>
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="rounded-lg border bg-white px-2 py-1 text-xs">💬 WhatsApp</a>}
          </div>
        )}
        {ev.po_number != null && (canPo
          ? <Link to={`/proveedores/ordenes/${ev.purchase_order_id}`} className="block text-amber-800 underline">{poLabel(ev.po_number)} ({ev.po_status}) →</Link>
          : <div>{poLabel(ev.po_number)}</div>)}
        {ev.notes && <p className="whitespace-pre-line text-stone-700">{ev.notes}</p>}
      </div>

      {occ.done && occ.row ? (
        <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <div>{verb.done} el {when(occ.row.done_at!)}{occ.row.done_by && ` · ${names[occ.row.done_by] ?? 'Usuario'}`}</div>
          {occ.row.amount != null && <div>Monto: <span className="font-medium tabular-nums">{money(occ.row.amount)}</span></div>}
          {occ.row.note && <div className="text-stone-700">{occ.row.note}</div>}
          <button onClick={undo} disabled={setOcc.isPending} className="min-h-11 w-full rounded-lg border bg-white">Deshacer (volver a pendiente)</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <input className={input} value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="S/"
                   aria-label={ev.kind === 'pedido' ? 'Monto recibido' : 'Monto pagado'} />
            <input className={input} value={note} onChange={e => setNote(e.target.value)}
                   placeholder={ev.kind === 'mantenimiento' ? 'Qué se hizo (opcional)' : ev.kind === 'pedido' ? 'Nota (llegó completo…)' : 'N° de operación (opcional)'}
                   aria-label="Nota" />
          </div>
          <button onClick={markDone} disabled={setOcc.isPending}
                  className="min-h-12 w-full rounded-lg bg-green-700 font-medium text-white disabled:opacity-60">✓ {verb.action}</button>
          {moving ? (
            <div className="flex gap-2">
              <input type="date" className={input} value={moveTo} onChange={e => setMoveTo(e.target.value)} aria-label="Nueva fecha" />
              <button onClick={move} disabled={setOcc.isPending || !moveTo} className="min-h-11 shrink-0 rounded-lg border px-3">Mover</button>
            </div>
          ) : (
            <button onClick={() => setMoving(true)} className="min-h-11 w-full rounded-lg border">
              Cambiar fecha{ev.repeat_unit ? ' (solo esta vez)' : ''}
            </button>
          )}
          {occ.row?.moved_to && (
            <button onClick={() => run({ ...key, moved_to: null }, 'Vuelve a su fecha')} className="min-h-11 w-full text-sm text-stone-600 underline">
              Volver al {shortDate(occ.occurrence)}
            </button>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {canEdit && (
        <button onClick={onEdit} className="min-h-11 w-full rounded-lg border text-amber-800">
          Editar {ev.repeat_unit ? 'la serie (todas las fechas)' : 'evento'}
        </button>
      )}
    </Sheet>
  )
}
