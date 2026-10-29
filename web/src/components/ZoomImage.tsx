import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

const MAX = 4      // las fotos se guardan a 1024 px de lado: más allá de 4× solo se ven los píxeles
const STEP = 1.5   // botones +/− y doble toque
const TAP_MS = 300

interface View { s: number; x: number; y: number }
const START: View = { s: 1, x: 0, y: 0 }

/**
 * Foto con zoom: pellizcar o rueda del mouse para acercar, arrastrar para moverla, doble toque para
 * acercar/volver, y botones +/− para quien no puede pellizcar. `data-vaul-no-drag`: en el celular los
 * gestos sobre la foto no deben cerrar la hoja.
 */
export default function ZoomImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(START)
  // Con un dedo o el mouse encima la foto sigue al gesto sin animación; los botones sí animan.
  const [gesture, setGesture] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; s: number } | null>(null)
  const tap = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)

  /** Mantiene la foto dentro del marco: no se puede arrastrar más allá de su borde. */
  function clamp(v: View): View {
    const el = frame.current
    if (!el || v.s <= 1) return START
    const mx = (el.clientWidth * (v.s - 1)) / 2, my = (el.clientHeight * (v.s - 1)) / 2
    return { s: v.s, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) }
  }

  /** Zoom a `s` dejando quieto el punto (cx, cy) de la pantalla (los dedos, el cursor; sin punto: el centro). */
  function zoomTo(s: number, cx?: number, cy?: number) {
    const el = frame.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = cx == null ? 0 : cx - (r.left + r.width / 2), py = cy == null ? 0 : cy - (r.top + r.height / 2)
    const v = viewRef.current
    const ns = Math.max(1, Math.min(MAX, s))
    const k = ns / v.s
    setView(clamp({ s: ns, x: px - (px - v.x) * k, y: py - (py - v.y) * k }))
  }

  // Rueda: listener nativo porque React registra `wheel` como pasivo y no deja frenar el scroll de la hoja.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomTo(viewRef.current.s * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Otra foto: vuelve a verse entera.
  useEffect(() => { setView(START) }, [src])

  const pinchDist = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setGesture(true)
    if (pointers.current.size === 2) { pinch.current = { dist: pinchDist(), s: viewRef.current.s }; tap.current = null }
    else tap.current = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false }
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 8) tap.current.moved = true
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      zoomTo(pinch.current.s * (pinchDist() / pinch.current.dist), (a.x + b.x) / 2, (a.y + b.y) / 2)
    } else if (pointers.current.size === 1 && viewRef.current.s > 1) {
      const v = viewRef.current
      setView(clamp({ s: v.s, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (!pointers.current.size) setGesture(false)
    const t = tap.current
    tap.current = null
    if (e.type !== 'pointerup' || !t || t.moved || Date.now() - t.t > TAP_MS) return
    // Doble toque (o doble clic): acerca donde se tocó; si ya estaba acercada, vuelve a verse entera.
    const last = lastTap.current
    if (last && Date.now() - last.t < TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      lastTap.current = null
      if (viewRef.current.s > 1) setView(START)
      else zoomTo(STEP * STEP, e.clientX, e.clientY)
    } else lastTap.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }

  const zoomed = view.s > 1
  const btn = 'grid size-11 place-items-center rounded-full bg-white/90 text-stone-800 shadow disabled:opacity-40'
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-stone-100', className)}>
      <div ref={frame} data-vaul-no-drag onPointerDown={onPointerDown} onPointerMove={onPointerMove}
           onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
           className={cn('size-full touch-none select-none', zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}>
        <img src={src} alt={alt} draggable={false}
             style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
             className={cn('size-full object-contain', !gesture && 'transition-transform duration-150')} />
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1.5">
        {zoomed && <button type="button" onClick={() => setView(START)} className={btn} aria-label="Ver la foto entera"><RotateCcw className="size-5" /></button>}
        <button type="button" onClick={() => zoomTo(view.s / STEP)} disabled={!zoomed} className={btn} aria-label="Alejar"><Minus className="size-5" /></button>
        <button type="button" onClick={() => zoomTo(view.s * STEP)} disabled={view.s >= MAX} className={btn} aria-label="Acercar"><Plus className="size-5" /></button>
      </div>
      {!zoomed && <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">Doble toque o pellizca para acercar</span>}
    </div>
  )
}
