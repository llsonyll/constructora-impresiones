import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { IGV_RATE, igvBreakdown, money } from '@/lib/format'
import { todayLocal } from '@/features/sales/api'
import type { Caja, PaymentMethod } from '@/types/domain'

export type DocType = 'cotizacion' | 'nota_venta'

/** `factor`: unidades base por unidad de la línea (presentación: docena = 12); sin dato = 1. */
export interface DocItem { product_id: string | null; description: string; unit: string; qty: number; unit_price: number; factor?: number }

export interface Doc {
  id: string
  type: DocType
  series: string
  number: number
  sale_id: string | null
  customer_name: string | null
  customer_doc: string | null
  total: number
  valid_until: string | null      // YYYY-MM-DD (cotizaciones)
  voided_at: string | null
  created_at: string
  created_by: string | null
  payload: {
    items: DocItem[]
    phone?: string | null; note?: string | null; valid_days?: number        // cotización
    address?: string; payment_method?: PaymentMethod; caja?: Caja; sale_number?: number; sold_at?: string  // nota de venta
    source?: 'sol'                  // boleta/factura emitida en el portal SOL (solo el registro)
  }
}

/** Boleta o factura emitida en el portal SOL y anotada en su venta (no se imprime desde aquí: el PDF es el de SOL). */
export type ReceiptType = 'boleta' | 'factura'
export const RECEIPT_LABEL: Record<ReceiptType, string> = { boleta: 'Boleta', factura: 'Factura' }
export interface SaleReceipt { id: string; type: ReceiptType; series: string; number: number }
/** EB01-15 (sin ceros a la izquierda, como lo muestra SOL). */
export const receiptNumber = (r: Pick<SaleReceipt, 'series' | 'number'>) => `${r.series}-${r.number}`

/** Leyenda de la nota de venta: es un documento interno, no un comprobante de pago. */
export const NOTE_DISCLAIMER = 'No válido como comprobante de pago. Solicite su boleta o factura.'

export interface BusinessInfo { name: string; ruc: string | null; address: string | null; phone: string | null; footer: string | null }

export const DOC_LABEL: Record<DocType, string> = { cotizacion: 'Cotización', nota_venta: 'Nota de venta' }

/** COT-000012 */
export const docNumber = (d: Pick<Doc, 'series' | 'number'>) => `${d.series}-${String(d.number).padStart(6, '0')}`

export type DocStatus = 'vigente' | 'vencida' | 'vendida' | 'anulada' | 'emitida'
export const STATUS_STYLE: Record<DocStatus, string> = {
  vigente: 'bg-green-100 text-green-800', vencida: 'bg-stone-200 text-stone-600', vendida: 'bg-sky-100 text-sky-800',
  anulada: 'bg-red-100 text-red-700', emitida: 'bg-stone-100 text-stone-700',
}
export function docStatus(d: Doc, today = todayLocal()): DocStatus {
  if (d.voided_at) return 'anulada'
  if (d.type === 'nota_venta') return 'emitida'
  if (d.sale_id) return 'vendida'
  return d.valid_until && d.valid_until < today ? 'vencida' : 'vigente'
}

