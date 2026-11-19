// npm test (node --test). Etiquetas de precio: reparto en hojas y textos.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { amount, brandLine, isFormat, nameTier, paginate, perPage, presentationText, unitText } from './labels.ts'

test('paginate repite según las copias y corta por hoja', () => {
  const items = [{ data: 'a', copies: 5 }, { data: 'b', copies: 8 }, { data: 'c', copies: 1 }]
  assert.equal(perPage('ancha'), 12)
  assert.equal(perPage('nombre'), 12)
  assert.equal(perPage('angosta'), 18)
  assert.equal(perPage('chica'), 30)
  assert.ok(isFormat('chica') && isFormat('ancha') && isFormat('nombre') && !isFormat('otra') && !isFormat(null) && !isFormat('toString'))
  const pages = paginate(items, 12)
  assert.equal(pages.length, 2)
  assert.deepEqual(pages[0], [...'aaaaa', ...'bbbbbbb'])
  assert.deepEqual(pages[1], ['b', 'c'])
  assert.equal(paginate(items, 18).length, 1)
  assert.deepEqual(paginate([], 12), [])
  assert.equal(paginate([{ data: 'x', copies: 12 }], 12).length, 1)
})

test('unitText', () => {
  assert.equal(unitText('und'), 'c/u')
  assert.equal(unitText('m'), 'el metro')
  assert.equal(unitText('galón'), 'el galón')
  assert.equal(unitText('ciento'), 'x ciento')
})

test('amount sin el símbolo', () => {
  assert.equal(amount(12.5), '12.50')
  assert.equal(amount(0.3), '0.30')
  assert.equal(amount(1250), '1,250.00')
})

test('brandLine no repite la marca que ya está en el nombre', () => {
  assert.equal(brandLine('ESMALTE CPP 1/4 GL BLANCO', 'CPP'), null)
  assert.equal(brandLine('SILICONA TRANSPARENTE', 'Sika'), 'Sika')
  assert.equal(brandLine('TUBERÍA PAVCO', 'PAVCO'), null)
  assert.equal(brandLine('CINTA', null), null)
  assert.equal(brandLine('CINTA', '  '), null)
})

test('presentationText y nameTier', () => {
  assert.equal(presentationText({ name: 'Docena', qty: 12 }, 'und'), 'Docena (12)')
  assert.equal(presentationText({ name: 'Bolsa', qty: 5 }, 'kg'), 'Bolsa (5 kg)')
  assert.equal(nameTier('CLAVO 2"'), 0)
  assert.equal(nameTier('x'.repeat(60)), 1)
  assert.equal(nameTier('x'.repeat(100)), 2)
})
