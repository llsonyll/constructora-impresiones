import { useCallback, useState } from 'react'
import { ImageOff, Package } from 'lucide-react'
import { imageUrl } from '@/lib/images'
import { cn } from '@/lib/utils'

export type ImageStatus = 'empty' | 'loading' | 'loaded' | 'error'

/**
 * Estado de carga de una <img>: `empty` sin foto, `loading` mientras baja, `loaded` o `error` (sin internet,
 * archivo borrado). Pasar `imgProps` a la <img>. El `ref` cubre la foto que ya estaba en caché y terminó de
 * cargar antes de que React escuchara `onLoad`. Al cambiar `src` vuelve a `loading`.
 *
 * `crossOrigin`: la foto se pide con CORS para que la PWA pueda guardarla para usar sin internet (ver
 * `runtimeCaching` en vite.config.ts). Toda <img> de una foto de producto debe llevarlo: si una sin CORS la
 * guardara primero, las demás no podrían usar esa copia.
 */
export function useImageStatus(src: string | null | undefined) {
  const [done, setDone] = useState<{ src: string; ok: boolean } | null>(null)
  const status: ImageStatus = !src ? 'empty' : done?.src !== src ? 'loading' : done.ok ? 'loaded' : 'error'
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img && src && img.complete) setDone({ src, ok: img.naturalWidth > 0 })
  }, [src])
  const imgProps = {
    ref,
    crossOrigin: 'anonymous' as const,
    onLoad: () => { if (src) setDone({ src, ok: true }) },
    onError: () => { if (src) setDone({ src, ok: false }) },
  }
  return { status, imgProps }
}

const ICON = { xs: 'size-5', sm: 'size-6', md: 'size-10', lg: 'size-20' } as const
export type PlaceholderSize = keyof typeof ICON

/**
 * Miniatura genérica: producto sin foto (`empty`) o foto que no se pudo cargar (`error`). Ícono y texto toman el
 * color del texto: sobre fondo oscuro, `className="bg-transparent text-white/40"`.
 */
export function ImagePlaceholder({ kind = 'empty', size = 'md', label, className }: {
  kind?: 'empty' | 'error'
  size?: PlaceholderSize
  /** Texto bajo el ícono. `true` usa el de siempre ("Sin foto" / "No se pudo cargar la foto"). */
  label?: boolean | string
  className?: string
}) {
  const Icon = kind === 'error' ? ImageOff : Package
  const text = label === true ? (kind === 'error' ? 'No se pudo cargar la foto' : 'Sin foto') : label || null
  return (
    <span aria-hidden={text ? undefined : true}
          className={cn('grid size-full place-items-center bg-stone-100 text-stone-400', className)}>
      <span className="grid justify-items-center gap-1 text-center">
        <Icon className={ICON[size]} strokeWidth={size === 'xs' || size === 'sm' ? 2 : 1.5} aria-hidden />
        {text && <span className="px-2 text-xs">{text}</span>}
      </span>
    </span>
  )
}

interface Props {
  /** `products.image_path`. */
  path?: string | null
  /** URL ya armada (vista previa local de la cámara); tiene prioridad sobre `path`. */
  src?: string | null
  alt?: string
  fit?: 'cover' | 'contain'
  size?: PlaceholderSize
  /** Ver `ImagePlaceholder`. */
  label?: boolean | string
  lazy?: boolean
  /** Marco: tamaño, borde, redondeo. La foto y el placeholder lo llenan. */
  className?: string
}

/**
 * Foto de producto con estados: pulso gris mientras carga, aparece suave al terminar, y la miniatura genérica
 * cuando el producto no tiene foto o no se pudo cargar (sin internet en la PWA).
 */
export default function ProductImage({ path, src, alt = '', fit = 'cover', size = 'md', label, lazy = true, className }: Props) {
  const url = src ?? imageUrl(path)
  const { status, imgProps } = useImageStatus(url)
  return (
    <span className={cn('relative block overflow-hidden bg-stone-100', className)}>
      {status === 'empty' || status === 'error'
        ? <ImagePlaceholder kind={status} size={size} label={label} className="absolute inset-0" />
        : <>
            {status === 'loading' && <span aria-hidden className="absolute inset-0 animate-pulse bg-stone-200" />}
            <img {...imgProps} src={url!} alt={alt} loading={lazy ? 'lazy' : undefined} decoding="async" draggable={false}
                 className={cn('absolute inset-0 size-full transition-opacity duration-300',
                               fit === 'cover' ? 'object-cover' : 'object-contain',
                               status === 'loaded' ? 'opacity-100' : 'opacity-0')} />
          </>}
    </span>
  )
}
