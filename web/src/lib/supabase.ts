import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (ver .env.example)')

export const supabase = createClient(url, key)

/** Tope de filas que devuelve PostgREST por consulta en Supabase: lo que pase de ahí se pierde sin error. */
export const MAX_ROWS = 1000

/**
 * Trae todas las filas de una consulta, de a MAX_ROWS. `page(from, to)` arma la consulta con `.range(from, to)`
 * y un orden estable (que termine en una columna única, p. ej. `id`), para no saltear ni repetir filas entre páginas.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += MAX_ROWS) {
    const { data, error } = await page(from, from + MAX_ROWS - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < MAX_ROWS) return rows
  }
}
