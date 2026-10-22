import { useNavigate, useParams } from 'react-router-dom'
import { MessageCircle, Pencil, Printer, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '@/components/PageHeader'
import { localDb } from '@/db/local'
import { useAuth } from '@/features/auth/AuthProvider'
import { PAYMENT_LABEL } from '@/features/sales/api'
import { useCarts } from '@/features/pos/useCart'
import { CAJA_LABEL, cajaOf, saveCajaPref } from '@/lib/caja'
import { igvBreakdown, money } from '@/lib/format'
import type { Caja } from '@/types/domain'
import {
  DOC_LABEL, STATUS_STYLE, dateLabel, docNumber, docStatus, friendlyDocError, lineTotal, shareText, useBusinessInfo,
  useDocument, useVoidDocument, whatsappUrl, type BusinessInfo, type Doc,
} from './api'

/** Un documento listo para imprimir (o guardar como PDF desde el diálogo de impresión) y compartir por WhatsApp. */
export default function DocumentPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: doc, isLoading, error } = useDocument(id)
  const { data: biz } = useBusinessInfo()
  const voidDoc = useVoidDocument()
  const carts = useCarts()

  if (isLoading) return <p className="p-6 text-stone-500">Cargando…</p>
  if (error || !doc) return <p className="p-6 text-red-600">No se pudo abrir el documento{error ? `: ${friendlyDocError(error)}` : ''}.</p>

  const status = docStatus(doc)
  const isQuote = doc.type === 'cotizacion'
  const open = isQuote && (status === 'vigente' || status === 'vencida')
  const canVoid = status !== 'anulada' && status !== 'vendida' && (profile?.role === 'admin' || isQuote)

  /** Carga la cotización en el ticket de su caja (con los precios cotizados) y abre Ventas. */
  async function toSale(d: Doc) {
    if (status === 'vencida' && !confirm(`La cotización venció el ${dateLabel(d.valid_until!)}. ¿Cobrar con los precios cotizados?`)) return
    const [prods, cats] = await Promise.all([localDb.products.toArray(), localDb.categories.toArray()])
    const byId = new Map(prods.map(p => [p.id, p])), catMap = new Map(cats.map(c => [c.id, c]))
    const groups = new Map<Caja, Doc['payload']['items']>()
    for (const i of d.payload.items) {
      const p = i.product_id ? byId.get(i.product_id) : undefined
      const caja = p ? cajaOf(p, catMap) : 'ferreteria'
      groups.set(caja, [...(groups.get(caja) ?? []), i])
    }
    const busy = [...groups.keys()].filter(c => carts[c].lines.length)
    if (busy.length && !confirm(`El ticket de ${busy.map(c => CAJA_LABEL[c]).join(' y ')} ya tiene productos. ¿Agregar la cotización a lo que hay?`)) return
    for (const [caja, items] of groups) {
      for (const i of items) {
        if (i.product_id) carts[caja].dispatch({ type: 'addLine', product_id: i.product_id, description: i.description, qty: i.qty, unit_price: i.unit_price })
        else carts[caja].dispatch({ type: 'addCustom', description: i.description, qty: i.qty, unit_price: i.unit_price })
      }
      carts[caja].setQuote({ id: d.id, label: docNumber(d), customer_name: d.customer_name, customer_doc: d.customer_doc })
    }
    const first = [...groups.keys()][0] ?? 'ferreteria'
    saveCajaPref(first)
    if (groups.size > 1) toast.warning('La cotización tiene productos de las dos cajas: se cargó un ticket en cada una.', { id: 'pos' })
    navigate('/ventas')
  }

  async function onVoid() {
    if (!confirm(`¿Anular ${DOC_LABEL[doc!.type].toLowerCase()} ${docNumber(doc!)}?`)) return
    try { await voidDoc.mutateAsync(doc!.id); toast.success('Documento anulado') } catch (e) { toast.error(friendlyDocError(e)) }
  }

  const btn = 'flex min-h-11 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm'
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-4 print:max-w-none print:p-0">
      <div className="space-y-3 print:hidden">
        <PageHeader title={docNumber(doc)} back={`/documentos?tipo=${doc.type}`} backLabel="Documentos">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{status}</span>
        </PageHeader>
        <div className="flex flex-wrap gap-2">
          {open && (
            <button onClick={() => void toSale(doc)} className="flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-700 px-4 text-sm font-medium text-white">
              <ShoppingCart className="size-4" />Pasar a venta
            </button>
          )}
          <button onClick={() => window.print()} className={btn}><Printer className="size-4" />Imprimir / PDF</button>
          <a href={whatsappUrl(shareText(doc, biz), doc.payload.phone)} target="_blank" rel="noreferrer" className={btn}>
            <MessageCircle className="size-4" />WhatsApp
          </a>
          {open && <button onClick={() => navigate(`/documentos/${doc.id}/editar`)} className={btn}><Pencil className="size-4" />Editar</button>}
          {canVoid && (
            <button onClick={onVoid} disabled={voidDoc.isPending} className="ml-auto min-h-11 rounded-lg border border-red-300 bg-white px-3 text-sm text-red-700">Anular</button>
          )}
        </div>
        {status === 'vendida' && <p className="rounded-lg bg-sky-50 p-2 text-sm text-sky-900">Se vendió: la venta quedó registrada con esta cotización.</p>}
      </div>

      <DocSheet doc={doc} biz={biz} />
    </div>
  )
}

