import { useEffect, useState } from 'react'

interface Props {
  file: File | null
  onChange: (f: File | null) => void
  currentUrl?: string | null
  label?: string
}

/** Botón que abre la cámara trasera (capture) y muestra la vista previa. */
export default function PhotoInput({ file, onChange, currentUrl, label = 'Tomar foto' }: Props) {
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
      {src
        ? <img src={src} alt="" className="h-20 w-20 rounded-lg border object-cover" />
        : <div className="grid h-20 w-20 place-items-center rounded-lg border border-dashed text-2xl text-stone-400">📦</div>}
      <label className="cursor-pointer rounded-lg border px-4 py-3 text-sm">
        📸 {src ? 'Cambiar foto' : label}
        <input type="file" accept="image/*" capture="environment" className="hidden"
               onChange={e => onChange(e.target.files?.[0] ?? null)} />
      </label>
      {file && <button type="button" onClick={() => onChange(null)} className="text-sm text-stone-500 underline">quitar</button>}
    </div>
  )
}
