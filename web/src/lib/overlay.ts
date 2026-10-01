import { useEffect, useRef } from 'react'

/**
 * Pila de capas abiertas (hojas, editor, escáner). Cada capa agrega una entrada al historial para que
 * el botón "atrás" de Android (o el gesto de volver en iPhone) cierre la capa de arriba en vez de salir
 * de la pantalla. Esc hace lo mismo en escritorio. Mientras haya alguna abierta, el fondo no se desplaza.
 */
interface Entry { id: number; close: () => void; pushed: boolean; alive: boolean }

const stack: Entry[] = []
let seq = 0
let skipPops = 0

function syncScrollLock() {
  document.body.style.overflow = stack.length ? 'hidden' : ''
}

function push(entry: Entry) {
  // Se conserva el state del router (idx/key) para que no lo tome como navegación.
  history.pushState({ ...history.state, overlay: entry.id }, '')
  entry.pushed = true
}

function closeTop() {
  const top = stack.pop()
  if (!top) return
  syncScrollLock()
  top.close()
  // Si la capa no se cerró (p. ej. "¿Descartar cambios?" → Cancelar), vuelve a la pila.
  setTimeout(() => {
    if (!top.alive) return
    stack.push(top); push(top); syncScrollLock()
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (skipPops) { skipPops--; return }
    const top = stack[stack.length - 1]
    if (top?.pushed) { top.pushed = false; closeTop() }
  })
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && stack.length) {
      const top = stack[stack.length - 1]
      // Cerrar con Esc consume la entrada de historial igual que el botón atrás.
      if (top.pushed) { top.pushed = false; skipPops++; history.back() }
      closeTop()
    }
  })
}

/** Registra una capa abierta mientras `active` sea true; `onClose` se llama con atrás o Esc. */
export function useOverlay(onClose: () => void, active = true) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return
    const entry: Entry = { id: ++seq, close: () => closeRef.current(), pushed: false, alive: true }
    stack.push(entry)
    syncScrollLock()
    // Diferido: en StrictMode el efecto se monta, desmonta y vuelve a montar al instante.
    const t = setTimeout(() => { if (entry.alive && stack.includes(entry)) push(entry) })
    return () => {
      clearTimeout(t)
      entry.alive = false
      const i = stack.indexOf(entry)
      if (i < 0) return
      // Cerrada desde la pantalla (✕, Guardar…): quitar sus entradas de historial y las de capas hijas.
      const removed = stack.splice(i)
      syncScrollLock()
      const n = removed.filter(x => x.pushed).length
      if (n) { skipPops++; history.go(-n) }
    }
  }, [active])
}