/** La hoja del documento: lo que se imprime (A4) y se ve en pantalla. */
function DocSheet({ doc, biz }: { doc: Doc; biz?: BusinessInfo }) {
  const isQuote = doc.type === 'cotizacion'
  const { base, igv } = igvBreakdown(doc.total)
  const voided = !!doc.voided_at
  return (
    <article className="relative space-y-4 rounded-lg bg-white p-4 text-sm shadow sm:p-6 print:rounded-none print:p-0 print:shadow-none">
      {voided && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-bold text-red-600/15 -rotate-12">ANULADO</div>}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <div className="text-xl font-bold">{biz?.name ?? 'La Constructora'}</div>
          {biz?.ruc && <div>RUC {biz.ruc}</div>}
          {biz?.address && <div className="text-stone-600">{biz.address}</div>}
          {biz?.phone && <div className="text-stone-600">Tel. {biz.phone}</div>}
        </div>
        <div className="rounded-lg border-2 border-stone-800 px-4 py-2 text-center">
          <div className="font-semibold uppercase">{DOC_LABEL[doc.type]}</div>
          <div className="font-mono text-base">{docNumber(doc)}</div>
        </div>
      </header>

      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 print:grid-cols-2">
        <div><dt className="inline text-stone-500">Fecha: </dt><dd className="inline">{dateLabel(doc.payload.sold_at ?? doc.created_at)}</dd></div>
        {isQuote && doc.valid_until && <div><dt className="inline text-stone-500">Válida hasta: </dt><dd className="inline">{dateLabel(doc.valid_until)}</dd></div>}
        {!isQuote && doc.payload.payment_method && <div><dt className="inline text-stone-500">Pago: </dt><dd className="inline">{PAYMENT_LABEL[doc.payload.payment_method]}{doc.payload.sale_number != null && ` · venta #${doc.payload.sale_number}`}</dd></div>}
        <div className="sm:col-span-2 print:col-span-2"><dt className="inline text-stone-500">Cliente: </dt><dd className="inline">{doc.customer_name || '—'}</dd></div>
        {doc.customer_doc && <div><dt className="inline text-stone-500">{doc.customer_doc.length === 11 ? 'RUC' : 'DNI'}: </dt><dd className="inline">{doc.customer_doc}</dd></div>}
        {doc.payload.address && <div><dt className="inline text-stone-500">Dirección: </dt><dd className="inline">{doc.payload.address}</dd></div>}
        {doc.payload.phone && <div><dt className="inline text-stone-500">Celular: </dt><dd className="inline">{doc.payload.phone}</dd></div>}
      </dl>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y bg-stone-50 text-left text-xs uppercase text-stone-600 print:bg-transparent">
            <th className="py-1.5 pr-2 text-right font-medium">Cant.</th>
            <th className="py-1.5 pr-2 font-medium">Descripción</th>
            <th className="py-1.5 pr-2 text-right font-medium">P. unit.</th>
            <th className="py-1.5 text-right font-medium">Importe</th>
          </tr>
        </thead>
        <tbody>
          {doc.payload.items.map((i, n) => (
            <tr key={n} className="border-b align-top">
              <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">{i.qty} <span className="text-xs text-stone-500">{i.unit}</span></td>
              <td className="py-1.5 pr-2">{i.description}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">{money(i.unit_price)}</td>
              <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{money(lineTotal(i))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto w-full max-w-64 space-y-0.5">
        <div className="flex justify-between text-stone-600"><dt>Op. gravada</dt><dd className="tabular-nums">{money(base)}</dd></div>
        <div className="flex justify-between text-stone-600"><dt>IGV (18%)</dt><dd className="tabular-nums">{money(igv)}</dd></div>
        <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(doc.total)}</dd></div>
      </dl>

      <footer className="space-y-1 border-t pt-3 text-xs text-stone-600">
        {isQuote && <p>Precios en soles, incluyen IGV.{doc.valid_until && ` Cotización válida hasta el ${dateLabel(doc.valid_until)}`}; sujeta a stock disponible.</p>}
        {doc.payload.note && <p>{doc.payload.note}</p>}
        {!isQuote && <p>Documento interno de venta.</p>}
        {biz?.footer && <p className="whitespace-pre-line">{biz.footer}</p>}
        {voided && doc.voided_at && <p className="font-medium text-red-700">Anulado el {dateLabel(doc.voided_at)}.</p>}
      </footer>
    </article>
  )
}
