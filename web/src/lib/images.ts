import { supabase } from '@/lib/supabase'

const BUCKET = 'product-images'
const MAX_SIDE = 1024

/** Reduce la foto de la cámara (3-12 MB) a ~100 KB. JPEG porque Safari/iOS no codifica WebP en canvas. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.8))
}

/** Sube la foto y la asigna al producto. Devuelve la ruta guardada en products.image_path. */
export async function uploadProductImage(productId: string, file: File, previousPath?: string | null) {
  const blob = await compressImage(file)
  const path = `${productId}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
  if (error) throw error
  const { error: e2 } = await supabase.from('products').update({ image_path: path }).eq('id', productId)
  if (e2) throw e2
  if (previousPath) void supabase.storage.from(BUCKET).remove([previousPath])
  return path
}

export const imageUrl = (path: string | null | undefined) =>
  path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null
