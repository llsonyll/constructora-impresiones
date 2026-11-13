// npm test (node --test). Búsqueda por medidas: pernos, tornillos, tirafones.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, productMatcher, rankBy } from './search.ts'

const catalog = [
  'PERNO HEXAGONAL ZINCADO PILLKO 1/2 X 1.1/2"',
  'PERNO HEXAGONAL ZINCADO PILLKO 1/2 X 1"',
  'PERNO HEXAGONAL ZINCADO PILLKO 1/4 X 1.1/2" SIN TUERCA',
  'PERNO HEXAGONAL ZINCADO PILLKO 3/8 X2"',
  'PERNO HEXAGONAL ZINCADO PILLKO 3/8 X2.1/2"',
  'PERNO HEXAGONAL ZINCADO PILLKO 3/8 X 1/2"',
  'PERNO HEXAGONAL ZINCADO PILLKO 5/16 X 1"',
  'TIRAFON P/BROCA 8X1 1/2"',
  'CABLE 12 AWG',
].map((name, i) => ({ name, sku: `FER-${String(120 + i).padStart(5, '0')}` }))

const find = (q: string) => rankBy(catalog, productMatcher(q)!).map(p => p.name)

test('normalize: medidas en una sola forma', () => {
  assert.equal(normalize('PERNO 3/8x2"'), 'perno 3/8 x 2')
  assert.equal(normalize('3/8 X2.1/2"'), '3/8 x 2.1/2')
  assert.equal(normalize('8X 1 1/2"'), '8 x 1.1/2')
  assert.equal(normalize('1-1/2 GL'), '1.1/2 gl')
  assert.equal(normalize('Tubería 4.8 kg'), 'tuberia 4.8 kg')
})

test('diámetro x largo, escrito de cualquier forma', () => {
  const both = ['PERNO HEXAGONAL ZINCADO PILLKO 3/8 X2"', 'PERNO HEXAGONAL ZINCADO PILLKO 3/8 X2.1/2"']
  assert.deepEqual(find('perno 3/8x2'), both)        // el exacto (2") primero
  assert.deepEqual(find('perno 3/8 x 2'), both)
  assert.deepEqual(find('perno 3/8 2"'), both)
  for (const q of ['perno 1/4 x 1 1/2', 'perno 1/4 x 1-1/2', 'perno 1/4 x 1.1/2'])
    assert.deepEqual(find(q), ['PERNO HEXAGONAL ZINCADO PILLKO 1/4 X 1.1/2" SIN TUERCA'], q)
  assert.deepEqual(find('tirafon 8x1 1/2'), ['TIRAFON P/BROCA 8X1 1/2"'])
})

test('un número no se encuentra dentro de otra medida', () => {
  // "1" no es 1/2" ni 12; sí 1" (primero) y 1 1/2".
  assert.deepEqual(find('perno 1/2 x 1'), ['PERNO HEXAGONAL ZINCADO PILLKO 1/2 X 1"', 'PERNO HEXAGONAL ZINCADO PILLKO 1/2 X 1.1/2"'])
  assert.deepEqual(find('cable 12'), ['CABLE 12 AWG'])
  assert.deepEqual(find('5/1'), ['PERNO HEXAGONAL ZINCADO PILLKO 5/16 X 1"'])   // escribiendo 5/16
})

test('códigos de 4+ cifras se siguen buscando en cualquier parte', () => {
  assert.deepEqual(find('00125'), ['PERNO HEXAGONAL ZINCADO PILLKO 3/8 X 1/2"'])
})
