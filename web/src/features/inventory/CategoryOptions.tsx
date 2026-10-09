import { CAJAS, CAJA_LABEL } from '@/lib/caja'
import type { Category } from '@/types/domain'

/** Opciones de categoría agrupadas por caja (la categoría decide en qué caja del POS se vende el producto). */
export default function CategoryOptions({ categories }: { categories: Category[] }) {
  return CAJAS.map(caja => (
    <optgroup key={caja} label={CAJA_LABEL[caja]}>
      {categories.filter(c => c.caja === caja).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </optgroup>
  ))
}
