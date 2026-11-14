import { useEffect, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import ProductImage from './ProductImage'

interface Props {
  file: File | null
  onChange: (f: File | null) => void
  currentUrl?: string | null
  label?: string
  /** Subiendo `file`: se ve la foto nueva con un indicador encima y no se puede cambiar. */
  busy?: boolean
}

/** Botón que abre la cámara trasera (capture) y muestra la vista previa. */
export default function PhotoInput({ file, onChange, currentUrl, label = 'Tomar foto', busy = false }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const src = preview ?? currentUrl
  return (
    <div className="flex items-center gap-3">
      <span className="relative shrink-0">
        <ProductImage src={src} lazy={false} className={src ? 'h-20 w-20 rounded-lg border' : 'h-20 w-20 rounded-lg border border-dashed'} />
        {busy && <span role="status" aria-label="Subiendo foto" className="absolute inset-0 grid place-items-center rounded-lg bg-black/40 text-white">
          <Loader2 className="size-7 animate-spin" aria-hidden />
        </span>}
      </span>
      <label className={`flex min-h-11 items-center rounded-lg border px-4 text-sm ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
        <Camera className="mr-2 size-5" />{busy ? 'Subiendo…' : src ? 'Cambiar foto' : label}
        <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
               onChange={e => { onChange(e.target.files?.[0] ?? null); e.target.value = '' }} />
      </label>
      {file && !busy && <button type="button" onClick={() => onChange(null)} className="min-h-11 px-2 text-sm text-stone-500 underline">quitar</button>}
    </div>
  )
}
