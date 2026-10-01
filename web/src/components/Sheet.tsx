import { useRef, useState, type ReactNode } from 'react'
import { useOverlay } from '@/lib/overlay'

interface Props {
  onClose: () => void
  children: ReactNode
  /** Clases extra para el panel (p. ej. `space-y-3`). */
  className?: string
  label?: string
}

/**
 * Hoja inferior en el celular (diálogo centrado desde sm). Se cierra con atrás/Esc, tocando el fondo
 * o arrastrando la manija hacia abajo; respeta la barra de gestos y bloquea el scroll del fondo.
 */
export default function Sheet({ onClose, children, className = '', label }: Props) {
  useOverlay(onClose)
  // Solo cuenta como toque en el fondo si empezó en el fondo (no al soltar una selección de texto fuera).
  const downOnBackdrop = useRef(false)
  const drag = useRef<{ y: number; id: number } | null>(null)
  const [dy, setDy] = useState(0)

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
         onPointerDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
         onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={label}
           style={dy ? { transform: `translateY(${dy}px)` } : undefined}
           className={`max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-white px-4 pt-2 pb-safe-4
                       sm:rounded-2xl sm:pt-4 sm:pb-4 ${dy ? '' : 'transition-transform'} ${className}`}>
        <div aria-hidden className="-mx-4 flex h-6 touch-none items-center justify-center sm:hidden"
             onPointerDown={e => { drag.current = { y: e.clientY, id: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId) }}
             onPointerMove={e => { if (drag.current?.id === e.pointerId) setDy(Math.max(0, e.clientY - drag.current.y)) }}
             onPointerUp={() => { if (dy > 80) onClose(); drag.current = null; setDy(0) }}
             onPointerCancel={() => { drag.current = null; setDy(0) }}>
          <span className="h-1.5 w-10 rounded-full bg-stone-300" />
        </div>
        {children}
      </div>
    </div>
  )
}
