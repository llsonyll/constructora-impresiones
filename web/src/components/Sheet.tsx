import type { ReactNode } from 'react'
import { useOverlay } from '@/lib/overlay'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'

interface Props {
  onClose: () => void
  children: ReactNode
  /** Clases extra para el contenido (p. ej. `space-y-3`). */
  className?: string
  label?: string
  /** Oculta la hoja sin cerrarla (p. ej. mientras el escáner está abierto encima). */
  hidden?: boolean
  /** false: no se cierra arrastrando ni tocando el fondo en el celular (p. ej. formulario con cambios). */
  dismissible?: boolean
}

/**
 * Hoja inferior en el celular (Vaul, se cierra arrastrando hacia abajo) y diálogo centrado desde sm (Radix).
 * Atrás/Esc los maneja `useOverlay`, así el historial queda igual que con el resto de capas.
 */
export default function Sheet({ onClose, children, className = '', label, hidden = false, dismissible = true }: Props) {
  useOverlay(onClose)
  const desktop = useMediaQuery('(min-width: 640px)')
  const onOpenChange = (open: boolean) => { if (!open) onClose() }
  // Esc lo cierra useOverlay (también saca la entrada del historial); Radix no debe cerrarlo por su cuenta.
  const onEscapeKeyDown = (e: KeyboardEvent) => e.preventDefault()
  const title = label && (desktop ? <DialogTitle className="sr-only">{label}</DialogTitle> : <DrawerTitle className="sr-only">{label}</DrawerTitle>)

  if (desktop) return (
    <Dialog open={!hidden} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} onEscapeKeyDown={onEscapeKeyDown} className={className}>
        {title}{children}
      </DialogContent>
    </Dialog>
  )
  return (
    <Drawer open={!hidden} onOpenChange={onOpenChange} dismissible={dismissible} repositionInputs={false}>
      <DrawerContent aria-describedby={undefined} onEscapeKeyDown={onEscapeKeyDown}>
        <div className={cn('overflow-y-auto overscroll-contain px-4 pb-safe-4', className)}>{title}{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
