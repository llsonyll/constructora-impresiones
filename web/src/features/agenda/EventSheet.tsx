import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import Sheet from '@/components/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { poLabel, usePurchaseOrders, useProviderList } from '@/features/providers/api'
import { cn } from '@/lib/utils'
import {
  type AgendaEvent, type AgendaKind, KIND, KINDS, REPEAT_OPTIONS, type RepeatUnit, eventDates, nthDate, repeatValue, shortDate,
} from './agenda'
import { friendlyAgendaError, useDeleteEvent, useSaveEvent } from './api'

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`block text-sm ${className}`}><span className="mb-1 block text-xs text-stone-500">{label}</span>{children}</label>
}
const input = 'min-h-11 w-full rounded-lg border bg-white px-2 py-2 text-base sm:text-sm'

type Ends = 'nunca' | 'veces' | 'fecha'

interface Props {
  event: AgendaEvent | null
  /** Fecha y tipo con los que nace uno nuevo (el día tocado en el calendario). */
  defaults?: { start_date: string; kind?: AgendaKind }
  onClose: () => void
}

/** Crear o editar un evento de la agenda (una vez o repetido). */
export default function EventSheet({ event, defaults, onClose }: Props) {
  const { profile } = useAuth()
  const save = useSaveEvent()
  const del = useDeleteEvent()
  const canLink = profile?.role === 'admin' || profile?.role === 'almacen'
  const canDelete = !!event && (profile?.role === 'admin' || event.created_by === profile?.id)

  const [initial] = useState(() => {
    const kind = event?.kind ?? defaults?.kind ?? 'servicio'
    const count = event?.repeat_until && event.repeat_unit ? eventDates(event, event.start_date, event.repeat_until).length : 0
    return {
      kind,
      title: event?.title ?? '',
      start_date: event?.start_date ?? defaults?.start_date ?? '',
      repeat: event ? repeatValue(event) : KIND[kind].repeat,
      ends: (event?.repeat_until ? (event.kind === 'pago' ? 'veces' : 'fecha') : 'nunca') as Ends,
      times: count ? String(count) : '',
      until: event?.repeat_until ?? '',
      amount: event?.amount != null ? String(event.amount) : '',
      provider_id: event?.provider_id ?? '',
      purchase_order_id: event?.purchase_order_id ?? '',
      notes: event?.notes ?? '',
    }
  })
  const [f, setF] = useState(initial)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const requestClose = () => { if (!dirty || confirm('Tienes cambios sin guardar. ¿Descartarlos?')) onClose() }

  const [unit, every] = f.repeat ? (f.repeat.split(':') as [RepeatUnit, string]) : [null, '1']
  const repeat = { start_date: f.start_date, repeat_unit: unit, repeat_every: Number(every) }
  const times = Math.floor(Number(f.times))
  const until = !unit || f.ends === 'nunca' ? null
    : f.ends === 'veces' ? (times >= 1 && f.start_date ? nthDate(repeat, times) : null)
    : f.until || null
  const options = REPEAT_OPTIONS.some(o => o.value === f.repeat) ? REPEAT_OPTIONS
    : [...REPEAT_OPTIONS, { value: f.repeat, label: `Cada ${every} ${unit === 'week' ? 'semanas' : unit === 'month' ? 'meses' : 'años'}` }]

  function pickKind(k: AgendaKind) {
    // Al cambiar de tipo, la repetición sugerida (luz: cada mes) solo si no se tocó.
    setF(s => ({ ...s, kind: k, repeat: s.repeat === KIND[s.kind].repeat ? KIND[k].repeat : s.repeat }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) return setError('Escribe qué es (p. ej. «Luz»).')
    if (!f.start_date) return setError('Elige la fecha.')
    if (unit && f.ends === 'veces' && !(times >= 1)) return setError('Escribe cuántas veces (o cuotas) son.')
    if (until && until < f.start_date) return setError('La fecha final no puede ser antes de la primera.')
    const amount = f.amount.trim() ? Number(f.amount.replace(',', '.')) : null
    if (amount != null && (Number.isNaN(amount) || amount < 0)) return setError('El monto no es válido.')
    setError('')
    try {
      await save.mutateAsync({
        id: event?.id, kind: f.kind, title: f.title.trim(), start_date: f.start_date,
        repeat_unit: unit, repeat_every: unit ? Number(every) : 1, repeat_until: until, amount,
        // Sin permiso de proveedores (cajero) se conserva lo que ya tenía.
        provider_id: canLink ? f.provider_id || null : event?.provider_id ?? null,
        purchase_order_id: canLink ? (f.kind === 'pedido' && f.purchase_order_id) || null : event?.purchase_order_id ?? null,
        notes: f.notes.trim() || null,
      })
      toast.success(event ? 'Guardado' : 'Agregado a la agenda')
      onClose()
    } catch (err) { setError(friendlyAgendaError(err)) }
  }

  async function onDelete() {
    if (!event) return
    const msg = event.repeat_unit
      ? `¿Eliminar «${event.title}» y todas sus fechas (también las ya pagadas)?\n\nSi solo ya no se repite, mejor ponle una fecha final.`
      : `¿Eliminar «${event.title}»?`
    if (!confirm(msg)) return
    try { await del.mutateAsync(event.id); toast.success('Eliminado'); onClose() } catch (err) { setError(friendlyAgendaError(err)) }
  }

  const meta = KIND[f.kind]
  return (
    <Sheet onClose={requestClose} label={event ? 'Editar evento' : 'Nuevo evento'} dismissible={!dirty} className="sm:max-w-lg">
      <div className="mb-2 flex items-center pt-2">
        <h2 className="flex-1 text-lg font-semibold">{event ? 'Editar evento' : 'Nuevo en la agenda'}</h2>
        <button type="button" onClick={requestClose} aria-label="Cerrar" className="-mr-2 grid size-11 place-items-center text-xl">✕</button>
      </div>
      <form onSubmit={onSubmit} className="space-y-3 pb-2">
        <fieldset>
          <legend className="mb-1 text-xs text-stone-500">Tipo</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {KINDS.map(k => {
              const K = KIND[k]
              return (
                <button key={k} type="button" onClick={() => pickKind(k)} aria-pressed={f.kind === k}
                        className={cn('flex min-h-11 items-center gap-2 rounded-lg border px-2 text-left text-sm',
                                      f.kind === k ? `${K.soft} ${K.text} border-current font-medium` : 'bg-white')}>
                  <K.icon className="size-4 shrink-0" />{K.short}
                </button>
              )
            })}
          </div>
        </fieldset>

        <Field label="¿Qué es?">
          <input className={input} value={f.title} onChange={e => set('title', e.target.value)} placeholder={meta.suggestions[0] ?? 'Descripción'}
                 autoFocus={!event} maxLength={120} />
        </Field>
        {!event && !f.title && meta.suggestions.length > 0 && (
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {meta.suggestions.map(s => (
              <button key={s} type="button" onClick={() => set('title', s)} className="min-h-9 rounded-full border bg-white px-3 text-sm">{s}</button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={unit ? 'Primera fecha' : 'Fecha'}>
            <input type="date" className={input} value={f.start_date} onChange={e => set('start_date', e.target.value)} required />
          </Field>
          <Field label="Se repite">
            <select className={input} value={f.repeat} onChange={e => set('repeat', e.target.value)}>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        {unit && (
          <div className="space-y-2 rounded-lg bg-stone-50 p-2">
            <div className="text-xs text-stone-500">Termina</div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-200 p-1 text-sm">
              {([['nunca', 'Nunca'], ['veces', f.kind === 'pago' ? 'N° de cuotas' : 'N° de veces'], ['fecha', 'En fecha']] as [Ends, string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => set('ends', v)} aria-pressed={f.ends === v}
                        className={cn('min-h-10 rounded-md px-1', f.ends === v ? 'bg-white font-medium shadow' : 'text-stone-600')}>{l}</button>
              ))}
            </div>
            {f.ends === 'veces' && (
              <div className="flex items-center gap-2">
                <input className={cn(input, 'w-24')} value={f.times} onChange={e => set('times', e.target.value.replace(/\D/g, '').slice(0, 3))}
                       inputMode="numeric" placeholder="12" aria-label={f.kind === 'pago' ? 'Número de cuotas' : 'Número de veces'} />
                <span className="text-sm text-stone-600">{until ? `la última el ${shortDate(until, true)}` : f.kind === 'pago' ? 'cuotas' : 'veces'}</span>
              </div>
            )}
            {f.ends === 'fecha' && (
              <input type="date" className={input} value={f.until} min={f.start_date} onChange={e => set('until', e.target.value)} aria-label="Hasta" />
            )}
          </div>
        )}

        <Field label={f.kind === 'pedido' ? 'Monto del pedido (opcional)' : 'Monto aproximado (opcional)'}>
          <input className={input} value={f.amount} onChange={e => set('amount', e.target.value)} inputMode="decimal" placeholder="S/ 0.00" />
        </Field>

        {canLink && <ProviderFields kind={f.kind} providerId={f.provider_id} poId={f.purchase_order_id}
                                    onProvider={v => setF(s => ({ ...s, provider_id: v, purchase_order_id: '' }))}
                                    onPo={v => set('purchase_order_id', v)} />}

        <Field label="Notas (n° de suministro, cuenta, técnico, teléfono…)">
          <textarea className={input} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} />
        </Field>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          {canDelete && (
            <button type="button" onClick={onDelete} disabled={del.isPending} className="min-h-12 rounded-lg border px-4 text-red-700">Eliminar</button>
          )}
          <button disabled={save.isPending} className="min-h-12 flex-1 rounded-lg bg-amber-700 font-medium text-white disabled:opacity-60">
            {save.isPending ? 'Guardando…' : event ? 'Guardar cambios' : 'Agregar a la agenda'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

/** Proveedor y orden de compra (solo admin y almacén, que pueden leerlos). */
function ProviderFields({ kind, providerId, poId, onProvider, onPo }: {
  kind: AgendaKind; providerId: string; poId: string; onProvider: (v: string) => void; onPo: (v: string) => void
}) {
  const { data: providers = [] } = useProviderList()
  const { data: orders = [] } = usePurchaseOrders()
  const list = useMemo(() => providers.filter(p => p.active || p.id === providerId), [providers, providerId])
  const open = orders.filter(o => (o.provider_id === providerId || !providerId) && (o.status === 'borrador' || o.status === 'enviada' || o.id === poId))
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Proveedor (opcional)" className={kind === 'pedido' ? '' : 'col-span-2'}>
        <select className={input} value={providerId} onChange={e => onProvider(e.target.value)}>
          <option value="">—</option>
          {list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {kind === 'pedido' && (
        <Field label="Orden de compra">
          <select className={input} value={poId} onChange={e => {
            const o = orders.find(x => x.id === e.target.value)
            if (o && !providerId) onProvider(o.provider_id)
            onPo(e.target.value)
          }}>
            <option value="">—</option>
            {open.map(o => <option key={o.id} value={o.id}>{poLabel(o.number)}{providerId ? '' : ` · ${o.provider_name}`}</option>)}
          </select>
        </Field>
      )}
    </div>
  )
}
