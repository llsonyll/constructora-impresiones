import { useParams, useSearchParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { money, round2 } from '@/lib/format'
import { useInventory } from '@/features/inventory/api'
import { useBusinessInfo, type BusinessInfo } from '@/features/documents/api'
import { poLabel, type Provider, type PurchaseOrder, usePurchaseOrder, useProviderList } from './api'

type Mode = 'solicitud' | 'orden'
// "Solicitud de precios", no "de cotización": en la app, cotización es la de venta a un cliente (Documentos).
const MODE_LABEL: Record<Mode, string> = { solicitud: 'Solicitud de precios', orden: 'Orden de compra' }

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
const fmtQty = (n: number) => String(Number(n.toFixed(3)))
/** Costo unitario: 2 decimales, o hasta 4 si los tiene (S/ 0.3213 el metro de un rollo de S/ 98). */
const unitCost = (c: number) => (Math.round(c * 100) / 100 === c ? money(c) : `S/ ${Number(c.toFixed(4))}`)

/**
 * La orden de compra lista para imprimir o guardar como PDF (desde el diálogo de impresión, como en Documentos).
 * Dos formatos: *Solicitud de precios* (sin precios, columnas en blanco para que el proveedor los complete) y
 * *Orden de compra* (con los costos de la orden). Sin datos internos: ni SKU, ni stock, ni precios de venta.
 */
export default function PurchaseOrderPdfPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { data: order, isLoading, error } = usePurchaseOrder(id)
  const { data: products = [] } = useInventory()
  const { data: providers = [] } = useProviderList()
  const { data: biz } = useBusinessInfo()

  if (isLoading) return <p className="p-6 text-stone-500">Cargando…</p>
  if (error || !order) return <p className="p-6 text-red-600">No se pudo abrir la orden{error ? `: ${(error as Error).message}` : ''}.</p>

  const anyMissing = order.items.some(i => i.unit_cost == null)
  const anyPriced = order.items.some(i => i.unit_cost != null)
  // Por defecto según el estado: esperando precios → solicitud; si no, con precios si la orden tiene alguno
  // (los que faltan salen en blanco) y sin precios solo si no tiene ninguno.
  const raw = params.get('modo')
  const mode: Mode = raw === 'solicitud' || raw === 'orden' ? raw
    : order.status === 'solicitada' || !anyPriced ? 'solicitud' : 'orden'
  const withNote = params.get('nota') === '1'
  const set = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n }, { replace: true })
  const provider = providers.find(p => p.id === order.provider_id)
  const byId = new Map(products.map(p => [p.id, p]))
  const lines = order.items.map(i => {
    const p = byId.get(i.product_id)
    return { name: p?.name ?? 'Producto', unit: p?.unit ?? '', qty: i.qty, cost: i.unit_cost }
  })

  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-4 print:max-w-none print:p-0">
      <div className="space-y-3 print:hidden">
        <PageHeader title={`PDF · ${poLabel(order.number)}`} back={`/proveedores/ordenes/${order.id}`} backLabel="la orden" />
        <div className="flex flex-wrap items-center gap-2">
          {(['solicitud', 'orden'] as Mode[]).map(m => (
            <button key={m} onClick={() => set('modo', m)} className={chip(mode === m)}>{MODE_LABEL[m]}</button>
          ))}
          <label className="flex min-h-11 items-center gap-2 px-1 text-sm">
            <input type="checkbox" className="size-5" checked={withNote} onChange={e => set('nota', e.target.checked ? '1' : null)} />
            Incluir la nota de la orden
          </label>
          <button onClick={() => window.print()}
                  className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-700 px-4 text-sm font-medium text-white">
            <Printer className="size-4" />Imprimir / PDF
          </button>
        </div>
        <p className="text-xs text-stone-500">
          {mode === 'solicitud'
            ? 'Sin precios: el proveedor llena precio unitario y total. Para enviar antes de comprar.'
            : `Con los costos de la orden${anyMissing ? '; los que no tienen costo salen en blanco' : ''}.`}
          {' '}En el diálogo de impresión elige «Guardar como PDF».
        </p>
      </div>

      <PoSheet order={order} mode={mode} biz={biz} provider={provider} lines={lines} note={withNote ? order.note : null} />
    </div>
  )
}

export interface SheetLine { name: string; unit: string; qty: number; cost: number | null }

