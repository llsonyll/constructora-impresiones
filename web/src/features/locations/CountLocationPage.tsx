import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ScanBarcode, Search } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import BarcodeScanner from '@/components/BarcodeScanner'
import Sheet from '@/components/Sheet'
import ProductImage from '@/components/ProductImage'
import { rankBy, withCode } from '@/lib/search'
import { useProductMatcher } from '@/hooks/use-product-search'
import { type InventoryProduct, useInventory } from '@/features/inventory/api'
import QuickCreateSheet from '@/features/inventory/QuickCreateSheet'
import { type CountLocationResult, friendlyLocationError, useCountLocation, useLocations } from './api'
import { type CountDraft, countPayload, parseQty, planCount } from './count'

const draftKey = (id: number) => `conteo-casillero-${id}`
function loadDraft(id: number): CountDraft {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) ?? '{}') } catch { return {} }
}
const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * Contar un casillero: lo que ya está ubicado aquí sale en la lista; lo demás se agrega buscando o escaneando
 * seguido. Se escribe cuánto hay de cada cosa y al guardar (RPC count_location, una transacción) cada producto
 * queda ubicado aquí, con esa cantidad, y su stock corregido si se conoce el total. El borrador queda en el equipo
 * con la hora en que se contó cada línea, así guardarlo más tarde no borra las ventas hechas mientras tanto.
 */
