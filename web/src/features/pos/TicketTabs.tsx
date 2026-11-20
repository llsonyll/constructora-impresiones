import { Plus } from 'lucide-react'
import { CAJA_THEME } from '@/lib/caja'
import { chipColors } from '@/lib/chip'
import { money } from '@/lib/format'
import type { Caja } from '@/types/domain'
import { linesTotal, ticketTitle } from './tickets'
import { useCarts, useOpenTickets } from './useCart'

/**
 * Tickets abiertos de la caja (de todos los equipos): tocar uno lo trae a este equipo para seguirlo o cobrarlo;
 * «Nuevo» abre otro para el siguiente cliente sin cerrar el anterior.
 */
export default function TicketTabs({ caja }: { caja: Caja }) {
  const { byCaja, active, select } = useOpenTickets()
  const carts = useCarts()
  const tone = CAJA_THEME[caja].tone
  const list = byCaja[caja]
  if (!list.some(t => t.lines.length)) return null
  return (
    <div role="tablist" aria-label="Tickets abiertos" className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
      {list.map(t => {
        const on = t.id === active[caja]
        return (
          <button key={t.id} role="tab" aria-selected={on} onClick={() => select(caja, t.id)}
                  className={`flex min-h-11 shrink-0 flex-col items-start justify-center rounded-lg border px-3 py-1 text-left text-sm leading-tight ${chipColors(on, tone)}`}>
            <span className="max-w-40 truncate font-medium">
              {ticketTitle(t)}{t.dirty && t.version === 0 && <span title="Todavía no llega a los otros equipos"> ⏳</span>}
            </span>
            <span className={`text-xs ${on ? 'opacity-80' : 'text-stone-500'}`}>
              {t.lines.length ? `${t.lines.length} ítem${t.lines.length === 1 ? '' : 's'} · ${money(linesTotal(t.lines))}` : 'Vacío'}
            </span>
          </button>
        )
      })}
      <button onClick={() => carts[caja].newTicket()} aria-label="Nuevo ticket"
              className={`flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-3 text-sm ${chipColors(false, tone)}`}>
        <Plus className="size-4" />Nuevo
      </button>
    </div>
  )
}
