import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { rankBy, withCode } from '@/lib/search'
import { useProductMatcher } from '@/hooks/use-product-search'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { MapPin } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { localDb } from '@/db/local'
import { useCarts } from '@/features/pos/useCart'
import { igvBreakdown, money, round2 } from '@/lib/format'
import type { Caja, CartLine, Presentation, Product } from '@/types/domain'
import { presentationLabel } from '@/features/pos/PresentationPicker'
import { docNumber, friendlyDocError, lineTotal, useDocument, useSaveQuote, type DocItem } from './api'

type Line = DocItem & { key: string }

/** Llega desde el ticket del POS ("Cotizar"): sus líneas (con la unidad) y la caja, para vaciar ese ticket al guardar. */
export interface QuoteFromTicket { lines: (Omit<CartLine, 'key'> & { unit: string })[]; caja: Caja }

const VALIDITY = [3, 7, 15, 30]
const input = 'min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-base'
const num = (s: string) => Number(s.replace(',', '.'))

/** Crear o editar una cotización: cliente, productos del catálogo (o ítems libres) con precio editable y vigencia. */
export default function QuoteEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const fromTicket = (useLocation().state as { fromTicket?: QuoteFromTicket } | null)?.fromTicket
  const carts = useCarts()
  const existing = useDocument(id)
  const save = useSaveQuote()
  const products = useLiveQuery(() => localDb.products.toArray(), [], [] as Product[])

  const [name, setName] = useState('')
  const [docNum, setDocNum] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [days, setDays] = useState(7)
  const [lines, setLines] = useState<Line[]>(() => fromTicket?.lines.map(l => ({ ...l, key: crypto.randomUUID() })) ?? [])
  const [ready, setReady] = useState(!id)
  const [dirty, setDirty] = useState(!!fromTicket)
  const [query, setQuery] = useState('')
  const [freeDesc, setFreeDesc] = useState('')
  const [freePrice, setFreePrice] = useState('')
  const [error, setError] = useState('')

  // Al editar: se carga la cotización una sola vez (después manda lo que se escribe).
  useEffect(() => {
    if (ready || !existing.data) return
    const d = existing.data
    setName(d.customer_name ?? ''); setDocNum(d.customer_doc ?? ''); setPhone(d.payload.phone ?? ''); setNote(d.payload.note ?? '')
    setDays(d.payload.valid_days ?? 7)
    setLines(d.payload.items.map(i => ({ ...i, key: crypto.randomUUID() })))
    setReady(true)
  }, [existing.data, ready])

  const total = round2(lines.reduce((s, l) => s + lineTotal(l), 0))
  const textScore = useProductMatcher(query)
  const matches = useMemo(() => {
    if (query.trim().length < 2) return []
    return rankBy(products.filter(p => p.active), withCode(query, textScore)).slice(0, 8)
  }, [products, query, textScore])

  const edit = (fn: (ls: Line[]) => Line[]) => { setLines(fn); setDirty(true) }
  /** Por unidad o por una presentación (docena, ciento…: la línea lleva su factor y va sin unidad aparte). */
  function addProduct(p: Product, pr?: Presentation) {
    const line = pr
      ? { product_id: p.id, description: presentationLabel(p, pr), unit: '', unit_price: pr.price, factor: pr.qty }
      : { product_id: p.id, description: p.name, unit: p.unit, unit_price: p.price, factor: 1 }
    edit(ls => {
      const same = ls.find(l => l.product_id === p.id && l.unit_price === line.unit_price && (l.factor ?? 1) === line.factor)
      return same ? ls.map(l => l === same ? { ...l, qty: l.qty + 1 } : l) : [...ls, { key: crypto.randomUUID(), qty: 1, ...line }]
    })
    setQuery('')
  }
  function addFree(e: FormEvent) {
    e.preventDefault()
    const price = num(freePrice)
    if (!freeDesc.trim() || !(price >= 0)) return
    edit(ls => [...ls, { key: crypto.randomUUID(), product_id: null, description: freeDesc.trim(), unit: 'und', qty: 1, unit_price: round2(price) }])
    setFreeDesc(''); setFreePrice('')
  }
  const setLine = (key: string, patch: Partial<Line>) => edit(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))

  const valid = lines.length > 0 && lines.every(l => l.description.trim() && l.qty > 0 && l.unit_price >= 0)

  async function onSave() {
    if (!valid) return
    setError('')
    try {
      const d = await save.mutateAsync({ id, customer_name: name, customer_doc: docNum, phone, note, valid_days: days,
        items: lines.map(({ key: _k, ...l }) => l) })
      // El ticket del POS ya quedó guardado como cotización: se libera para el siguiente cliente.
      if (fromTicket) carts[fromTicket.caja].dispatch({ type: 'clear' })
      setDirty(false)
      navigate(`/documentos/${d.id}`, { replace: true })
    } catch (e) { setError(friendlyDocError(e)) }
  }

  const back = () => { if (!dirty || confirm('¿Salir sin guardar la cotización?')) navigate(id ? `/documentos/${id}` : fromTicket ? '/ventas' : '/documentos') }
  const title = id ? (existing.data ? `Editar ${docNumber(existing.data)}` : 'Editar cotización') : 'Nueva cotización'
  const locked = existing.data && (existing.data.sale_id || existing.data.voided_at)

  if (id && existing.error) return <p className="p-6 text-red-600">No se pudo abrir la cotización: {friendlyDocError(existing.error)}</p>
  if (locked) return <p className="p-6 text-stone-600">Esta cotización ya se vendió o está anulada: no se puede editar.</p>

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-[calc(7rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title={title} back={back} backLabel={fromTicket ? 'Ventas' : 'Documentos'} />
      {!ready && <p className="text-stone-500">Cargando…</p>}
      {fromTicket && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Con los productos del ticket. Al guardar, el ticket se vacía para atender a otro cliente.</p>}

      <section className="grid gap-2 rounded-lg bg-white p-3 shadow sm:grid-cols-2">
        <label className="text-xs text-stone-500 sm:col-span-2">Cliente (nombre o razón social)
          <input className={`${input} mt-1`} value={name} onChange={e => { setName(e.target.value); setDirty(true) }} placeholder="Opcional" />
        </label>
        <label className="text-xs text-stone-500">DNI / RUC
          <input className={`${input} mt-1`} inputMode="numeric" value={docNum} onChange={e => { setDocNum(e.target.value); setDirty(true) }} />
        </label>
        <label className="text-xs text-stone-500">Celular (para enviar por WhatsApp)
          <input className={`${input} mt-1`} inputMode="tel" value={phone} onChange={e => { setPhone(e.target.value); setDirty(true) }} />
        </label>
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 shadow">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Agregar producto: buscar por nombre, código o marca…"
               aria-label="Buscar producto" className={input} />
        {matches.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {matches.map(p => (
              <li key={p.id}>
                <button onClick={() => addProduct(p)} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm active:bg-amber-50">
                  <span className="min-w-0 flex-1">{p.name}
                    {p.locations?.[0] && <span className="ml-1 font-mono text-xs text-stone-500"><MapPin className="inline size-3.5 align-[-0.15em]" />{p.locations[0]}</span>}
                    <span className="block text-xs text-stone-500">{p.track_stock ? `stock ${p.stock} ${p.unit}` : `por ${p.unit}`}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{money(p.price)}</span>
                  <span className="shrink-0 text-amber-800">+</span>
                </button>
                {!!p.presentations?.length && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    {p.presentations.map(pr => (
                      <button key={pr.name} onClick={() => addProduct(p, pr)} className="min-h-11 rounded-full border px-3 text-sm active:bg-amber-50">
                        + {pr.name} <span className="text-xs text-stone-500">({pr.qty} {p.unit})</span> <span className="tabular-nums">{money(pr.price)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && !matches.length && <p className="text-sm text-stone-500">No está en el catálogo: agrégalo como ítem libre abajo.</p>}

        <ul className="divide-y">
          {lines.map(l => (
            <li key={l.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 py-2 text-sm sm:grid-cols-[1fr_5rem_6rem_5.5rem_auto]">
              {l.product_id
                ? <span className="min-w-0 break-words">{l.description}</span>
                : <input value={l.description} onChange={e => setLine(l.key, { description: e.target.value })} aria-label="Descripción"
                         className="min-h-11 min-w-0 rounded border px-2 text-base sm:text-sm" />}
              <button onClick={() => edit(ls => ls.filter(x => x.key !== l.key))} aria-label={`Quitar ${l.description}`}
                      className="grid size-11 place-items-center text-stone-500 sm:order-last">✕</button>
              <div className="col-span-2 flex items-center gap-2 sm:col-span-3 sm:contents">
                <label className="flex items-center gap-1 text-xs text-stone-500 sm:block">
                  <span className="sm:sr-only">Cant.</span>
                  <input type="number" min={0} step="any" inputMode="decimal" value={l.qty} aria-label={`Cantidad de ${l.description}`}
                         onChange={e => setLine(l.key, { qty: Number(e.target.value) })}
                         className="min-h-11 w-20 rounded border px-2 text-right text-base text-stone-900 sm:w-full sm:text-sm" />
                </label>
                <label className="flex items-center gap-1 text-xs text-stone-500 sm:block">
                  <span className="sm:sr-only">P. unit.</span>
                  {/* No controlado: al escribir "2." un input controlado volvería a "2". */}
                  <input defaultValue={l.unit_price} inputMode="decimal" aria-label={`Precio unitario de ${l.description}`}
                         onChange={e => { const v = num(e.target.value); if (v >= 0) setLine(l.key, { unit_price: round2(v) }) }}
                         className="min-h-11 w-24 rounded border px-2 text-right text-base text-stone-900 sm:w-full sm:text-sm" />
                </label>
                <span className="ml-auto text-right font-medium tabular-nums">{money(lineTotal(l))}</span>
              </div>
            </li>
          ))}
          {ready && !lines.length && <li className="py-4 text-center text-sm text-stone-500">Busca productos para agregarlos.</li>}
        </ul>

        <form onSubmit={addFree} className="flex gap-1">
          <input value={freeDesc} onChange={e => setFreeDesc(e.target.value)} placeholder="Ítem libre (flete, servicio…)" className="min-h-11 min-w-0 flex-1 rounded border px-2 text-base md:text-sm" />
          <input value={freePrice} onChange={e => setFreePrice(e.target.value)} placeholder="S/" inputMode="decimal" className="min-h-11 w-20 rounded border px-2 text-base md:text-sm" />
          <button className="min-w-11 rounded border px-3 text-sm" aria-label="Agregar ítem libre">+</button>
        </form>
      </section>

      <section className="grid gap-2 rounded-lg bg-white p-3 shadow sm:grid-cols-2">
        <label className="text-xs text-stone-500">Válida por
          <select className={`${input} mt-1`} value={days} onChange={e => { setDays(Number(e.target.value)); setDirty(true) }}>
            {[...new Set([...VALIDITY, days])].sort((a, b) => a - b).map(d => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500">Nota (opcional)
          <input className={`${input} mt-1`} value={note} onChange={e => { setNote(e.target.value); setDirty(true) }} placeholder="Entrega, forma de pago…" />
        </label>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="fixed inset-x-3 bottom-safe-3 z-20 flex items-center gap-3 rounded-xl bg-white p-3 shadow-lg ring-1 ring-stone-200 md:static md:inset-auto md:shadow">
        <div className="min-w-0 flex-1 text-sm">
          <div className="text-lg font-semibold tabular-nums">{money(total)}</div>
          <div className="text-xs text-stone-500">Incluye IGV {money(igvBreakdown(total).igv)} · {lines.length} ítem{lines.length === 1 ? '' : 's'}</div>
        </div>
        <button onClick={onSave} disabled={!valid || save.isPending || !ready}
                className="min-h-12 rounded-lg bg-amber-700 px-5 font-medium text-white disabled:opacity-40">
          {save.isPending ? 'Guardando…' : 'Guardar cotización'}
        </button>
      </div>
    </div>
  )
}
