// npm test (node --test). Conteo por casillero: qué se ubica, qué cantidad queda y cuándo se ajusta el stock.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countPayload, parseQty, planCount, type CountDraft, type CountProduct } from './count.ts'

const E2 = 1, D1 = 2, E3 = 3
const at = '2026-11-27T10:00:00.000Z'
const products: CountProduct[] = [
  { id: 'a', stock: 0, track_stock: true, locations: [] },
  { id: 'b', stock: 20, track_stock: true, locations: [{ location_id: E2, code: 'E2-N5', qty: null }, { location_id: D1, code: 'D1-N1', qty: 5 }] },
  { id: 'c', stock: 0, track_stock: true, locations: [{ location_id: E2, code: 'E2-N5', qty: null }, { location_id: E3, code: 'E3-N2', qty: null }] },
  { id: 'e', stock: 5, track_stock: true, locations: [{ location_id: E2, code: 'E2-N5', qty: 3 }, { location_id: D1, code: 'D1-N1', qty: 2 }] },
  { id: 's', stock: 0, track_stock: false, locations: [] },
]
const line = (draft: CountDraft, id: string) => planCount(E2, products, draft).lines.find(l => l.id === id)

test('parseQty: vacío, coma decimal e inválidos', () => {
  assert.equal(parseQty(''), null)
  assert.equal(parseQty('  '), null)
  assert.equal(parseQty('12'), 12)
  assert.equal(parseQty('1,5'), 1.5)
  assert.ok(Number.isNaN(parseQty('-1')!))
  assert.ok(Number.isNaN(parseQty('abc')!))
})

test('producto sin ubicación: queda ubicado aquí y el stock pasa a lo contado', () => {
  const l = line({ a: { v: '10', at } }, 'a')!
  assert.equal(l.isNew, true)
  assert.equal(l.target, 10)
  assert.equal(l.diff, 10)
})

test('stock = lo contado aquí + lo anotado en las otras ubicaciones', () => {
  const l = line({ b: { v: '12', at } }, 'b')!
  assert.equal(l.isNew, false)
  assert.equal(l.target, 17)
  assert.equal(l.diff, -3)
})

test('otra ubicación sin cantidad: no se ajusta el stock y se dice dónde falta contar', () => {
  const l = line({ c: { v: '4', at } }, 'c')!
  assert.equal(l.target, null)
  assert.deepEqual(l.pending, ['E3-N2'])
})

test('quitar del casillero: cuenta como 0 aquí y queda lo de las otras ubicaciones', () => {
  const l = line({ e: { v: '', at, remove: true } }, 'e')!
  assert.equal(l.remove, true)
  assert.equal(l.counted, 0)
  assert.equal(l.target, 2)
})

test('servicios: se ubican pero no llevan stock', () => {
  const l = line({ s: { v: '1', at } }, 's')!
  assert.equal(l.target, null)
  assert.deepEqual(l.pending, [])
})

test('resumen, inválidos y lo que no se toca', () => {
  const draft: CountDraft = {
    a: { v: '10', at }, b: { v: '12', at }, c: { v: '4', at }, e: { v: 'x', at },
    s: { v: '', at },                 // anotado sin cantidad
    zz: { v: '3', at },               // producto que ya no existe
  }
  const plan = planCount(E2, products, draft)
  assert.deepEqual(plan.lines.map(l => l.id).sort(), ['a', 'b', 'c'])
  assert.deepEqual(plan.invalid, ['e'])
  assert.equal(plan.placed, 1)
  assert.equal(plan.adjusted, 2)
  assert.equal(plan.skipped, 1)
})

test('quitar un producto que no estaba aquí no hace nada', () => {
  assert.equal(line({ a: { v: '', at, remove: true } }, 'a'), undefined)
})

test('envío: hora de conteo por línea y remove solo cuando corresponde', () => {
  const draft: CountDraft = { a: { v: '10', at }, e: { v: '', at, remove: true } }
  const p = countPayload(E2, planCount(E2, products, draft), draft, '  ')
  assert.deepEqual(p, { location_id: E2, items: [
    { product_id: 'a', counted: 10, counted_at: at },
    { product_id: 'e', counted: 0, counted_at: at, remove: true },
  ] })
})
