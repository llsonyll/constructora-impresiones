import { useEffect, useRef, useState } from 'react'
import { getDetector } from '@/lib/scanner'
import { useOverlay } from '@/lib/overlay'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
  title?: string
}

/** Escáner a pantalla completa con la cámara trasera. Devuelve el primer código leído. */
export default function BarcodeScanner({ onDetected, onClose, title = 'Escanear código' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const doneRef = useRef(false)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected
  useOverlay(onClose)

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer = 0
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) return
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        const detector = await getDetector()
        const tick = async () => {
          if (cancelled || doneRef.current) return
          if (video.readyState >= 2) {
            try {
              const [hit] = await detector.detect(video)
              if (hit?.rawValue && !doneRef.current) {
                doneRef.current = true
                navigator.vibrate?.(80)
                onDetectedRef.current(hit.rawValue.trim())
                return
              }
            } catch { /* frame ilegible: seguir */ }
          }
          timer = window.setTimeout(tick, 120)
        }
        tick()
      } catch (e) {
        const name = (e as DOMException).name
        setError(name === 'NotAllowedError'
          ? 'Sin permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio.'
          : name === 'NotFoundError' ? 'No se encontró una cámara.' : `No se pudo abrir la cámara (${name || e}).`)
      }
    }
    start()
    return () => {
      cancelled = true
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center gap-2 pt-safe px-safe-3">
        <h2 className="flex-1 truncate font-medium">{title}</h2>
        <button onClick={onClose} aria-label="Cerrar" className="grid size-12 place-items-center text-2xl">✕</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-4/5 max-w-sm rounded-lg border-2 border-amber-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {error && <p className="absolute inset-x-4 top-1/3 rounded bg-red-900/80 p-3 text-center">{error}</p>}
      </div>
      <form className="flex gap-2 px-safe-3 pt-3 pb-safe-3" onSubmit={e => { e.preventDefault(); if (manual.trim()) onDetected(manual.trim()) }}>
        <input value={manual} onChange={e => setManual(e.target.value)} inputMode="numeric" placeholder="o escribe el código"
               className="min-w-0 flex-1 rounded bg-white/10 p-3 text-white placeholder:text-white/50" />
        <button className="min-h-11 rounded bg-amber-600 px-5">OK</button>
      </form>
    </div>
  )
}
