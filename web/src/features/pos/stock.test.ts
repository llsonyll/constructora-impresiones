// npm test (node --test). Aviso al vender sin stock en el sistema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inTicket, overStock, stockWarning } from './stock.ts'

const p = (stock: number, track_stock = true) => ({ id: 'x', name: 'CODO PVC 1/2', unit: 'und', stock, track_stock })

test('inTicket suma presentaciones y no cuenta lo devuelto', () => {
  const lines = [
    { product_id: 'x', qty: 2 },
    { product_id: 'x', qty: 1, factor: 12 },
    { product_id: 'x', qty: -1, returns_item_id: 9 },
    { product_id: 'y', qty: 5 },
  ]
  assert.equal(inTicket(lines, 'x'), 14)
})

test('alcanza: sin aviso', () => {
  assert.equal(stockWarning(p(5), 0, 1), null)
  assert.equal(stockWarning(p(5), 4, 1), null)
})

test('se pasa del stock: avisa cuánto hay', () => {
  assert.match(stockWarning(p(5), 5, 1)!, /solo hay 5 und/)
  assert.match(stockWarning(p(5), 0, 12)!, /solo hay 5 und/)
})

test('sin stock o negativo: avisa la primera vez, no en cada toque', () => {
  assert.match(stockWarning(p(0), 0, 1)!, /sin stock/)
  assert.equal(stockWarning(p(0), 1, 1), null)
  assert.match(stockWarning(p(-3), 0, 1)!, /sin stock/)
  assert.equal(stockWarning(p(-3), 2, 1), null)
})

test('ya pasado el límite no repite', () => {
  assert.equal(stockWarning(p(5), 6, 1), null)
})

test('servicios nunca avisan', () => {
  assert.equal(stockWarning(p(0, false), 0, 100), null)
  assert.equal(overStock(p(0, false), 100), false)
})

test('overStock', () => {
  assert.equal(overStock(p(5), 5), false)
  assert.equal(overStock(p(5), 6), true)
  assert.equal(overStock(p(-1), 1), true)
})
