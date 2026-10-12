import { useState, type FormEvent } from 'react'
import Sheet from '@/components/Sheet'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { FurnitureType, Location } from '@/types/domain'
import { FURNITURE_LABEL, LOCATION_RE, friendlyLocationError, locationKeys, useDeleteLocation, useSaveLocation } from './api'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const input = 'min-h-11 w-full rounded-lg border px-2 text-base'
const codeOf = (f: string, body: string, level: number, slot: string) =>
  `${f}${body ? `-${body}` : ''}-N${level}${slot ? `-${slot}` : ''}`

/**
 * Crear o editar una ubicación. Al crear se puede generar un mueble entero de una vez: niveles desde/hasta
 * y, si los niveles están divididos, cuántas secciones (A, B, C…) tiene cada uno.
 */
export default function LocationForm({ location, defaultFurniture, productCount, onClose, onSaved, onDeleted }: {
  location: Location | null; defaultFurniture: string; productCount: number
  onClose: () => void; onSaved: (id: number, furniture: string) => void; onDeleted: () => void
}) {
  const qc = useQueryClient()
  const save = useSaveLocation()
  const del = useDeleteLocation()
  const [furniture, setFurniture] = useState(location?.furniture ?? defaultFurniture)
  const [body, setBody] = useState(location?.body ?? '')
  const [level, setLevel] = useState(String(location?.level ?? 1))
  const [levelTo, setLevelTo] = useState(String(location?.level ?? 1))
  const [slot, setSlot] = useState(location?.slot ?? '')
  const [slots, setSlots] = useState('0')   // al crear: secciones por nivel (0 = nivel entero)
  const [type, setType] = useState<FurnitureType>(location?.furniture_type ?? 'estante')
  const [description, setDescription] = useState(location?.description ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const f = furniture.trim().toUpperCase(), b = body.trim().toUpperCase(), s = slot.trim().toUpperCase()
  const from = Number(level), to = location ? from : Number(levelTo), nSlots = Number(slots)
  const codes: string[] = []
  if (Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && to - from < 30)
    for (let l = from; l <= to; l++) {
      if (location || nSlots === 0) codes.push(codeOf(f, b, l, location ? s : ''))
      else for (const x of LETTERS.slice(0, nSlots)) codes.push(codeOf(f, b, l, x))
    }
  const valid = codes.length > 0 && codes.every(c => LOCATION_RE.test(c))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return setError('Revisa los datos: el código debe verse como E2-N5 o E0-B-N2-F.')
    setError(''); setBusy(true)
    try {
      const common = { furniture: f, body: b || null, furniture_type: type, description: description.trim() || null }
      if (location) {
        const id = await save.mutateAsync({ ...common, id: location.id, level: from, slot: s || null, active: location.active })
        onSaved(id, f)
      } else {
        // Varias a la vez en una sola inserción: si alguna ya existe, no se crea ninguna.
        const rows = []
        for (let l = from; l <= to; l++)
          for (const x of nSlots === 0 ? [null] : [...LETTERS.slice(0, nSlots)]) rows.push({ ...common, level: l, slot: x })
        const { data, error } = await supabase.from('locations').insert(rows).select('id')
        if (error) throw error
        await qc.invalidateQueries({ queryKey: locationKeys.all })
        onSaved(data[0].id as number, f)
      }
    } catch (err) { setError(friendlyLocationError(err)) } finally { setBusy(false) }
  }

  async function toggleActive() {
    if (!location) return
    setBusy(true); setError('')
    try {
      await save.mutateAsync({ id: location.id, furniture: location.furniture, body: location.body, level: location.level, slot: location.slot,
        furniture_type: location.furniture_type, description: location.description, active: !location.active })
      onClose()
    } catch (err) { setError(friendlyLocationError(err)) } finally { setBusy(false) }
  }

  async function remove() {
    if (!location || !confirm(`¿Eliminar la ubicación ${location.code}?`)) return
    try { await del.mutateAsync(location.id); onDeleted() } catch (err) { setError(friendlyLocationError(err)) }
  }

  return (
    <Sheet onClose={onClose} label={location ? `Editar ${location.code}` : 'Nueva ubicación'} className="space-y-3 sm:max-w-md">
      <h2 className="text-lg font-semibold">{location ? `Editar ${location.code}` : 'Nueva ubicación'}</h2>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-2">
        <label className="text-xs text-stone-500">Mueble
          <input className={`${input} mt-1 uppercase`} value={furniture} onChange={e => setFurniture(e.target.value)} placeholder="E6" required />
        </label>
        <label className="text-xs text-stone-500">Tipo
          <select className={`${input} mt-1`} value={type} onChange={e => setType(e.target.value as FurnitureType)}>
            {Object.entries(FURNITURE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500">Cuerpo (opcional)
          <input className={`${input} mt-1 uppercase`} value={body} maxLength={1} onChange={e => setBody(e.target.value)} placeholder="—" />
        </label>
        {location ? (
          <>
            <label className="text-xs text-stone-500">Nivel (1 = arriba)
              <input className={`${input} mt-1`} inputMode="numeric" value={level} onChange={e => setLevel(e.target.value)} />
            </label>
            <label className="text-xs text-stone-500">Sección (opcional)
              <input className={`${input} mt-1 uppercase`} value={slot} maxLength={1} onChange={e => setSlot(e.target.value)} placeholder="—" />
            </label>
          </>
        ) : (
          <>
            <label className="text-xs text-stone-500">Secciones por nivel
              <select className={`${input} mt-1`} value={slots} onChange={e => setSlots(e.target.value)}>
                <option value="0">Ninguna (nivel entero)</option>
                {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n} (A–{LETTERS[n - 1]})</option>)}
              </select>
            </label>
            <label className="text-xs text-stone-500">Nivel desde (1 = arriba)
              <input className={`${input} mt-1`} inputMode="numeric" value={level} onChange={e => setLevel(e.target.value)} />
            </label>
            <label className="text-xs text-stone-500">hasta
              <input className={`${input} mt-1`} inputMode="numeric" value={levelTo} onChange={e => setLevelTo(e.target.value)} />
            </label>
          </>
        )}
        <label className="col-span-2 text-xs text-stone-500">Descripción (opcional)
          <input className={`${input} mt-1`} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ej.: tornillería, junto a la caja" />
        </label>

        <p className={`col-span-2 rounded-lg p-2 text-sm ${valid ? 'bg-stone-100' : 'bg-red-50 text-red-700'}`}>
          {valid
            ? <>{codes.length === 1 ? 'Código' : `Se crearán ${codes.length}`}: <span className="font-mono">{codes.length > 6 ? `${codes.slice(0, 3).join(', ')} … ${codes.at(-1)}` : codes.join(', ')}</span></>
            : 'Código inválido. Formato: MUEBLE[-CUERPO]-NIVEL[-SECCIÓN], p. ej. E2-N5.'}
        </p>
        {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}

        <div className="col-span-2 flex flex-wrap justify-end gap-2">
          {location && (
            <>
              <button type="button" onClick={toggleActive} disabled={busy} className="min-h-11 rounded-lg border px-3 text-sm">
                {location.active ? 'Desactivar' : 'Activar'}
              </button>
              {productCount === 0 && (
                <button type="button" onClick={remove} disabled={busy} className="min-h-11 rounded-lg border border-red-300 px-3 text-sm text-red-700">Eliminar</button>
              )}
            </>
          )}
          <button disabled={busy || !valid} className="min-h-11 rounded-lg bg-amber-700 px-5 text-sm text-white disabled:opacity-50">
            {busy ? 'Guardando…' : location ? 'Guardar' : 'Crear'}
          </button>
        </div>
        {location && productCount > 0 && (
          <p className="col-span-2 text-xs text-stone-500">Tiene {productCount} producto{productCount === 1 ? '' : 's'}: no se puede eliminar, solo desactivar.</p>
        )}
      </form>
    </Sheet>
  )
}
