import { CAJA_ICON } from '@/lib/caja'
import { cn } from '@/lib/utils'
import type { Caja } from '@/types/domain'

/** Ícono de la caja, del tamaño del texto que lo acompaña. */
export default function CajaIcon({ caja, className }: { caja: Caja; className?: string }) {
  const Icon = CAJA_ICON[caja]
  return <Icon aria-hidden className={cn('inline size-[1.1em] shrink-0 align-[-0.15em]', className)} />
}
