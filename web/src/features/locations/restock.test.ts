// npm test (node --test). Reponer desde el depósito y ubicar compras recibidas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placementItems, restockCandidates, suggestedMove, type RestockProduct } from './restock.ts'

const D1 = 100, E1 = 1, E2 = 2
const depots = new Set([D1])
const prod = (id: string, locations: RestockProduct['locations'], min_stock = 0, track_stock = true): RestockProduct =>
  ({ id, name: `P-${id}`, unit: 'und', stock: 10, min_stock, track_stock, locations })
const loc = (location_id: number, qty: number | null, is_primary = false) => ({ location_id, code: `L${location_id}`, is_primary, qty })

test('estante agotado con cantidad en el depósito: para reponer', () => {
  const c = restockCandidates([prod('a', [loc(E1, 0, true), loc(D1, 6)])], depots)
  assert.equal(c.length, 1)
  assert.equal(c[0].shelf.location_id, E1)
  assert.equal(c[0].depot.location_id, D1)
  assert.equal(c[0].depotQty, 6)
  assert.equal(suggestedMove(c[0]), 6)   // sin mínimo: todo lo del depósito
})

test('con mínimo: repone cuando el estante está en el mínimo o menos y propone llegar al doble', () => {
  const [c] = restockCandidates([prod('a', [loc(E1, 2, true), loc(D1, 20)], 3)], depots)
  assert.equal(c.shelfQty, 2)
  assert.equal(suggestedMove(c), 4)
  assert.equal(restockCandidates([prod('a', [loc(E1, 4, true), loc(D1, 20)], 3)], depots).length, 0)
})

test('no propone más de lo que hay en el depósito', () => {
  const [c] = restockCandidates([prod('a', [loc(E1, 0, true), loc(D1, 2)], 5)], depots)
  assert.equal(suggestedMove(c), 2)
})

test('no son para reponer: depósito vacío, sin estante, estante sin contar, servicios', () => {
  assert.equal(restockCandidates([
    prod('a', [loc(E1, 0, true), loc(D1, 0)]),
    prod('b', [loc(D1, 5, true)]),
    prod('c', [loc(E1, null, true), loc(D1, 5)]),
    prod('d', [loc(E1, 0, true), loc(D1, 5)], 0, false),
  ], depots).length, 0)
})

test('el destino es la principal de la tienda aunque la principal del producto sea el depósito', () => {
  const [c] = restockCandidates([prod('a', [loc(D1, 5, true), loc(E1, 0), loc(E2, 0)])], depots)
  assert.equal(c.shelf.location_id, E1)
})

test('ubicar lo recibido: a la principal o, sin ubicación, al depósito', () => {
  const products = new Map([
    ['a', { locations: [loc(E1, 3, true)] }],
    ['b', { locations: [] }],
  ])
  const lines = [{ product_id: 'a', qty: 10 }, { product_id: 'b', qty: 4 }, { product_id: 'c', qty: 0 }]
  assert.deepEqual(placementItems(lines, products, 'principal', D1), [
    { product_id: 'a', qty: 10, to_location_id: E1 },
    { product_id: 'b', qty: 4, to_location_id: D1 },
  ])
  assert.deepEqual(placementItems(lines, products, 'deposito', D1).map(i => i.to_location_id), [D1, D1])
})
