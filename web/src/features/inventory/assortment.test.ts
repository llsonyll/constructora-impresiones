// npm test (node --test). Surtido: pernos y tornillos como tabla diámetro × largo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brandSet, buildLines, suggestName } from './assortment.ts'

const products = (names: string[]) =>
  names.map((name, i) => ({ id: String(i), name, brand: null, stock: 0, min_stock: 0, track_stock: true }))

const lines = buildLines(products([
  'PERNO HEXAGONAL ZINCADO PILLKO 1/2 X 1.1/2"',
  'PERNO HEXAGONAL ZINCADO PILLKO 1/2 X 1"',
  'PERNO HEXAGONAL ZINCADO PILLKO 1/4 X 2" SIN TUERCA',
  'PERNO HEXAGONAL ZINCADO PILLKO 3/8 X2"',
  'PERNO HEXAGONAL ZINCADO PILLKO 3/8 X2.1/2"',
  'PERNO HEXAGONAL ZINCADO PILLKO 5/16 X 3"',
  'TIRAFON P/BROCA 8X1 1/2"',
  'TIRAFON P/BROCA 8X2"',
  'PERNO HEXAGONAL M8 X 50 MM',
  'CABLE MELLIZO 2X14',
  'ESMALTE CRONS 1/4 GL AZUL',
]), brandSet([]))
const byName = (line: string) => lines.find(l => l.line === line)!

test('pernos: una sola tabla, diámetro (filas) × largo (columnas), en orden', () => {
  const l = byName('PERNO HEXAGONAL ZINCADO PILLKO')
  assert.equal(l.rows, 'diametro')
  assert.deepEqual(l.colors, ['1/4', '5/16', '3/8', '1/2'])                       // "SIN TUERCA" no separa la línea
  assert.deepEqual(l.sizes.map(s => s.label), ['1"', '1 1/2"', '2"', '2 1/2"', '3"'])  // X2" y 1.1/2 leídos igual
  assert.equal(l.products.length, 6)
})

test('tirafones con calibre y pernos métricos', () => {
  const t = byName('TIRAFON P/BROCA')
  assert.deepEqual([t.rows, t.colors, t.sizes.map(s => s.label)], ['diametro', ['8'], ['1 1/2"', '2"']])
  const m = byName('PERNO HEXAGONAL')
  assert.deepEqual([m.colors, m.sizes.map(s => s.label)], [['M8'], ['50 MM']])
})

test('lo que no es perno ni tornillo sigue igual', () => {
  assert.equal(byName('CABLE MELLIZO 2X14').rows, 'color')
  const e = byName('ESMALTE CRONS')
  assert.deepEqual([e.rows, e.colors, e.sizes.map(s => s.label)], ['color', ['AZUL'], ['1/4 GL']])
})

test('nombre para una medida que falta, copiando a los de la línea', () => {
  const l = byName('PERNO HEXAGONAL ZINCADO PILLKO')
  assert.equal(suggestName(l, '1/2', '2 1/2"').name, 'PERNO HEXAGONAL ZINCADO PILLKO 1/2 X 2 1/2"')
  assert.equal(suggestName(l, '1/4', '3"').name, 'PERNO HEXAGONAL ZINCADO PILLKO 1/4 X 3" SIN TUERCA')
  assert.equal(suggestName(byName('TIRAFON P/BROCA'), '8', '3"').name, 'TIRAFON P/BROCA 8 X 3"')
})