export default function CountLocationPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { data: locations = [], isLoading: loadingLocs } = useLocations()
  const { data: products = [], isLoading } = useInventory()
  const location = locations.find(l => l.id === id)
  const count = useCountLocation()

  const [draft, setDraft] = useState<CountDraft>(() => loadDraft(id))
  useEffect(() => { try { localStorage.setItem(draftKey(id), JSON.stringify(draft)) } catch { /* modo privado */ } }, [id, draft])

  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanKey, setScanKey] = useState(0)
  const [creating, setCreating] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<CountLocationResult | null>(null)
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null)
  const lastScan = useRef({ code: '', at: 0 })
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 3000); return () => clearTimeout(t) }, [flash])

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  // Filas: lo ubicado aquí (por nombre) y después lo agregado en este conteo (en el orden en que se agregó).
  const here = useMemo(() => products.filter(p => p.locations.some(l => l.location_id === id)), [products, id])
  const hereIds = useMemo(() => new Set(here.map(p => p.id)), [here])
  const rows = useMemo(() => [
    ...here,
    ...Object.keys(draft).filter(pid => !hereIds.has(pid)).map(pid => byId.get(pid)).filter((p): p is InventoryProduct => !!p),
  ], [here, hereIds, draft, byId])
  const rowIds = useMemo(() => new Set(rows.map(p => p.id)), [rows])

  const plan = useMemo(() => planCount(id, products, draft), [id, products, draft])
  const planById = useMemo(() => new Map(plan.lines.map(l => [l.id, l])), [plan])
  const uncounted = here.filter(p => !planById.has(p.id)).length

  const textScore = useProductMatcher(query)
  const matches = useMemo(() => query.trim().length < 2 ? []
    : rankBy(products.filter(p => !rowIds.has(p.id)), withCode(query, textScore)).slice(0, 8), [products, query, rowIds, textScore])

  // Al agregar un producto, su casilla de cantidad queda lista para escribir.
  useEffect(() => {
    if (!focusId || scanning) return
    const el = inputs.current.get(focusId)
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); setFocusId(null) }
  }, [focusId, rows, scanning])

  const now = () => new Date().toISOString()
  function setQty(pid: string, v: string) {
    setDraft(d => {
      const next = { ...d }
      if (v === '' && hereIds.has(pid)) delete next[pid]        // lo de aquí sin cantidad: no se toca
      else next[pid] = { v, at: now() }                         // lo agregado se queda en la lista aunque esté vacío
      return next
    })
  }
  function toggleRemove(pid: string) {
    setDraft(d => {
      const next = { ...d }
      if (d[pid]?.remove) delete next[pid]; else next[pid] = { v: '', at: now(), remove: true }
      return next
    })
  }
  function drop(pid: string) { setDraft(d => { const next = { ...d }; delete next[pid]; return next }) }
  function addProduct(p: Pick<InventoryProduct, 'id' | 'name'>, focus = true) {
    if (!rowIds.has(p.id)) setDraft(d => ({ ...d, [p.id]: d[p.id] ?? { v: '', at: now() } }))
    if (focus) setFocusId(p.id)
  }

  // Escaneo seguido: cada lectura agrega el producto a la lista (ignora el mismo código por 3 s).
  function onScan(code: string) {
    const t = Date.now()
    if (code === lastScan.current.code && t - lastScan.current.at < 3000) { setScanKey(k => k + 1); return }
    lastScan.current = { code, at: t }
    const p = products.find(x => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase())
    if (!p) { setScanning(false); setCreating(code); return }
    setFlash({ text: rowIds.has(p.id) ? `${p.name} ya está en la lista` : `✓ ${p.name}`, ok: true })
    addProduct(p, false)
    setFocusId(p.id)
    setScanKey(k => k + 1)
  }

  async function save() {
    if (!location) return
    setError('')
    try {
      const r = await count.mutateAsync(countPayload(id, plan, draft, note))
      setDraft({}); setReviewing(false); setResult(r)
    } catch (e) { setError(friendlyLocationError(e)) }
  }

  if (loadingLocs || isLoading) return <p className="p-4 text-stone-500">Cargando…</p>
  if (!location) return <p className="p-4">No existe la ubicación. <Link to="/inventario/ubicaciones" className="text-amber-800 underline">Volver a Ubicaciones</Link></p>
  const back = `/inventario/ubicaciones?ir=${encodeURIComponent(location.code)}`

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-[calc(7rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title={`Contar ${location.code}`} back={back} backLabel="Ubicaciones" />
      <p className="text-sm text-stone-600">
        Escribe cuánto hay de cada producto en este casillero. Agrega lo que falte buscando o escaneando. Al guardar,
        cada producto queda ubicado aquí con esa cantidad y su stock se corrige. Lo que dejes en blanco no se toca.
      </p>

      <div className="sticky top-below-header z-[5] -mx-3 space-y-2 bg-stone-100 px-3 py-2 md:-mx-4 md:px-4">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-stone-400"><Search className="size-5" /></span>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Agregar: buscar…" aria-label="Buscar producto para agregar"
                   className="min-h-11 w-full rounded-lg border bg-white pl-10 pr-3 text-base [&::-webkit-search-cancel-button]:hidden" />
          </div>
          <button onClick={() => setScanning(true)} className="min-h-11 shrink-0 rounded-lg bg-amber-700 px-3 text-sm text-white">
            <ScanBarcode className="mr-1 inline size-5 align-[-0.25em]" />Escanear
          </button>
        </div>
        {matches.length > 0 && (
          <ul className="divide-y rounded-lg border bg-white">
            {matches.map(p => (
              <li key={p.id}>
                <button onClick={() => { addProduct(p); setQuery('') }} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm active:bg-amber-50">
                  <span className="min-w-0 flex-1">{p.name}
                    {p.locations[0] && <span className="ml-1 font-mono text-xs text-stone-500">{p.locations.map(l => l.code).join(', ')}</span>}
                  </span>
                  <span className="text-amber-800">+ Agregar</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {flash && <p role="status" className={`rounded-lg p-2 text-sm ${flash.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{flash.text}</p>}
      </div>

      <ul className="divide-y rounded-lg bg-white shadow">
        {rows.map(p => {
          const isHere = hereIds.has(p.id)
          const e = draft[p.id]
          const line = planById.get(p.id)
          const pl = p.locations.find(l => l.location_id === id)
          const others = p.locations.filter(l => l.location_id !== id)
          const bad = e && !e.remove && Number.isNaN(parseQty(e.v))
          return (
            <li key={p.id} className={`flex items-center gap-2 p-2 ${e?.remove ? 'bg-stone-50 text-stone-400' : ''}`}>
              <ProductImage path={p.image_path} size="xs" className="size-10 shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <div className={`line-clamp-2 text-sm font-medium break-words ${e?.remove ? 'line-through' : ''}`}>{p.name}</div>
                <div className="text-xs text-stone-500">
                  {!isHere && <span className="mr-1 rounded bg-amber-100 px-1 text-amber-900">nuevo aquí</span>}
                  {p.track_stock ? <>stock {fmt(p.stock)} {p.unit}</> : 'servicio'}
                  {pl?.qty != null && ` · aquí ~${fmt(pl.qty)}`}
                  {others.length > 0 && ` · también: ${others.map(l => `${l.code}${l.qty != null ? ` ~${fmt(l.qty)}` : ' (sin contar)'}`).join(', ')}`}
                </div>
                {line && line.diff != null && line.diff !== 0 && (
                  <div className={`text-xs tabular-nums ${line.diff < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    stock → {fmt(line.target!)} ({line.diff > 0 ? '+' : ''}{fmt(line.diff)})
                  </div>
                )}
                {line && line.pending.length > 0 && (
                  <div className="text-xs text-amber-800">El stock no se corrige: falta contar en {line.pending.join(', ')}</div>
                )}
              </div>
              {e?.remove
                ? <span className="text-xs">se quita</span>
                : <input inputMode="decimal" value={e?.v ?? ''} placeholder="—" aria-label={`Cantidad de ${p.name} en ${location.code}`}
                         aria-invalid={bad || undefined}
                         ref={el => { if (el) inputs.current.set(p.id, el); else inputs.current.delete(p.id) }}
                         onChange={ev => setQty(p.id, ev.target.value)}
                         className={`min-h-11 w-20 shrink-0 rounded border px-2 text-right text-base tabular-nums ${bad ? 'border-red-500' : ''}`} />}
              {isHere
                ? <button onClick={() => toggleRemove(p.id)} className="min-h-11 w-16 shrink-0 rounded border px-1 text-xs leading-tight"
                          aria-label={e?.remove ? `Dejar ${p.name} en ${location.code}` : `${p.name} ya no va en ${location.code}`}>
                    {e?.remove ? 'Deshacer' : 'No va aquí'}
                  </button>
                : <button onClick={() => drop(p.id)} aria-label={`Sacar ${p.name} de la lista`} className="grid size-11 shrink-0 place-items-center text-stone-500">✕</button>}
            </li>
          )
        })}
        {!rows.length && <li className="p-6 text-center text-sm text-stone-500">Casillero vacío. Busca o escanea lo que hay en él.</li>}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t bg-white px-safe-3 pt-2 pb-safe-3 shadow">
        <span className="min-w-0 flex-1 text-sm">
          {plan.lines.length} contado{plan.lines.length === 1 ? '' : 's'}
          {uncounted > 0 && <span className="text-stone-500"> · {uncounted} sin contar</span>}
          {plan.invalid.length > 0 && <span className="text-red-600"> · {plan.invalid.length} con cantidad inválida</span>}
        </span>
        {Object.keys(draft).length > 0 && (
          <button onClick={() => { if (confirm('¿Borrar todo lo anotado en este casillero?')) setDraft({}) }} className="min-h-11 rounded-lg border px-3 text-sm">Limpiar</button>
        )}
        <button onClick={() => { setError(''); setReviewing(true) }} disabled={!plan.lines.length || plan.invalid.length > 0}
                className="min-h-11 rounded-lg bg-amber-700 px-4 text-sm text-white disabled:opacity-50">Revisar y guardar</button>
      </div>

      {reviewing && (
        <Sheet onClose={() => setReviewing(false)} label={`Guardar el conteo de ${location.code}`} className="space-y-3 sm:max-w-lg">
          <h2 className="text-lg font-semibold">Conteo de {location.code}</h2>
          <ul className="space-y-1 text-sm">
            {plan.placed > 0 && <li>📍 <b>{plan.placed}</b> producto{plan.placed === 1 ? '' : 's'} quedan ubicados aquí</li>}
            <li>📦 <b>{plan.adjusted}</b> con el stock corregido{plan.lines.length - plan.adjusted - plan.skipped > 0 && `, ${plan.lines.length - plan.adjusted - plan.skipped} ya estaban bien`}</li>
            {plan.removed > 0 && <li>✕ <b>{plan.removed}</b> ya no van aquí</li>}
            {plan.skipped > 0 && <li className="text-amber-800">⚠ <b>{plan.skipped}</b> sin corregir el stock: también están en otra ubicación sin contar</li>}
            {uncounted > 0 && <li className="text-stone-500">{uncounted} de este casillero quedan sin contar (no se tocan)</li>}
          </ul>
          {plan.adjusted > 0 && (
            <ul className="max-h-[35vh] divide-y overflow-y-auto rounded-lg border text-sm">
              {plan.lines.filter(l => l.diff != null && l.diff !== 0).map(l => {
                const p = byId.get(l.id)!
                return (
                  <li key={l.id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-stone-500">{fmt(p.stock)} → <b className="text-stone-900">{fmt(l.target!)}</b></span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-stone-500">
            El stock se corrige contra el que había cuando contaste cada producto: las ventas hechas desde entonces se respetan.
          </p>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={`Motivo (por defecto: Conteo de ${location.code})`}
                 aria-label="Motivo" className="min-h-11 w-full rounded-lg border px-3 text-base" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setReviewing(false)} className="min-h-11 flex-1 rounded-lg border text-sm">Seguir contando</button>
            <button onClick={save} disabled={count.isPending} aria-busy={count.isPending}
                    className="min-h-11 flex-1 rounded-lg bg-amber-700 text-sm text-white disabled:opacity-50">{count.isPending ? 'Guardando…' : 'Guardar conteo'}</button>
          </div>
        </Sheet>
      )}

      {result && (
        <Sheet onClose={() => navigate(back)} label="Conteo guardado" className="space-y-3 sm:max-w-lg">
          <h2 className="text-lg font-semibold">Conteo de {location.code} guardado</h2>
          <p className="text-sm">
            {result.ubicados > 0 && <>{result.ubicados} ubicado{result.ubicados === 1 ? '' : 's'} aquí · </>}
            {result.ajustados} con el stock corregido
            {result.quitados > 0 && <> · {result.quitados} quitado{result.quitados === 1 ? '' : 's'}</>}
          </p>
          {result.sin_ajuste.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              <p className="mb-1">Falta contar estos productos en su otra ubicación para corregir su stock:</p>
              <ul className="space-y-1">
                {result.sin_ajuste.map(s => (
                  <li key={s.product_id}>{s.name}: {s.pendientes.map(code => (
                    <Link key={code} to={`/inventario/ubicaciones?ir=${encodeURIComponent(code)}`} className="mr-1 font-mono underline">{code}</Link>
                  ))}</li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={() => navigate(back)} className="min-h-11 w-full rounded-lg bg-amber-700 text-sm text-white">Volver a Ubicaciones</button>
        </Sheet>
      )}

      {scanning && (
        <BarcodeScanner key={scanKey} title={`Contar ${location.code} (escanea uno tras otro)`} onClose={() => setScanning(false)} onDetected={onScan} />
      )}
      {scanning && flash && (
        <div role="status" className={`pointer-events-none fixed inset-x-3 top-[calc(var(--header-h)+1.25rem+env(safe-area-inset-top))] z-[70] rounded-lg px-4 py-2 text-center text-sm text-white shadow-lg
                                        ${flash.ok ? 'bg-green-700' : 'bg-red-700'}`}>{flash.text}</div>
      )}
      {creating && (
        <QuickCreateSheet initialBarcode={creating} onClose={() => setCreating(null)}
                          onCreated={p => { setCreating(null); addProduct(p) }} />
      )}
    </div>
  )
}
