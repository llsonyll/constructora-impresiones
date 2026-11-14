import { FileText } from 'lucide-react'
import Sheet from '@/components/Sheet'

export type SendKind = 'precios' | 'pedido'

const TEXT: Record<SendKind, { title: string; help: string; pdf: string }> = {
  precios: {
    title: 'Pedir precios',
    help: 'Se envía la lista sin precios para que el proveedor los complete. La orden queda en «Esperando precios»; '
      + 'cuando responda, escribe los costos y guarda.',
    pdf: 'PDF · Solicitud de precios',
  },
  pedido: {
    title: 'Enviar pedido',
    help: 'La orden queda como «Pedido enviado». Cuando llegue la mercadería, la recibes desde aquí.',
    pdf: 'PDF · Orden de compra',
  },
}

/**
 * Cómo se le hace llegar la orden al proveedor: WhatsApp (el enlace se abre en el mismo toque, sin bloqueo de
 * ventanas emergentes), PDF, o solo marcarla si ya se envió por otro lado. Las tres cambian el estado.
 */
export default function SendOrderSheet({ kind, providerName, whatsapp, onWhatsApp, onPdf, onMarkOnly, onClose }: {
  kind: SendKind
  providerName?: string
  whatsapp: string | null
  onWhatsApp: () => void
  onPdf: () => void
  onMarkOnly: () => void
  onClose: () => void
}) {
  const t = TEXT[kind]
  const option = 'flex min-h-12 w-full items-center gap-2 rounded-lg border px-4 text-left text-base'
  return (
    <Sheet onClose={onClose} label={t.title} className="space-y-3 sm:max-w-md">
      <div>
        <h2 className="text-lg font-semibold">{t.title}{providerName && <span className="font-normal"> · {providerName}</span>}</h2>
        <p className="text-sm text-stone-600">{t.help}</p>
      </div>
      {whatsapp
        ? <a href={whatsapp} target="_blank" rel="noreferrer" onClick={onWhatsApp} className={`${option} border-green-700 bg-green-50 text-green-900`}>
            💬 Por WhatsApp
          </a>
        : <p className="text-xs text-stone-500">El proveedor no tiene un celular registrado para enviarlo por WhatsApp.</p>}
      <button onClick={onPdf} className={option}><FileText className="size-5" />{t.pdf}</button>
      <button onClick={onMarkOnly} className={`${option} text-stone-700`}>Ya lo envié de otra forma</button>
    </Sheet>
  )
}
