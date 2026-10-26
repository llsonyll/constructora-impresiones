import { useState, type FormEvent } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import Sheet from '@/components/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import type { DaySale } from '@/features/sales/api'
import { money } from '@/lib/format'
import {
  RECEIPT_LABEL, friendlyDocError, receiptNumber, rucValido, solText, useLastReceiptNumber, useRegisterSolReceipt,
  useVoidDocument, type ReceiptType,
} from './api'

/** Desde S/ 700 la boleta debe identificar al cliente (DNI, CE o pasaporte). */
const BOLETA_DOC_DESDE = 700
const DEFAULT_SERIES: Record<ReceiptType, string> = { boleta: 'EB01', factura: 'E001' }

// Serie usada la última vez en este equipo (SOL asigna una por tipo; casi nunca cambia).
const seriesKey = (t: ReceiptType) => `sol.series.${t}`
function savedSeries(t: ReceiptType) {
  try { return localStorage.getItem(seriesKey(t)) || DEFAULT_SERIES[t] } catch { return DEFAULT_SERIES[t] }
}

/**
 * Boleta o factura emitida a mano en el portal SOL: muestra los datos de la venta para copiarlos en SOL
 * y anota en la venta la serie y el número. La app no la emite ni la imprime (el comprobante válido es el de SOL).
 */
export default function SolReceiptSheet({ sale, onClose }: { sale: DaySale; onClose: () => void }) {
  const { profile } = useAuth()
  const register = useRegisterSolReceipt()
  const voidDoc = useVoidDocument()
  const receipt = sale.receipt
  const [type, setType] = useState<ReceiptType>(() => sale.customer_doc?.length === 11 ? 'factura' : 'boleta')
  const [series, setSeries] = useState(() => savedSeries(type))
  const [number, setNumber] = useState('')
  const [name, setName] = useState(sale.customer_name ?? '')
  const [docNum, setDocNum] = useState(sale.customer_doc ?? '')
  const [error, setError] = useState('')
  const { data: last } = useLastReceiptNumber(type, series)
  const input = 'mt-1 min-h-11 w-full rounded-lg border px-3 text-base'
  const chip = (on: boolean) => `min-h-11 flex-1 rounded-lg border px-4 text-sm ${on ? 'border-amber-700 bg-amber-700 text-white' : 'bg-white'}`

  const doc = docNum.replace(/\s/g, '')
  const warning = type === 'factura'
    ? (doc && !rucValido(doc) ? 'El RUC no es válido: revisa los 11 dígitos.' : '')
    : (sale.total >= BOLETA_DOC_DESDE && !doc ? `Desde ${money(BOLETA_DOC_DESDE)} la boleta debe llevar el DNI del cliente.` : '')

  function pickType(t: ReceiptType) { setType(t); setSeries(savedSeries(t)); setError('') }

  async function copy() {
    try {
      await navigator.clipboard.writeText(solText(sale, { name: name.trim(), doc }))
      toast.success('Datos copiados: pégalos al llenar el comprobante en SOL')
    } catch { toast.error('No se pudo copiar') }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (type === 'factura' && !rucValido(doc)) return setError('La factura necesita un RUC válido (11 dígitos).')
    if (type === 'factura' && !name.trim()) return setError('La factura necesita la razón social del cliente.')
    try {
      const d = await register.mutateAsync({ sale_id: sale.id, type, series, number, customer_name: name, customer_doc: doc })
      try { localStorage.setItem(seriesKey(type), d.series) } catch { /* sin almacenamiento: se usa la serie por defecto */ }
      toast.success(`${RECEIPT_LABEL[type]} ${receiptNumber(d)} registrada en la venta #${sale.number}`)
      onClose()
    } catch (err) { setError(friendlyDocError(err)) }
  }

  async function onRemove() {
    if (!receipt) return
    if (!confirm(`¿Quitar el registro de la ${RECEIPT_LABEL[receipt.type].toLowerCase()} ${receiptNumber(receipt)}?\n\n` +
                 'Solo se quita de la app: en SUNAT sigue vigente. Para anularla, hazlo en SOL.')) return
    try { await voidDoc.mutateAsync(receipt.id); toast.success('Registro quitado'); onClose() } catch (err) { setError(friendlyDocError(err)) }
  }

  if (receipt) return (
    <Sheet onClose={onClose} label="Comprobante SOL" className="space-y-3 sm:max-w-md">
      <h2 className="text-lg font-semibold">{RECEIPT_LABEL[receipt.type]} {receiptNumber(receipt)}</h2>
      <p className="text-sm text-stone-500">
        Venta #{sale.number} · {money(sale.total)}. Emitida en el portal SOL de SUNAT: para imprimirla, reenviarla o anularla, entra a SOL.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {profile?.role === 'admin' && (
          <button onClick={onRemove} disabled={voidDoc.isPending} className="mr-auto min-h-11 rounded-lg border border-red-300 px-3 text-sm text-red-700 disabled:opacity-50">
            Quitar registro
          </button>
        )}
        <button onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm">Cerrar</button>
      </div>
    </Sheet>
  )

  return (
    <Sheet onClose={onClose} label="Boleta o factura de SOL" className="space-y-3 sm:max-w-md" dismissible={false}>
      <h2 className="text-lg font-semibold">Boleta o factura de SOL</h2>
      <p className="text-sm text-stone-500">
        Venta #{sale.number} · {money(sale.total)}. Emite el comprobante en el portal SOL de SUNAT y anota aquí su serie y número.
      </p>
      <form onSubmit={onSubmit} className="space-y-2">
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo de comprobante">
          {(['boleta', 'factura'] as const).map(t => (
            <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => pickType(t)} className={chip(type === t)}>
              {RECEIPT_LABEL[t]}
            </button>
          ))}
        </div>
        <label className="block text-xs text-stone-500">{type === 'factura' ? 'Razón social' : 'Cliente (opcional)'}
          <input className={input} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="block text-xs text-stone-500">{type === 'factura' ? 'RUC' : 'DNI'}
          <input className={input} inputMode="numeric" value={docNum} onChange={e => setDocNum(e.target.value)} />
        </label>
        {warning && <p className="text-sm text-amber-700">{warning}</p>}

        <details className="rounded-lg border bg-stone-50 px-3 py-2 text-sm">
          <summary className="cursor-pointer py-1 font-medium">Datos para SOL</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs text-stone-700">{solText(sale, { name: name.trim(), doc })}</pre>
        </details>
        <button type="button" onClick={copy} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border bg-white px-3 text-sm">
          <Copy className="size-4" />Copiar datos para SOL
        </button>

        <div className="flex gap-2">
          <label className="block w-28 text-xs text-stone-500">Serie
            <input className={`${input} font-mono uppercase`} value={series} maxLength={4} required
                   onChange={e => setSeries(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          </label>
          <label className="block flex-1 text-xs text-stone-500">Número
            <input className={`${input} font-mono`} inputMode="numeric" value={number} required maxLength={8}
                   placeholder={last != null ? `siguiente: ${last + 1}` : ''}
                   onChange={e => setNumber(e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm">Cancelar</button>
          <button disabled={register.isPending} className="min-h-11 rounded-lg bg-amber-700 px-5 text-sm text-white disabled:opacity-50">
            {register.isPending ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
