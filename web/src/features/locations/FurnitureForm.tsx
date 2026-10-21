import { useMemo, useState, type FormEvent } from 'react'
import Sheet from '@/components/Sheet'
import type { FurnitureType, Location } from '@/types/domain'
import { FURNITURE_LABEL, LOCATION_RE, friendlyLocationError, useReshapeFurniture } from './api'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const input = 'min-h-11 w-full rounded-lg border px-2 text-base'

/**
 * Corregir un mueble (o un cuerpo) entero: niveles, secciones por nivel, código y tipo; o eliminarlo.
 * Muestra antes de guardar qué casillas se crean y cuáles se quitan; las que tienen productos no se quitan.
 */
export default function FurnitureForm({ furniture, body, locations, productCount, onClose, onDone }: {
  furniture: string; body: string | null; locations: Location[]; productCount: (id: number) => number
  onClose: () => void; onDone: (furniture: string | null) => void
}) {
  const reshape = useReshapeFurniture()
  const levelsNow = Math.max(...locations.map(l => l.level))
  const slotsNow = Math.max(0, ...[...new Set(locations.map(l => l.level))].map(lv =>
    locations.filter(l => l.level === lv && l.slot).length))
  const [code, setCode] = useState(furniture)
  const [type, setType] = useState<FurnitureType>(locations[0]?.furniture_type ?? 'estante')
  const [levels, setLevels] = useState(String(levelsNow))
  const [slots, setSlots] = useState(String(slotsNow))
  const [error, setError] = useState('')
  const name = `${furniture}${body ? `-${body}` : ''}`

  const nLevels = Number(levels), nSlots = Number(slots)
  const newF = code.trim().toUpperCase()
  const validInput = Number.isInteger(nLevels) && nLevels >= 1 && nLevels <= 30 && /^[A-Z]\d+$/.test(newF)

  // Misma regla que la RPC: qué casillas existentes desaparecen con la forma nueva.
  const removed = useMemo(() => {
    if (!validInput) return []
    const last = nSlots > 0 ? LETTERS[nSlots - 1] : null
    return locations.filter(l => {
      if (l.level > nLevels) return true
      const inLevel = locations.filter(x => x.level === l.level)
      if (nSlots === 0) {
        const keep = inLevel.find(x => !x.slot) ?? [...inLevel].sort((a, b) => (a.slot ?? '').localeCompare(b.slot ?? ''))[0]
        return l.id !== keep.id
      }
      if (!l.slot) return inLevel.some(x => x.slot === 'A')   // el nivel entero pasa a ser la A (si no existe ya)
      return l.slot > last!
    })
  }, [locations, nLevels, nSlots, validInput])
  const blocked = removed.filter(l => productCount(l.id) > 0)
  const codes: string[] = []
  if (validInput) for (let lv = 1; lv <= nLevels; lv++)
    for (const s of nSlots === 0 ? [''] : [...LETTERS.slice(0, nSlots)]) codes.push(`${newF}${body ? `-${body}` : ''}-N${lv}${s ? `-${s}` : ''}`)
  const valid = validInput && codes.every(c => LOCATION_RE.test(c))
  const total = locations.reduce((s, l) => s + productCount(l.id), 0)
  const unchanged = newF === furniture && nLevels === levelsNow && nSlots === slotsNow && type === locations[0]?.furniture_type
    && locations.length === codes.length

  async function run(levelsArg: number) {
    setError('')
    try {
      await reshape.mutateAsync({ furniture, body, levels: levelsArg, slots: nSlots, new_furniture: newF, furniture_type: type })
      onDone(levelsArg === 0 ? null : newF)
    } catch (e) { setError(friendlyLocationError(e)) }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid || blocked.length) return
    if (removed.length && !confirm(`Se quitarán ${removed.length} casilla${removed.length === 1 ? '' : 's'} vacía${removed.length === 1 ? '' : 's'}: ${removed.map(l => l.code).join(', ')}. ¿Continuar?`)) return
    void run(nLevels)
  }

  function removeAll() {
    if (!confirm(`¿Eliminar el mueble ${name} completo (${locations.length} casillas)?`)) return
    void run(0)
  }

  return (
    <Sheet onClose={onClose} label={`Editar mueble ${name}`} className="space-y-3 sm:max-w-md">
      <h2 className="text-lg font-semibold">Editar mueble <span className="font-mono">{name}</span></h2>
      <p className="text-xs text-stone-500">
        Hoy: {levelsNow} nivel{levelsNow === 1 ? '' : 'es'}, {slotsNow ? `${slotsNow} secciones por nivel` : 'niveles enteros'} · {locations.length} casillas
        {total > 0 && ` · ${total} producto${total === 1 ? '' : 's'} ubicado${total === 1 ? '' : 's'}`}
      </p>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-2">
        <label className="text-xs text-stone-500">Código del mueble
          <input className={`${input} mt-1 uppercase`} value={code} onChange={e => setCode(e.target.value)} />
        </label>
        <label className="text-xs text-stone-500">Tipo
          <select className={`${input} mt-1`} value={type} onChange={e => setType(e.target.value as FurnitureType)}>
            {Object.entries(FURNITURE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500">Niveles
          <input className={`${input} mt-1`} inputMode="numeric" value={levels} onChange={e => setLevels(e.target.value)} />
        </label>
        <label className="text-xs text-stone-500">Secciones por nivel
          <select className={`${input} mt-1`} value={slots} onChange={e => setSlots(e.target.value)}>
            <option value="0">Ninguna (nivel entero)</option>
            {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n} (A–{LETTERS[n - 1]})</option>)}
          </select>
        </label>

        <div className={`col-span-2 space-y-1 rounded-lg p-2 text-sm ${!valid ? 'bg-red-50 text-red-700' : blocked.length ? 'bg-amber-50 text-amber-900' : 'bg-stone-100'}`}>
          {!valid ? <p>Revisa los datos: el código del mueble es una letra y un número (E7) y los niveles van de 1 a 30.</p> : <>
            <p>Quedará: <span className="font-mono">{codes.length > 6 ? `${codes.slice(0, 3).join(', ')} … ${codes.at(-1)}` : codes.join(', ')}</span> ({codes.length})</p>
            {removed.length > 0 && <p>Se quitan: <span className="font-mono">{removed.map(l => l.code).join(', ')}</span></p>}
            {blocked.length > 0 && <p className="font-medium">No se puede: {blocked.map(l => `${l.code} (${productCount(l.id)} prod.)`).join(', ')} tiene productos. Muévelos antes o elige otra forma.</p>}
          </>}
        </div>
        {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}

        <div className="col-span-2 flex flex-wrap justify-end gap-2">
          {total === 0 && (
            <button type="button" onClick={removeAll} disabled={reshape.isPending}
                    className="mr-auto min-h-11 rounded-lg border border-red-300 px-3 text-sm text-red-700">Eliminar mueble</button>
          )}
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm">Cancelar</button>
          <button disabled={reshape.isPending || !valid || blocked.length > 0 || unchanged}
                  className="min-h-11 rounded-lg bg-amber-700 px-5 text-sm text-white disabled:opacity-50">
            {reshape.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        {total > 0 && <p className="col-span-2 text-xs text-stone-500">Tiene productos ubicados: no se puede eliminar completo (sí corregir sus casillas vacías).</p>}
      </form>
    </Sheet>
  )
}
