import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDb } from '@/db/local'
import { buildSynonymIndex, productMatcher } from '@/lib/search'
import type { SynonymRow } from '@/types/domain'

const NONE: SynonymRow[] = []

/**
 * Función de puntaje para buscar productos (0 = no coincide), con los sinónimos guardados en el equipo
 * (se descargan con el catálogo). `null` si la búsqueda está vacía. Ver lib/search.ts.
 */
export function useProductMatcher(query: string) {
  const rows = useLiveQuery(() => localDb.synonyms.toArray(), [], NONE)
  const index = useMemo(() => buildSynonymIndex(rows.map(r => r.terms)), [rows])
  return useMemo(() => productMatcher(query, index), [query, index])
}
