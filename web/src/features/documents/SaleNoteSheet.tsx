import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from '@/components/Sheet'
import { money } from '@/lib/format'
import { friendlyDocError, useCreateSaleNote } from './api'

/** Datos del cliente para la nota de venta de una venta registrada; al emitirla se abre para imprimir o enviar. */
export default function SaleNoteSheet({ sale, onClose }: {
  sale: { id: string; number: number | null; total: number; customer_name: string | null; customer_doc?: string | null }
  onClose: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateSaleNote()
  const [name, setName] = useState(sale.customer_name ?? '')
  const [docNum, setDocNum] = useState(sale.customer_doc ?? '')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const input = 'mt-1 min-h-11 w-full rounded-lg border px-3 text-base'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const d = await create.mutateAsync({ sale_id: sale.id, customer_name: name, customer_doc: docNum, address })
      navigate(`/documentos/${d.id}`)
    } catch (err) { setError(friendlyDocError(err)) }
  }

  return (
    <Sheet onClose={onClose} label="Nota de venta" className="space-y-3 sm:max-w-md">
      <h2 className="text-lg font-semibold">Nota de venta</h2>
      <p className="text-sm text-stone-500">Venta #{sale.number} · {money(sale.total)}. Los datos del cliente son opcionales.</p>
      <form onSubmit={onSubmit} className="space-y-2">
        <label className="block text-xs text-stone-500">Cliente (nombre o razón social)<input className={input} value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
        <label className="block text-xs text-stone-500">DNI / RUC<input className={input} inputMode="numeric" value={docNum} onChange={e => setDocNum(e.target.value)} /></label>
        <label className="block text-xs text-stone-500">Dirección<input className={input} value={address} onChange={e => setAddress(e.target.value)} /></label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm">Cancelar</button>
          <button disabled={create.isPending} className="min-h-11 rounded-lg bg-amber-700 px-5 text-sm text-white disabled:opacity-50">
            {create.isPending ? 'Emitiendo…' : 'Emitir nota'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
