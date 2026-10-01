import { useSyncExternalStore } from 'react'

/** true mientras la media query se cumpla (se actualiza al girar el celular o cambiar el ancho). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    cb => { const m = matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => matchMedia(query).matches,
  )
}
