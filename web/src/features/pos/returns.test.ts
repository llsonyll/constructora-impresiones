// npm test (node --test). Cambios y devoluciones: plazo en hora de Lima, líneas devueltas y tipo de ticket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  daysSince, limaDay, remaining, returnDescription, returnLines, returnedValue, ticketKind, withinReturnWindow,
  type ReturnableSale,
} from './returns.ts'

// ---------- Fechas de Lima y plazo ----------

test('limaDay: las 22:00 de Lima ya son el día siguiente en UTC', () => {
  assert.equal(limaDay('2026-11-24T03:00:00Z'), '2026-11-23')
  assert.equal(limaDay('2026-11-24T05:00:00Z'), '2026-11-24')
})

test('daysSince: cuenta días de calendario de Lima, no horas', () => {
  // Vendido a las 21:00 del 22 (Lima), consultado a las 8:00 del 23: un día.
  assert.equal(daysSince('2026-11-23T02:00:00Z', new Date('2026-11-23T13:00:00Z')), 1)
  assert.equal(daysSince('2026-11-23T13:00:00Z', new Date('2026-11-23T23:00:00Z')), 0)
})

test('withinReturnWindow: hasta 7 días después, inclusive', () => {
  const now = new Date('2026-11-23T20:00:00Z')            // lunes 23, 15:00 en Lima
  assert.equal(withinReturnWindow('2026-11-16T15:00:00Z', now), true)    // lunes 16: 7 días
  assert.equal(withinReturnWindow('2026-11-15T23:00:00Z', now), false)   // domingo 15: 8 días
  assert.equal(withinReturnWindow('2026-11-23T14:00:00Z', now), true)    // hoy
})

test('withinReturnWindow: una venta "del futuro" (reloj adelantado) no se acepta', () => {
  assert.equal(withinReturnWindow('2026-11-25T15:00:00Z', new Date('2026-11-23T20:00:00Z')), false)
})

// ---------- Líneas devueltas ----------

const sale: Pick<ReturnableSale, 'number' | 'items'> = {
  number: 1234,
  items: [
    { id: 1, product_id: 'pvc', description: 'CODO PVC 1/2', qty: 3, unit_price: 1.5, factor: 1, returned_qty: 1 },
    { id: 2, product_id: 'tir', description: 'TIRAFON 8x1 · Docena', qty: 2, unit_price: 3, factor: 12, returned_qty: 0 },
    { id: 3, product_id: null, description: 'Ítem libre', qty: 1, unit_price: 5, factor: 1, returned_qty: 1 },
  ],
}

test('remaining: lo vendido menos lo ya devuelto, nunca negativo', () => {
  assert.equal(remaining(sale.items[0]), 2)
  assert.equal(remaining(sale.items[2]), 0)
  assert.equal(remaining({ qty: 1.2, returned_qty: 0.4 }), 0.8)
})

test('returnLines: cantidad negativa, precio y presentación de la venta original', () => {
  const lines = returnLines(sale, { 1: 1, 2: 1 })
  assert.deepEqual(lines, [
    { product_id: 'pvc', description: 'CODO PVC 1/2 · devuelto de venta #1234', qty: -1, unit_price: 1.5,
      returns_item_id: 1, returns_sale_number: 1234 },
    { product_id: 'tir', description: 'TIRAFON 8x1 · Docena · devuelto de venta #1234', qty: -1, unit_price: 3, factor: 12,
      returns_item_id: 2, returns_sale_number: 1234 },
  ])
})

test('returnLines: no pasa de lo pendiente y omite lo que no se eligió', () => {
  const lines = returnLines(sale, { 1: 5, 3: 1 })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].qty, -2)
})

test('returnDescription: igual a la que guarda el servidor', () => {
  assert.equal(returnDescription('CODO PVC 1/2', 7), 'CODO PVC 1/2 · devuelto de venta #7')
})

test('returnedValue: valor positivo de lo devuelto', () => {
  assert.equal(returnedValue(returnLines(sale, { 1: 2, 2: 1 })), 6)
})

// ---------- Tipo de ticket ----------

test('ticketKind: venta, cambio o devolución', () => {
  assert.equal(ticketKind([{}, { returns_item_id: null }]), 'venta')
  assert.equal(ticketKind([{ returns_item_id: 1 }, {}]), 'cambio')
  assert.equal(ticketKind([{ returns_item_id: 1 }]), 'devolucion')
  assert.equal(ticketKind([]), 'venta')
})

test('cambio del codo: devuelve PVC (S/ 1.50) y lleva hidro (S/ 3.00): paga S/ 1.50', () => {
  const ticket: { qty: number; unit_price: number; returns_item_id?: number }[] = [...returnLines(sale, { 1: 1 }), { qty: 1, unit_price: 3 }]
  const total = Math.round(ticket.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100
  assert.equal(ticketKind(ticket), 'cambio')
  assert.equal(total, 1.5)
})
