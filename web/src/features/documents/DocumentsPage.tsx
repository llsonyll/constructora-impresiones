import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Sheet from '@/components/Sheet'
import { useAuth } from '@/features/auth/AuthProvider'
import { money } from '@/lib/format'
import {
  DOC_LABEL, STATUS_STYLE, dateLabel, docNumber, docStatus, friendlyDocError, useBusinessInfo, useDocuments,
  useSaveBusinessInfo, type BusinessInfo, type DocType,
} from './api'

const TABS: { id: DocType; label: string; empty: string }[] = [
  { id: 'cotizacion', label: 'Cotizaciones', empty: 'Todavía no hay cotizaciones. Crea una aquí o con “Cotizar” desde el ticket de Ventas.' },
  { id: 'nota_venta', label: 'Notas de venta', empty: 'Todavía no hay notas de venta. Se emiten desde Hoy: abre una venta y toca “Nota de venta”.' },
]

/** Cotizaciones y notas de venta: listado con búsqueda (cliente, DNI/RUC o número). */
export default function DocumentsPage() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const type: DocType = params.get('tipo') === 'nota_venta' ? 'nota_venta' : 'cotizacion'
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [bizOpen, setBizOpen] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(t) }, [query])
  const { data: docs = [], isLoading, error } = useDocuments(type, debounced)
  const tab = TABS.find(t => t.id === type)!

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-4">
      <PageHeader title="Documentos">
        {profile?.role === 'admin' && (
          <button onClick={() => setBizOpen(true)} aria-label="Datos del negocio" title="Datos del negocio"
                  className="grid size-11 place-items-center rounded-lg border bg-white text-stone-600"><Building2 className="size-5" /></button>
        )}
        <Link to="/documentos/cotizacion/nueva" className="flex min-h-11 items-center rounded-lg bg-amber-700 px-3 text-sm text-white">+ Cotización</Link>
      </PageHeader>

      <div role="tablist" aria-label="Tipo de documento" className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200 p-1">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={type === t.id} onClick={() => setParams(t.id === 'cotizacion' ? {} : { tipo: t.id }, { replace: true })}
                  className={`min-h-11 rounded-lg text-sm font-medium ${type === t.id ? 'bg-white shadow' : 'text-stone-600'}`}>{t.label}</button>
        ))}
      </div>

      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por cliente, DNI/RUC o número…"
             aria-label="Buscar documentos" className="min-h-11 w-full rounded-lg border bg-white px-3 text-base" />

      {isLoading && <p className="text-stone-500">Cargando…</p>}
      {error && <p className="text-red-600">No se pudieron cargar: {friendlyDocError(error)}</p>}

      <ul className="divide-y rounded-lg bg-white shadow">
        {docs.map(d => {
          const st = docStatus(d)
          return (
            <li key={d.id}>
              <Link to={`/documentos/${d.id}`} className="flex items-center gap-3 p-3 hover:bg-amber-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{docNumber(d)}</span>
                    <span className={`rounded-full px-2 text-xs ${STATUS_STYLE[st]}`}>{st}</span>
                  </div>
                  <div className={`truncate text-sm ${d.customer_name ? '' : 'text-stone-400'}`}>{d.customer_name || 'Sin cliente'}{d.customer_doc && <span className="text-stone-500"> · {d.customer_doc}</span>}</div>
                  <div className="text-xs text-stone-500">
                    {dateLabel(d.created_at)} · {d.payload.items.length} ítem{d.payload.items.length === 1 ? '' : 's'}
                    {d.type === 'cotizacion' && st === 'vigente' && d.valid_until && ` · vence ${dateLabel(d.valid_until)}`}
                  </div>
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${st === 'anulada' ? 'text-stone-400 line-through' : ''}`}>{money(d.total)}</span>
              </Link>
            </li>
          )
        })}
        {!isLoading && !docs.length && (
          <li className="p-6 text-center text-sm text-stone-500">{debounced.trim() ? `Ningún ${DOC_LABEL[type].toLowerCase()} coincide con la búsqueda.` : tab.empty}</li>
        )}
      </ul>
      {docs.length === 100 && <p className="text-center text-xs text-stone-500">Se muestran los 100 más recientes: busca para encontrar uno anterior.</p>}

      {bizOpen && <BusinessSheet onClose={() => setBizOpen(false)} />}
    </div>
  )
}

/** Encabezado y pie de los documentos (solo admin). */
function BusinessSheet({ onClose }: { onClose: () => void }) {
  const { data } = useBusinessInfo()
  const save = useSaveBusinessInfo()
  const [form, setForm] = useState<BusinessInfo | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (data && !form) setForm(data) }, [data, form])
  const set = (k: keyof BusinessInfo) => (e: { target: { value: string } }) => setForm(f => f && { ...f, [k]: e.target.value })
  const input = 'mt-1 min-h-11 w-full rounded-lg border px-3 text-base'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form?.name.trim()) return
    setError('')
    const clean = (s: string | null) => s?.trim() || null
    try {
      await save.mutateAsync({ name: form.name.trim(), ruc: clean(form.ruc), address: clean(form.address), phone: clean(form.phone), footer: clean(form.footer) })
      onClose()
    } catch (err) { setError(friendlyDocError(err)) }
  }

  return (
    <Sheet onClose={onClose} label="Datos del negocio" className="space-y-3 sm:max-w-md">
      <h2 className="text-lg font-semibold">Datos del negocio</h2>
      <p className="text-xs text-stone-500">Aparecen en el encabezado y al pie de las cotizaciones y notas de venta.</p>
      {!form ? <p className="text-stone-500">Cargando…</p> : (
        <form onSubmit={onSubmit} className="space-y-2">
          <label className="block text-xs text-stone-500">Nombre comercial<input className={input} value={form.name} onChange={set('name')} required /></label>
          <label className="block text-xs text-stone-500">RUC<input className={input} inputMode="numeric" value={form.ruc ?? ''} onChange={set('ruc')} /></label>
          <label className="block text-xs text-stone-500">Dirección<input className={input} value={form.address ?? ''} onChange={set('address')} /></label>
          <label className="block text-xs text-stone-500">Teléfono / celular<input className={input} inputMode="tel" value={form.phone ?? ''} onChange={set('phone')} /></label>
          <label className="block text-xs text-stone-500">Pie de página (cuentas, Yape, horario…)
            <textarea className={`${input} py-2`} rows={3} value={form.footer ?? ''} onChange={set('footer')} />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm">Cancelar</button>
            <button disabled={save.isPending} className="min-h-11 rounded-lg bg-amber-700 px-5 text-sm text-white disabled:opacity-50">
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  )
}
