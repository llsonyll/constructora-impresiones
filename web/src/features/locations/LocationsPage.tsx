import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, ScanBarcode } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '@/components/PageHeader'
import BarcodeScanner from '@/components/BarcodeScanner'
import Sheet from '@/components/Sheet'
import { type InventoryProduct, useInventory } from '@/features/inventory/api'
import QuickCreateSheet from '@/features/inventory/QuickCreateSheet'
import type { Location } from '@/types/domain'
import { friendlyLocationError, normalizeCode, useLocations, useProductLocation } from './api'
import LocationForm from './LocationForm'

/**
 * Ubicaciones por mueble: cuadrícula con cuántos productos hay en cada casillero. Al tocar uno se ven sus
 * productos y se pueden meter más escaneando uno tras otro (carga inicial: pararse frente a la repisa y escanear).
 */
export default function LocationsPage() {
  const { data: locations = [], isLoading } = useLocations()
  const { data: products = [] } = useInventory()
  const [showInactive, setShowInactive] = useState(false)
  const [furniture, setFurniture] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [form, setForm] = useState<Location | 'new' | null>(null)
  const [jump, setJump] = useState('')
  const [jumpError, setJumpError] = useState('')

  // Productos por ubicación (de la lista de inventario: un solo origen de datos, se refresca al asignar).
  const byLocation = useMemo(() => {
    const m = new Map<number, InventoryProduct[]>()
    for (const p of products) for (const l of p.locations) m.set(l.location_id, [...(m.get(l.location_id) ?? []), p])
    return m
  }, [products])
  const unplaced = products.filter(p => p.track_stock && !p.locations.length).length

  const visible = locations.filter(l => showInactive || l.active)
  const furnitures = [...new Set(visible.map(l => l.furniture))]
  const current = furniture && furnitures.includes(furniture) ? furniture : furnitures[0] ?? null
  const inFurniture = visible.filter(l => l.furniture === current)
  const bodies = [...new Set(inFurniture.map(l => l.body))]
  const sel = locations.find(l => l.id === selected) ?? null
  // Al saltar a un mueble (Ir a…, recién creado) su botón queda a la vista en la fila desplazable.
  useEffect(() => {
    document.querySelector(`[data-furniture="${current}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [current])

  function onJump(e: React.FormEvent) {
    e.preventDefault()
    const code = normalizeCode(jump.trim())
    const hit = locations.find(l => l.code === code)
    if (!hit) { setJumpError(`No existe la ubicación ${code}`); return }
    setJumpError(''); setJump(''); setFurniture(hit.furniture); setSelected(hit.id)
    if (!hit.active) setShowInactive(true)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title="Ubicaciones" back="/inventario" backLabel="Inventario">
        <button onClick={() => setForm('new')} className="min-h-11 rounded-lg bg-amber-700 px-3 text-sm text-white">+ Ubicación</button>
      </PageHeader>

      <form onSubmit={onJump} className="flex gap-2">
        <input value={jump} onChange={e => { setJump(e.target.value); setJumpError('') }} placeholder="Ir a… (p. ej. E2-N5)"
               aria-label="Ir a ubicación" autoCapitalize="characters" className="min-h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 text-base" />
        <button className="min-h-11 rounded-lg border bg-white px-4 text-sm">Ir</button>
      </form>
      {jumpError && <p className="text-sm text-red-600">{jumpError}</p>}

      {unplaced > 0 && (
        <Link to="/inventario?estado=sin_ubicacion" className="flex min-h-11 items-center justify-between rounded-lg bg-amber-50 px-3 text-sm text-amber-900">
          <span><b>{unplaced}</b> productos sin ubicación</span><span>Ver →</span>
        </Link>
      )}

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {furnitures.map(f => (
          <button key={f} data-furniture={f} onClick={() => setFurniture(f)} aria-pressed={current === f}
                  className={`min-h-11 min-w-14 shrink-0 rounded-full border px-4 text-sm font-medium ${current === f ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`}>
            {f}
          </button>
        ))}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" className="size-5" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Ver inactivas
      </label>

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {!isLoading && !locations.length && <p className="rounded-lg bg-white p-6 text-center text-stone-500">No hay ubicaciones.</p>}

      {bodies.map(body => (
        <FurnitureGrid key={body ?? '-'} title={body ? `${current}-${body}` : current!} locations={inFurniture.filter(l => l.body === body)}
                       counts={byLocation} selected={selected} onSelect={setSelected} />
      ))}
      <p className="text-xs text-stone-500">N1 es la repisa más alta; las secciones van de izquierda a derecha. El número es la cantidad de productos.</p>

      {sel && !form && (
        <LocationSheet location={sel} products={byLocation.get(sel.id) ?? []} allProducts={products}
                       onEdit={() => setForm(sel)} onClose={() => setSelected(null)} />
      )}
      {form && (
        <LocationForm location={form === 'new' ? null : form} defaultFurniture={current ?? 'E0'}
                      productCount={form === 'new' ? 0 : byLocation.get(form.id)?.length ?? 0}
                      onClose={() => setForm(null)}
                      onSaved={(id, f) => { setForm(null); setFurniture(f); setSelected(id) }}
                      onDeleted={() => { setForm(null); setSelected(null) }} />
      )}
    </div>
  )
}

/** Un mueble (o cuerpo): una fila por nivel, de arriba (N1) hacia abajo; los niveles divididos muestran sus secciones. */
function FurnitureGrid({ title, locations, counts, selected, onSelect }: {
  title: string; locations: Location[]; counts: Map<number, InventoryProduct[]>; selected: number | null; onSelect: (id: number) => void
}) {
  const levels = [...new Set(locations.map(l => l.level))].sort((a, b) => a - b)
  return (
    <section className="rounded-lg bg-white p-2 shadow">
      <h2 className="mb-1 px-1 text-sm font-semibold">{title}</h2>
      <div className="space-y-1">
        {levels.map(level => {
          const row = locations.filter(l => l.level === level)
          return (
            <div key={level} className="flex items-stretch gap-1">
              <span className="grid w-8 shrink-0 place-items-center text-xs text-stone-500">N{level}</span>
              <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                {row.map(l => {
                  const n = counts.get(l.id)?.length ?? 0
                  return (
                    <button key={l.id} onClick={() => onSelect(l.id)} aria-label={`${l.code}: ${n} productos`} title={l.description ?? l.code}
                            className={`flex min-h-11 flex-col items-center justify-center rounded border text-xs leading-tight
                                        ${selected === l.id ? 'border-amber-700 ring-2 ring-amber-600' : ''}
                                        ${!l.active ? 'border-dashed text-stone-400' : n ? 'bg-amber-100 text-amber-900' : 'bg-stone-50 text-stone-500'}`}>
                      {l.slot && <span className="font-medium">{l.slot}</span>}
                      <span className="tabular-nums">{l.slot ? n || '·' : n ? `${n} producto${n === 1 ? '' : 's'}` : 'vacío'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Detalle de una ubicación: sus productos y agregar más buscando o escaneando seguido. */
function LocationSheet({ location, products, allProducts, onEdit, onClose }: {
  location: Location; products: InventoryProduct[]; allProducts: InventoryProduct[]; onEdit: () => void; onClose: () => void
}) {
  const mut = useProductLocation()
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanKey, setScanKey] = useState(0)
  const [creating, setCreating] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null)
  const lastScan = useRef({ code: '', at: 0 })
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 3000); return () => clearTimeout(t) }, [flash])

  const here = new Set(products.map(p => p.id))
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return allProducts.filter(p => !here.has(p.id) && (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      || (p.brand?.toLowerCase().includes(q) ?? false) || p.barcode === q)).slice(0, 8)
  }, [allProducts, query, here])

  async function add(p: Pick<InventoryProduct, 'id' | 'name'>) {
    try {
      await mut.mutateAsync({ op: 'add', productId: p.id, locationId: location.id })
      setFlash({ text: `✓ ${p.name} → ${location.code}`, ok: true })
    } catch (e) { setFlash({ text: friendlyLocationError(e), ok: false }) }
  }

  // Escaneo seguido: cada lectura agrega y el escáner se vuelve a abrir (ignora el mismo código por 3 s).
  function onScan(code: string) {
    const now = Date.now()
    if (code === lastScan.current.code && now - lastScan.current.at < 3000) { setScanKey(k => k + 1); return }
    lastScan.current = { code, at: now }
    const p = allProducts.find(x => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase())
    if (!p) { setScanning(false); setCreating(code); return }
    if (here.has(p.id)) setFlash({ text: `${p.name} ya estaba en ${location.code}`, ok: true })
    else void add(p)
    setScanKey(k => k + 1)
  }

  return (
    <>
      <Sheet onClose={onClose} label={`Ubicación ${location.code}`} hidden={scanning || !!creating} className="space-y-3 sm:max-w-lg">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-mono text-xl font-semibold">{location.code}</h2>
            <p className="text-xs text-stone-500">
              {location.description ?? 'Sin descripción'}{!location.active && <span className="ml-1 rounded bg-stone-200 px-1">inactiva</span>}
            </p>
          </div>
          <button onClick={onEdit} className="min-h-11 rounded-lg border px-3 text-sm">Editar</button>
        </div>

        <div className="flex gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Agregar producto: buscar…" aria-label="Buscar producto para agregar"
                 className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-base" />
          <button onClick={() => setScanning(true)} className="min-h-11 shrink-0 rounded-lg bg-amber-700 px-3 text-sm text-white"><ScanBarcode className="mr-1 inline size-5 align-[-0.25em]" />Escanear</button>
        </div>
        {matches.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {matches.map(p => (
              <li key={p.id}>
                <button onClick={() => { void add(p); setQuery('') }} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm active:bg-amber-50">
                  <span className="min-w-0 flex-1">{p.name}
                    {p.locations[0] && <span className="ml-1 font-mono text-xs text-stone-500"><MapPin className="inline size-3.5 align-[-0.15em]" />{p.locations[0].code}</span>}
                  </span>
                  <span className="text-amber-800">+ Agregar</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {flash && <p role="status" className={`rounded-lg p-2 text-sm ${flash.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{flash.text}</p>}

        <div>
          <div className="mb-1 text-xs text-stone-500">{products.length} producto{products.length === 1 ? '' : 's'} aquí</div>
          <ul className="max-h-[45vh] divide-y overflow-y-auto rounded-lg border">
            {products.map(p => {
              const pl = p.locations.find(l => l.location_id === location.id)!
              return (
                <li key={p.id} className="flex items-center gap-2 pl-3">
                  <div className="min-w-0 flex-1 py-1.5">
                    <div className="line-clamp-2 text-sm">{p.name}</div>
                    <div className="text-xs text-stone-500">
                      stock {p.stock} {p.unit}{pl.qty != null && ` · aquí ~${pl.qty}`}
                      {pl.is_primary ? ' · ★ principal' : ` · principal: ${p.locations.find(l => l.is_primary)?.code ?? '—'}`}
                    </div>
                  </div>
                  <button onClick={() => mut.mutate({ op: 'remove', productId: p.id, locationId: location.id })}
                          aria-label={`Quitar ${p.name} de ${location.code}`} className="grid size-11 shrink-0 place-items-center text-stone-500">✕</button>
                </li>
              )
            })}
            {!products.length && <li className="p-4 text-center text-sm text-stone-500">Vacía. Escanea o busca productos para agregarlos.</li>}
          </ul>
        </div>
      </Sheet>

      {scanning && (
        <BarcodeScanner key={scanKey} title={`Agregar a ${location.code} (escanea uno tras otro)`}
                        onClose={() => setScanning(false)} onDetected={onScan} />
      )}
      {scanning && flash && (
        <div role="status" className={`pointer-events-none fixed inset-x-3 top-[calc(var(--header-h)+1.25rem+env(safe-area-inset-top))] z-[70] rounded-lg px-4 py-2 text-center text-sm text-white shadow-lg
                                        ${flash.ok ? 'bg-green-700' : 'bg-red-700'}`}>{flash.text}</div>
      )}
      {creating && (
        <QuickCreateSheet initialBarcode={creating} onClose={() => setCreating(null)}
                          onCreated={p => { setCreating(null); void add(p) }} />
      )}
    </>
  )
}