/** 2026-10-22 o ISO → 22/10/2026 */
export const dateLabel = (s: string) => {
  const d = s.length === 10 ? new Date(`${s}T12:00:00`) : new Date(s)
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const lineTotal = (i: Pick<DocItem, 'qty' | 'unit_price'>) => Math.round(i.qty * i.unit_price * 100) / 100

/** Texto para WhatsApp (negritas con *). */
export function shareText(d: Doc, biz?: BusinessInfo | null) {
  const lines = [
    `*${biz?.name ?? 'La Constructora'}*`,
    `${DOC_LABEL[d.type].toUpperCase()} ${docNumber(d)} · ${dateLabel(d.created_at)}`,
    d.customer_name && `Cliente: ${d.customer_name}${d.customer_doc ? ` (${d.customer_doc})` : ''}`,
    '',
    ...d.payload.items.map(i => `• ${[i.qty, i.unit, i.description].filter(Boolean).join(' ')} × ${money(i.unit_price)} = ${money(lineTotal(i))}`),
    '',
    `*Total: ${money(d.total)}*`,
    d.type === 'cotizacion' && d.valid_until && `Válida hasta el ${dateLabel(d.valid_until)}. Precios incluyen IGV.`,
    d.payload.note,
    d.type === 'nota_venta' && `_${NOTE_DISCLAIMER}_`,
  ]
  return lines.filter(l => l !== false && l != null).join('\n')
}

/** Enlace de WhatsApp: al número del cliente si es un celular peruano (9 dígitos), si no, para elegir el chat. */
export function whatsappUrl(text: string, phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '')
  const to = digits.length === 9 ? `51${digits}` : digits.length === 11 && digits.startsWith('51') ? digits : ''
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`
}

export function friendlyDocError(e: unknown) {
  const err = e as { code?: string; message?: string }
  if (err.code === '42501') return err.message && err.message !== 'No autorizado' ? err.message : 'No tienes permiso para esta acción.'
  if (err.message?.includes('Failed to fetch')) return 'Sin conexión: inténtalo cuando vuelva el internet.'
  return err.message ?? 'Error inesperado'
}

export const docKeys = {
  all: ['documents'] as const,
  list: (type: DocType, q: string) => ['documents', 'list', type, q] as const,
  one: (id: string) => ['documents', 'one', id] as const,
}

const toDoc = (r: Doc): Doc => ({ ...r, total: Number(r.total), payload: { ...r.payload, items: r.payload?.items ?? [] } })

/** Últimos documentos de un tipo; `q` busca por cliente, DNI/RUC o número. */
export function useDocuments(type: DocType, q: string) {
  return useQuery({
    queryKey: docKeys.list(type, q),
    queryFn: async (): Promise<Doc[]> => {
      let query = supabase.from('documents').select('*').eq('type', type).order('created_at', { ascending: false }).limit(100)
      const term = q.trim().replace(/[,()%*]/g, ' ').trim()
      if (term) {
        const num = term.match(/(\d+)\s*$/)?.[1]
        const or = [`customer_name.ilike.%${term}%`, `customer_doc.ilike.%${term}%`]
        if (num && num.length <= 9) or.push(`number.eq.${Number(num)}`)
        query = query.or(or.join(','))
      }
      const { data, error } = await query
      if (error) throw error
      return (data as Doc[]).map(toDoc)
    },
  })
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: docKeys.one(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Doc> => {
      const { data, error } = await supabase.from('documents').select('*').eq('id', id!).single()
      if (error) throw error
      return toDoc(data as Doc)
    },
  })
}

export function useBusinessInfo() {
  return useQuery({
    queryKey: ['business_info'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<BusinessInfo> => {
      const { data, error } = await supabase.from('business_info').select('name, ruc, address, phone, footer').eq('id', 1).single()
      if (error) throw error
      return data as BusinessInfo
    },
  })
}

export function useSaveBusinessInfo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b: BusinessInfo) => {
      const { error } = await supabase.from('business_info').update({ ...b, updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business_info'] }),
  })
}

export interface QuoteInput {
  id?: string
  customer_name: string; customer_doc: string; phone: string; note: string; valid_days: number
  items: DocItem[]
}

/** Crear o editar una cotización (RPC `save_quote`: numera y recalcula el total en el servidor). */
export function useSaveQuote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: QuoteInput) => {
      const { data, error } = await supabase.rpc('save_quote', { p })
      if (error) throw error
      return toDoc(data as Doc)
    },
    onSuccess: d => { qc.setQueryData(docKeys.one(d.id), d); void qc.invalidateQueries({ queryKey: ['documents', 'list'] }) },
  })
}

/** Nota de venta de una venta registrada (si ya tiene, devuelve esa con los datos del cliente al día). */
export function useCreateSaleNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { sale_id: string; customer_name: string; customer_doc: string; address: string }) => {
      const { data, error } = await supabase.rpc('create_sale_note', { p })
      if (error) throw error
      return toDoc(data as Doc)
    },
    onSuccess: d => {
      qc.setQueryData(docKeys.one(d.id), d)
      void qc.invalidateQueries({ queryKey: ['documents', 'list'] })
      void qc.invalidateQueries({ queryKey: ['sales'] })
    },
  })
}

export function useVoidDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('void_document', { p_id: id })
      if (error) throw error
      return toDoc(data as Doc)
    },
    onSuccess: d => {
      qc.setQueryData(docKeys.one(d.id), d)
      void qc.invalidateQueries({ queryKey: ['documents', 'list'] })
      if (d.sale_id) void qc.invalidateQueries({ queryKey: ['sales'] })   // registro de boleta SOL quitado
    },
  })
}

/** RUC: 11 dígitos, prefijo de contribuyente y dígito verificador (módulo 11). Igual que `ruc_valido` en la BD. */
export function rucValido(ruc: string) {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false
  const sum = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((s, w, i) => s + w * Number(ruc[i]), 0)
  return (11 - (sum % 11)) % 10 === Number(ruc[10])
}

/** 32.5 → "32.50"; el valor sin IGV va con 6 decimales (sin ceros sobrantes) para que el total cuadre en SOL. */
const plain = (n: number, max = 2) => n.toFixed(max).replace(/(\.\d{2}\d*?)0+$/, '$1')

/** Datos de una venta listos para llenar la boleta o factura en el portal SOL. */
export function solText(sale: { number: number | null; total: number; items: { description: string; qty: number; unit_price: number; subtotal: number }[] },
                        customer: { name: string; doc: string }) {
  const { base, igv, total } = igvBreakdown(sale.total)
  return [
    `Venta #${sale.number}`,
    customer.name || customer.doc ? `Cliente: ${[customer.name, customer.doc].filter(Boolean).join(' · ')}` : null,
    '',
    ...sale.items.map((i, n) => `${n + 1}. ${i.qty} × ${i.description}\n   Precio con IGV ${plain(i.unit_price)} · ` +
      `Valor unit. sin IGV ${plain(i.unit_price / (1 + IGV_RATE), 6)} · Importe ${plain(i.subtotal)}`),
    '',
    `Op. gravada ${plain(base)} · IGV ${plain(igv)} · Total ${plain(total)}`,
  ].filter(l => l != null).join('\n')
}

/** Último número registrado de una serie de SOL (para sugerir el siguiente). */
export function useLastReceiptNumber(type: ReceiptType, series: string) {
  return useQuery({
    queryKey: ['documents', 'last', type, series],
    enabled: series.length === 4,
    queryFn: async () => {
      const { data, error } = await supabase.from('documents').select('number')
        .eq('type', type).eq('series', series).order('number', { ascending: false }).limit(1)
      if (error) throw error
      return (data[0]?.number as number | undefined) ?? null
    },
  })
}

/** Anota en la venta la boleta o factura emitida en SOL (RPC `register_sol_receipt`). */
export function useRegisterSolReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { sale_id: string; type: ReceiptType; series: string; number: string; customer_name: string; customer_doc: string }) => {
      const { data, error } = await supabase.rpc('register_sol_receipt', { p })
      if (error) throw error
      return toDoc(data as Doc)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}
