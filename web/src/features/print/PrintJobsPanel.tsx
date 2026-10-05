import { useMemo, useState } from 'react'
import Sheet from '@/components/Sheet'
import { money } from '@/lib/format'
import type { Product } from '@/types/domain'
import {
  cambiarHojas, cambiarPrecio, describirJob, formatJobTimestamp, hojasAsignadas, lineasDeReparto,
  precioEn, productosParaJob, totalReparto, type Job, type Reparto,
} from '@shared/print/core.js'
import { toProductoImpresion } from './adapter'
import type { PrintAgent } from './usePrintAgent'

export interface PrintLine { product_id: string; description: string; qty: number; unit_price: number }

interface Props {
  agent: PrintAgent
  products: Product[]
  onAdd: (lines: PrintLine[], resto: number) => void
  onClose: () => void
}

const ESTADO: Record<PrintAgent['estado'], string> = {
  nunca: '⚪ Agente no conectado', conectando: 'Conectando…', conectado: '🟢 Conectado', perdido: '🔴 Se perdió la conexión',
}

/** Trabajos detectados por el agente: repartir las hojas entre productos de impresión y pasarlas al ticket. */
export default function PrintJobsPanel({ agent, products, onAdd, onClose }: Props) {
  const catalogo = useMemo(() => products.map(toProductoImpresion), [products])
  // Reparto en memoria por trabajo (igual que en /index.html): se pierde al cerrar, el trabajo no.
  const [repartos, setRepartos] = useState<Record<string, Reparto>>({})
  const [aviso, setAviso] = useState('')
  const repartoDe = (j: Job) => repartos[j.id] ?? {}
  const setReparto = (j: Job, r: Reparto) => setRepartos(s => ({ ...s, [j.id]: r }))

  function sumar(j: Job, pid: string, delta: number) {
    const nuevo = cambiarHojas(j, repartoDe(j), pid, delta)
    if (!nuevo) { setAviso('Ya asignaste todas las hojas de este trabajo.'); return }
    setAviso(''); setReparto(j, nuevo)
  }

  function agregar(j: Job) {
    const { lineas, usadas, resto } = lineasDeReparto(j, repartoDe(j), catalogo)
    if (!usadas) return
    onAdd(lineas.map(l => ({ product_id: l.producto.id, description: l.producto.nombre, qty: l.qty, unit_price: l.precio })), resto)
    setRepartos(({ [j.id]: _, ...s }) => s)
    agent.dejarHojas(j.id, resto)
  }

  function ignorar(j: Job) {
    setRepartos(({ [j.id]: _, ...s }) => s)
    agent.quitar(j.id)
  }

  const pendientes = agent.pendientes.slice().reverse()

  return (
    <Sheet onClose={onClose} label="Trabajos de impresión" className="space-y-3 sm:max-w-lg">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold">Impresiones y copias</h2>
        <span className="text-xs text-stone-500">{ESTADO[agent.estado]}</span>
        {agent.estado !== 'conectado' && (
          <button onClick={agent.conectar} className="min-h-11 rounded border px-3 text-sm">Conectar</button>
        )}
      </div>
      {aviso && <p role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-800">{aviso}</p>}

      {!pendientes.length && <p className="py-6 text-center text-sm text-stone-500">No hay trabajos pendientes.</p>}

      <ul className="space-y-3">
        {pendientes.map(j => {
          const lista = productosParaJob(j, catalogo)
          const reparto = repartoDe(j)
          const usadas = hojasAsignadas(reparto)
          return (
            // La clave cambia al quedar hojas pendientes: reinicia los precios editados (inputs no controlados).
            <li key={`${j.id}:${j.hojas}`} className="rounded-lg border p-3">
              <div className="font-medium">{describirJob(j)}</div>
              <div className="mb-2 text-xs text-stone-500">
                {formatJobTimestamp(j.timestamp)}{j.documento && ` · ${j.documento}`}{j.duplex && ' · doble cara'}
              </div>

              {lista.length ? (
                <div className="divide-y">
                  {lista.map(({ p, sug }) => (
                    <div key={p.id} className={`flex items-center gap-2 py-1 text-sm ${sug ? 'font-medium' : ''}`}>
                      <span className="min-w-0 flex-1">{sug && '⭐ '}{p.nombre}</span>
                      <input type="number" min={0} step="0.10" inputMode="decimal" aria-label={`Precio por hoja de ${p.nombre}`}
                             title="Precio por hoja (solo para esta venta)"
                             // No controlado: al escribir "0." un input controlado volvería a "0".
                             defaultValue={precioEn(reparto, p)}
                             onChange={e => setReparto(j, cambiarPrecio(reparto, p.id, e.target.value))}
                             className="min-h-11 w-20 rounded border px-2 text-right text-base sm:text-sm" />
                      <div className="flex items-center rounded border">
                        <button className="grid size-11 place-items-center text-lg" onClick={() => sumar(j, p.id, -1)} aria-label="Menos">−</button>
                        <span className="w-8 text-center tabular-nums">{reparto[p.id]?.qty ?? 0}</span>
                        <button className="grid size-11 place-items-center text-lg" onClick={() => sumar(j, p.id, 1)} aria-label="Más">+</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500">
                  No hay productos configurados para este tipo de trabajo. Configúralos en Inventario
                  (categoría “Impresión y fotocopia”, sección “Trabajos detectados”).
                </p>
              )}

              <div className="mt-2 flex items-center gap-2">
                {lista.length > 0 && (
                  <span className="flex-1 text-sm">
                    Asignadas {usadas} de {j.hojas} · <b className="tabular-nums">{money(totalReparto(reparto, catalogo))}</b>
                  </span>
                )}
                <button onClick={() => ignorar(j)} className="ml-auto min-h-11 rounded border px-3 text-sm">Ignorar</button>
                {lista.length > 0 && (
                  <button disabled={!usadas} onClick={() => agregar(j)}
                          className="min-h-11 rounded bg-amber-700 px-3 text-sm text-white disabled:opacity-40">Agregar al ticket</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