/** La hoja A4: lo que se imprime y se ve en pantalla. */
export function PoSheet({ order, mode, biz, provider, lines, note }: {
  order: PurchaseOrder; mode: Mode; biz?: BusinessInfo; provider?: Provider; lines: SheetLine[]; note: string | null
}) {
  const priced = mode === 'orden'
  const sub = (l: SheetLine) => (l.cost == null ? null : round2(l.qty * l.cost))
  const subtotal = round2(lines.reduce((s, l) => s + (sub(l) ?? 0), 0))
  const total = order.costs_include_igv ? subtotal : round2(subtotal * 1.18)
  const missing = lines.filter(l => l.cost == null).length
  const date = (priced ? order.ordered_at : order.quote_requested_at) ?? order.created_at
  const dense = lines.length > 26   // listas largas: letra y renglones menores al imprimir, para que quepan en una hoja
  const td = dense ? 'py-1 print:py-px' : 'py-1.5'

  return (
    <article className={`space-y-4 rounded-lg bg-white p-4 text-sm shadow sm:p-6 print:rounded-none print:p-0 print:shadow-none ${dense ? 'print:space-y-2 print:text-[10.5px] print:leading-tight' : ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <div className="text-xl font-bold">{biz?.name ?? 'La Constructora'}</div>
          {biz?.ruc && <div>RUC {biz.ruc}</div>}
          {biz?.address && <div className="text-stone-600">{biz.address}</div>}
          {biz?.phone && <div className="text-stone-600">Tel. {biz.phone}</div>}
        </div>
        <div className="rounded-lg border-2 border-stone-800 px-4 py-2 text-center">
          <div className="font-semibold uppercase">{MODE_LABEL[mode]}</div>
          <div className="font-mono text-base">{poLabel(order.number)}</div>
          <div className="text-xs text-stone-600">{longDate(date)}</div>
        </div>
      </header>

      <div>
        <div><span className="text-stone-500">Proveedor: </span><strong>{provider?.name ?? '—'}</strong>{provider?.ruc && <> · RUC {provider.ruc}</>}</div>
        {provider?.contact && <div><span className="text-stone-500">Atención: </span>{provider.contact}</div>}
        <p className="mt-2">
          {priced
            ? 'Por medio de la presente confirmamos el siguiente pedido:'
            : 'Por medio de la presente le solicitamos sus precios para los siguientes productos:'}
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y bg-stone-50 text-left text-xs uppercase text-stone-600 print:bg-transparent">
            <th className="py-1.5 pr-2 font-medium">N.°</th>
            <th className="py-1.5 pr-2 font-medium">Descripción</th>
            <th className="py-1.5 pr-2 text-right font-medium">Cantidad</th>
            <th className="w-20 py-1.5 pr-2 text-right font-medium">P. unit.</th>
            <th className="w-24 py-1.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, n) => {
            const s = sub(l)
            return (
              <tr key={n} className="border-b align-top">
                <td className={`${td} pr-2 tabular-nums text-stone-500`}>{n + 1}</td>
                <td className={`${td} pr-2`}>{l.name}</td>
                <td className={`${td} whitespace-nowrap pr-2 text-right tabular-nums`}>
                  {fmtQty(l.qty)} <span className="text-stone-500">{l.unit}</span>
                </td>
                <td className={`${td} whitespace-nowrap pr-2 text-right tabular-nums`}>{priced && l.cost != null ? unitCost(l.cost) : ''}</td>
                <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{priced && s != null ? money(s) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {priced && (
        <dl className="ml-auto w-full max-w-72 space-y-0.5">
          {!order.costs_include_igv && <>
            <div className="flex justify-between text-stone-600"><dt>Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
            <div className="flex justify-between text-stone-600"><dt>IGV (18%)</dt><dd className="tabular-nums">{money(round2(total - subtotal))}</dd></div>
          </>}
          <div className={`flex justify-between text-base font-semibold ${order.costs_include_igv ? '' : 'border-t pt-1'}`}>
            <dt>Total{order.costs_include_igv ? ' (incluye IGV)' : ''}</dt><dd className="tabular-nums">{money(total)}</dd>
          </div>
          {missing > 0 && <div className="text-right text-xs text-stone-500">{missing} producto{missing > 1 ? 's' : ''} sin precio, no suma{missing > 1 ? 'n' : ''}</div>}
        </dl>
      )}

      <footer className="space-y-1 border-t pt-3 text-xs text-stone-600">
        {priced
          ? <p>Precios en soles{order.costs_include_igv ? ', incluyen IGV' : ', sin IGV'}.</p>
          : <p>Agradeceremos indicar precio unitario, disponibilidad y presentación (caja, paquete, rollo) de cada producto.</p>}
        {note && <p className="whitespace-pre-line">{note}</p>}
      </footer>

      <div className={`grid grid-cols-2 gap-10 text-xs text-stone-600 print:break-inside-avoid ${dense ? 'pt-10 print:pt-6' : 'pt-10'}`}>
        <div className="border-t border-stone-500 pt-1">Solicitado por<br />{biz?.name ?? 'La Constructora'}</div>
        <div className="border-t border-stone-500 pt-1">Recibido / conforme<br />{provider?.name ?? ''}</div>
      </div>
    </article>
  )
}
