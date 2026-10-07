import { useState, type FormEvent, type ReactNode } from 'react'
import Sheet from '@/components/Sheet'
import { friendlyPoError, type Provider, useSaveProvider, whatsappUrl } from './api'

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`block text-sm ${className}`}><span className="mb-1 block text-xs text-stone-500">{label}</span>{children}</label>
}
const input = 'min-h-11 w-full rounded border px-2 py-2 text-base sm:text-sm'

interface Props {
  provider: Provider | null
  onClose: () => void
  onSaved: (id: string) => void
}

export default function ProviderSheet({ provider, onClose, onSaved }: Props) {
  const save = useSaveProvider()
  const [initial] = useState(() => ({
    name: provider?.name ?? '', ruc: provider?.ruc ?? '', contact: provider?.contact ?? '', phone: provider?.phone ?? '',
    email: provider?.email ?? '', address: provider?.address ?? '', notes: provider?.notes ?? '', active: provider?.active ?? true,
  }))
  const [f, setF] = useState(initial)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const requestClose = () => { if (!dirty || confirm('Tienes cambios sin guardar. ¿Descartarlos?')) onClose() }
  const wa = whatsappUrl(f.phone)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      const id = await save.mutateAsync({ id: provider?.id, ...f, name: f.name.trim().toUpperCase() })
      onSaved(id)
    } catch { /* se muestra abajo */ }
  }

  return (
    <Sheet onClose={requestClose} label={provider ? 'Editar proveedor' : 'Nuevo proveedor'} dismissible={!dirty} className="sm:max-w-lg">
      <div className="mb-3 flex items-center pt-2">
        <h2 className="flex-1 text-lg font-semibold">{provider ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
        <button onClick={requestClose} aria-label="Cerrar" className="-mr-2 grid size-11 place-items-center text-xl">✕</button>
      </div>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 pb-2">
        <Field label="Razón social / nombre" className="col-span-2">
          <input className={input} value={f.name} onChange={e => set('name', e.target.value)} required autoFocus={!provider} />
        </Field>
        <Field label="RUC">
          <input className={input} value={f.ruc} onChange={e => set('ruc', e.target.value.replace(/\D/g, '').slice(0, 11))}
                 inputMode="numeric" pattern="\d{11}" title="11 dígitos" />
        </Field>
        <Field label="Contacto"><input className={input} value={f.contact} onChange={e => set('contact', e.target.value)} /></Field>
        <Field label="Teléfono / WhatsApp">
          <div className="flex gap-1">
            <input className={input} value={f.phone} onChange={e => set('phone', e.target.value)} inputMode="tel" />
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="grid min-w-11 shrink-0 place-items-center rounded border" aria-label="Abrir WhatsApp">💬</a>}
          </div>
        </Field>
        <Field label="Correo"><input className={input} type="email" value={f.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Dirección" className="col-span-2"><input className={input} value={f.address} onChange={e => set('address', e.target.value)} /></Field>
        <Field label="Notas (condiciones, días de reparto, crédito…)" className="col-span-2">
          <textarea className={input} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
        <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={f.active} onChange={e => set('active', e.target.checked)} />
          Activo (aparece al crear órdenes y en el inventario)
        </label>
        {save.error && <p className="col-span-2 text-sm text-red-600">{friendlyPoError(save.error)}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" onClick={requestClose} className="min-h-11 rounded border px-4 text-sm">Cancelar</button>
          <button disabled={save.isPending} className="min-h-11 rounded bg-amber-700 px-4 text-sm text-white disabled:opacity-50">
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
