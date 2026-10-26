import { useMemo, useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '@/components/PageHeader'
import Sheet from '@/components/Sheet'
import { useProductMatcher } from '@/hooks/use-product-search'
import { normalize, rankBy } from '@/lib/search'
import type { SynonymRow } from '@/types/domain'
import { friendlyError, useDeleteSynonym, useInventory, useSaveSynonym, useSynonyms } from './api'

/** "cintillo, Precinto ,cintillo" → ["cintillo", "precinto"] (sin repetidos aunque cambien tildes o mayúsculas). */
function parseTerms(text: string) {
  const seen = new Set<string>()
  return text.split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(t => {
    const k = normalize(t)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Sinónimos de búsqueda: grupos de palabras que significan lo mismo ("amarra", "cintillo", "precinto").
 * Buscar una encuentra las demás en Ventas, Inventario, Cotizaciones, Compras y Ubicaciones (lib/search.ts).
 */
export default function SynonymsPage() {
  const { data: groups = [], isLoading, error } = useSynonyms()
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<SynonymRow | 'new' | null>(null)

  const shown = useMemo(() => {
    const q = normalize(filter)
    const list = q ? groups.filter(g => g.terms.some(t => normalize(t).includes(q))) : groups
    return [...list].sort((a, b) => a.terms[0].localeCompare(b.terms[0]))
  }, [groups, filter])

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title="Sinónimos de búsqueda" back="/inventario" backLabel="Inventario">
        <button onClick={() => setEditing('new')} className="min-h-11 rounded-lg bg-amber-700 px-3 text-sm text-white">+ Grupo</button>
      </PageHeader>
      <p className="text-sm text-stone-600">
        Palabras que significan lo mismo al buscar productos: buscar una encuentra las demás (por ejemplo, «cintillo» encuentra
        «AMARRA PLÁSTICA»). No importan mayúsculas, tildes ni plurales. Para un nombre que solo aplica a un producto, usa
        <em> También se conoce como</em> en su ficha.
      </p>

      <SearchTester />

      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-stone-400"><Search className="size-5" /></span>
        <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar una palabra en los grupos"
               aria-label="Buscar en los grupos" className="min-h-11 w-full rounded-lg border bg-white pl-10 pr-3 text-base" />
      </div>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">No se pudieron cargar: {friendlyError(error)}</p>}
      <ul className="divide-y rounded-lg bg-white shadow">
        {shown.map(g => (
          <li key={g.id}>
            <button onClick={() => setEditing(g)} className="flex w-full flex-wrap gap-1.5 p-3 text-left hover:bg-amber-50">
              {g.terms.map(t => <span key={t} className="rounded-full bg-stone-100 px-2.5 py-1 text-sm">{t}</span>)}
            </button>
          </li>
        ))}
        {!isLoading && !shown.length && (
          <li className="p-6 text-center text-sm text-stone-500">{filter ? 'Ningún grupo tiene esa palabra.' : 'Aún no hay sinónimos.'}</li>
        )}
      </ul>
      <p className="text-xs text-stone-500">{groups.length} grupo{groups.length === 1 ? '' : 's'}. Los cambios llegan a las cajas al sincronizar el catálogo.</p>

      {editing && <SynonymSheet group={editing === 'new' ? null : editing} all={groups} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Probar cómo encuentra la búsqueda (con los sinónimos y otros nombres actuales). */
function SearchTester() {
  const { data: products = [] } = useInventory()
  const [q, setQ] = useState('')
  const score = useProductMatcher(q)
  const found = useMemo(() => (score ? rankBy(products, score) : []), [products, score])
  return (
    <details className="rounded-lg border bg-white px-3 py-2">
      <summary className="cursor-pointer py-1 text-sm font-medium">Probar la búsqueda</summary>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ej.: cintillo" aria-label="Probar búsqueda"
             className="mt-2 min-h-11 w-full rounded-lg border px-3 text-base" />
      {q.trim() && (
        <div className="mt-2 text-sm">
          <p className="text-stone-500">{found.length} producto{found.length === 1 ? '' : 's'}</p>
          <ul className="mt-1 space-y-0.5">
            {found.slice(0, 10).map(p => <li key={p.id} className="truncate">{p.name}</li>)}
            {found.length > 10 && <li className="text-stone-500">…y {found.length - 10} más</li>}
          </ul>
        </div>
      )}
    </details>
  )
}

function SynonymSheet({ group, all, onClose }: { group: SynonymRow | null; all: SynonymRow[]; onClose: () => void }) {
  const save = useSaveSynonym()
  const del = useDeleteSynonym()
  const [text, setText] = useState(group?.terms.join(', ') ?? '')
  const [error, setError] = useState('')
  const terms = parseTerms(text)
  // Una palabra en dos grupos une ambos al buscar: se avisa (puede ser a propósito, como "goma").
  const elsewhere = terms.filter(t => all.some(g => g.id !== group?.id && g.terms.some(x => normalize(x) === normalize(t))))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (terms.length < 2) return setError('Escribe al menos dos palabras o frases, separadas por coma.')
    try {
      await save.mutateAsync({ id: group?.id, terms })
      toast.success('Sinónimos guardados')
      onClose()
    } catch (err) { setError(friendlyError(err)) }
  }

  async function onDelete() {
    if (!group || !confirm(`¿Eliminar el grupo «${group.terms.join(', ')}»?`)) return
    try { await del.mutateAsync(group.id); toast.success('Grupo eliminado'); onClose() } catch (err) { setError(friendlyError(err)) }
  }

  return (
    <Sheet onClose={onClose} label="Sinónimos" className="space-y-3 sm:max-w-md" dismissible={false}>
      <h2 className="text-lg font-semibold">{group ? 'Editar sinónimos' : 'Nuevo grupo de sinónimos'}</h2>
      <form onSubmit={onSubmit} className="space-y-2">
        <label className="block text-xs text-stone-500">Palabras o frases que significan lo mismo, separadas por coma
          <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-base" rows={3} value={text} autoFocus
                    onChange={e => { setText(e.target.value); setError('') }} placeholder="amarra, cintillo, precinto" />
        </label>
        {terms.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {terms.map(t => <span key={t} className="rounded-full bg-amber-50 px-2.5 py-1 text-sm text-amber-900">{t}</span>)}
          </div>
        )}
        {elsewhere.length > 0 && (
          <p className="text-sm text-amber-700">
            {elsewhere.map(t => `«${t}»`).join(', ')} también está{elsewhere.length > 1 ? 'n' : ''} en otro grupo: al buscarla{elsewhere.length > 1 ? 's' : ''} saldrán los dos.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          {group && (
            <button type="button" onClick={onDelete} disabled={del.isPending}
                    className="mr-auto min-h-11 rounded-lg border border-red-300 px-3 text-sm text-red-700 disabled:opacity-50">Eliminar</button>
          )}
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm">Cancelar</button>
          <button disabled={save.isPending} className="min-h-11 rounded-lg bg-amber-700 px-5 text-sm text-white disabled:opacity-50">
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
