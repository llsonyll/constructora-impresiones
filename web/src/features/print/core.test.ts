// npm test (node --test). Lógica de impresiones: qué productos ofrecer por trabajo y reparto de hojas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  productosParaJob, cambiarHojas, cambiarPrecio, totalReparto, lineasDeReparto,
  type Job, type ProductoImpresion, type Reparto, COPIA, PRINT,
} from './core.ts'

// ---------- Fixtures ----------

const jobBN: Job    = { id: 'j1', fuente: COPIA, hojas: 5, color: false }
const jobColor: Job = { id: 'j2', fuente: COPIA, hojas: 5, color: true }
const jobPrint: Job = { id: 'j3', fuente: PRINT, hojas: 10, color: false }

// Precios en fracciones exactas de base 2 para evitar error de punto flotante en los asserts.
const fotoBN: ProductoImpresion   = { id: 'FBN',  nombre: 'Fotocopia B/N',    precio: 0.50, activo: true,  origenes: [COPIA], color: false }
const fotoCol: ProductoImpresion  = { id: 'FCOL', nombre: 'Fotocopia Color',  precio: 2.00, activo: true,  origenes: [COPIA], color: true  }
const fotoA3: ProductoImpresion   = { id: 'FA3',  nombre: 'Fotocopia A3',     precio: 1.00, activo: true,  origenes: [COPIA], color: null  }
const printBN: ProductoImpresion  = { id: 'PBN',  nombre: 'Impresión B/N',    precio: 0.75, activo: true,  origenes: [PRINT], color: false }
const printCol: ProductoImpresion = { id: 'PCOL', nombre: 'Impresión Color',  precio: 1.50, activo: true,  origenes: [PRINT], color: true  }
const duplex: ProductoImpresion   = { id: 'DUP',  nombre: 'Fotocopia Dúplex', precio: 0.75, activo: true,  origenes: [COPIA], color: false, duplex: true }
const kw: ProductoImpresion       = { id: 'KW',   nombre: 'Plano A3',         precio: 2.00, activo: true,  origenes: [COPIA], color: null,  palabrasClave: ['plano', 'arquitectura'] }
const inactivo: ProductoImpresion = { id: 'INA',  nombre: 'Servicio viejo',   precio: 0.25, activo: false, origenes: [COPIA] }

const catalogo: ProductoImpresion[] = [fotoBN, fotoCol, fotoA3, printBN, printCol, duplex, kw, inactivo]

// ---------- productosParaJob ----------

test('productosParaJob: Konica B/N incluye null-color, excluye color e inactivos', () => {
  const ids = productosParaJob(jobBN, catalogo).map(r => r.p.id)
  assert.ok(ids.includes('FBN'),  'B/N incluido')
  assert.ok(ids.includes('FA3'),  'null-color incluido')
  assert.ok(ids.includes('DUP'),  'dúplex B/N incluido')
  assert.ok(!ids.includes('FCOL'), 'color excluido en Konica B/N')
  assert.ok(!ids.includes('INA'),  'inactivo excluido')
  assert.ok(!ids.includes('PBN'),  'origen PRINT no aparece en trabajo de Konica')
})

test('productosParaJob: Konica Color excluye B/N', () => {
  const ids = productosParaJob(jobColor, catalogo).map(r => r.p.id)
  assert.ok(ids.includes('FCOL'), 'color incluido')
  assert.ok(ids.includes('FA3'),  'null-color incluido')
  assert.ok(!ids.includes('FBN'), 'B/N excluido en Konica Color')
})

test('productosParaJob: PaperCut muestra todos sus productos sin filtrar por color', () => {
  const ids = productosParaJob(jobPrint, catalogo).map(r => r.p.id)
  assert.ok(ids.includes('PBN'),  'B/N de print incluido')
  assert.ok(ids.includes('PCOL'), 'color de print incluido aunque job sea B/N')
  assert.ok(!ids.includes('FBN'), 'fotocopia (origen COPIA) no aparece en print')
})

test('productosParaJob: keyword en nombre del documento marca como sugerido y lo ordena primero', () => {
  const jobConDoc: Job = { ...jobBN, documento: 'plano_arquitectura.pdf' }
  const result = productosParaJob(jobConDoc, catalogo)
  const posKW  = result.findIndex(r => r.p.id === 'KW')
  assert.ok(posKW >= 0, 'producto con keyword encontrado')
  assert.ok(result[posKW].sug, 'marcado como sugerido')
  // Todos los que están antes también deben ser sugeridos
  for (let i = 0; i < posKW; i++)
    assert.ok(result[i].sug, `posición ${i} debe ser sugerido si está antes que KW`)
  assert.equal(result[0].p.id, 'KW', 'sugerido por keyword aparece primero')
})

test('productosParaJob: duplex match → sugerido primero', () => {
  const jobDuplex: Job = { ...jobBN, duplex: true }
  const result = productosParaJob(jobDuplex, catalogo)
  const duplexEntry = result.find(r => r.p.id === 'DUP')
  assert.ok(duplexEntry?.sug, 'dúplex marcado como sugerido')
  assert.equal(result[0].p.id, 'DUP', 'sugerido por dúplex aparece primero')
})

// ---------- cambiarHojas ----------

test('cambiarHojas: asigna hojas a un producto nuevo en reparto vacío', () => {
  const r1 = cambiarHojas(jobBN, {}, 'FBN', 3)
  assert.deepEqual(r1, { FBN: { qty: 3 } })
})

test('cambiarHojas: exactamente el límite del trabajo se permite', () => {
  const r0: Reparto = { FBN: { qty: 3 } }
  const r1 = cambiarHojas(jobBN, r0, 'FA3', 2) // 3+2 = 5 = job.hojas
  assert.ok(r1 !== null, 'debe permitirse llegar al límite exacto')
  assert.equal(r1!.FA3.qty, 2)
})

test('cambiarHojas: superar el límite devuelve null', () => {
  const r0: Reparto = { FBN: { qty: 3 } }
  assert.equal(cambiarHojas(jobBN, r0, 'FA3', 3), null) // 3+3=6 > 5
})

test('cambiarHojas: total lleno, agregar cualquier hoja devuelve null', () => {
  const r0: Reparto = { FBN: { qty: 5 } }
  assert.equal(cambiarHojas(jobBN, r0, 'FBN', 1), null)
})

test('cambiarHojas: restar hojas nunca baja de cero', () => {
  const r0: Reparto = { FBN: { qty: 2 } }
  const r1 = cambiarHojas(jobBN, r0, 'FBN', -10)
  assert.ok(r1 !== null)
  assert.equal(r1!.FBN.qty, 0)
})

test('cambiarHojas: restar pasa aunque el reparto esté al máximo', () => {
  const r0: Reparto = { FBN: { qty: 5 } }
  const r1 = cambiarHojas(jobBN, r0, 'FBN', -2)
  assert.ok(r1 !== null)
  assert.equal(r1!.FBN.qty, 3)
})

// ---------- cambiarPrecio ----------

test('cambiarPrecio: fija un precio puntual para esta venta', () => {
  const r0: Reparto = { FBN: { qty: 3 } }
  const r1 = cambiarPrecio(r0, 'FBN', '0.25')
  assert.equal(r1.FBN.precio, 0.25)
})

test('cambiarPrecio: acepta coma como separador decimal', () => {
  const r0: Reparto = { FBN: { qty: 3 } }
  const r1 = cambiarPrecio(r0, 'FBN', '0,25')
  assert.equal(r1.FBN.precio, 0.25)
})

test('cambiarPrecio: string vacío elimina el precio puntual (vuelve al catálogo)', () => {
  const r0: Reparto = { FBN: { qty: 3, precio: 0.25 } }
  const r1 = cambiarPrecio(r0, 'FBN', '')
  assert.equal(r1.FBN.precio, undefined)
})

test('cambiarPrecio: texto inválido elimina el precio puntual', () => {
  const r0: Reparto = { FBN: { qty: 3, precio: 0.25 } }
  const r1 = cambiarPrecio(r0, 'FBN', 'abc')
  assert.equal(r1.FBN.precio, undefined)
})

test('cambiarPrecio: negativo elimina el precio puntual', () => {
  const r0: Reparto = { FBN: { qty: 3, precio: 0.25 } }
  const r1 = cambiarPrecio(r0, 'FBN', '-1')
  assert.equal(r1.FBN.precio, undefined)
})

test('cambiarPrecio: no afecta otros productos del reparto', () => {
  const r0: Reparto = { FBN: { qty: 3 }, FA3: { qty: 2, precio: 0.75 } }
  const r1 = cambiarPrecio(r0, 'FBN', '0.25')
  assert.equal(r1.FA3.precio, 0.75)
})

// ---------- totalReparto ----------

test('totalReparto: reparto vacío = 0', () => {
  assert.equal(totalReparto({}, [fotoBN, fotoA3]), 0)
})

test('totalReparto: usa precio del catálogo', () => {
  const r: Reparto = { FBN: { qty: 2 }, FA3: { qty: 3 } }
  // 2*0.50 + 3*1.00 = 1.00 + 3.00 = 4.00
  assert.equal(totalReparto(r, [fotoBN, fotoA3]), 4)
})

test('totalReparto: usa precio puntual cuando está fijado', () => {
  const r: Reparto = { FBN: { qty: 4, precio: 0.25 } }
  // 4*0.25 = 1.00
  assert.equal(totalReparto(r, [fotoBN]), 1)
})

test('totalReparto: producto con qty=0 no suma', () => {
  const r: Reparto = { FBN: { qty: 0 }, FA3: { qty: 2 } }
  assert.equal(totalReparto(r, [fotoBN, fotoA3]), 2)
})

// ---------- lineasDeReparto ----------

test('lineasDeReparto: solo incluye productos con qty > 0 que existen en el catálogo', () => {
  const r: Reparto = {
    FBN:     { qty: 3 },
    FA3:     { qty: 0 },       // qty=0 → no aparece
    PHANTOM: { qty: 2 },       // no está en catálogo → ignorado
  }
  const { lineas } = lineasDeReparto(jobBN, r, [fotoBN, fotoA3])
  assert.equal(lineas.length, 1)
  assert.equal(lineas[0].producto.id, 'FBN')
  assert.equal(lineas[0].qty, 3)
})

test('lineasDeReparto: resto son hojas sin asignar del trabajo', () => {
  const r: Reparto = { FBN: { qty: 3 } }
  const { usadas, resto } = lineasDeReparto(jobBN, r, [fotoBN])
  assert.equal(usadas, 3)
  assert.equal(resto, 2) // job.hojas=5 − 3
})

test('lineasDeReparto: resto nunca es negativo', () => {
  // Defensivo: no debería pasar si se usa cambiarHojas, pero la función es robusta.
  const jobPequeno: Job = { ...jobBN, hojas: 2 }
  const r: Reparto = { FBN: { qty: 5 } }
  const { resto } = lineasDeReparto(jobPequeno, r, [fotoBN])
  assert.equal(resto, 0)
})

test('lineasDeReparto: mismoPrecio según si hay precio puntual', () => {
  const r: Reparto = { FBN: { qty: 2 }, FA3: { qty: 1, precio: 0.75 } }
  const { lineas } = lineasDeReparto(jobBN, r, [fotoBN, fotoA3])
  const lBN = lineas.find(l => l.producto.id === 'FBN')!
  const lA3 = lineas.find(l => l.producto.id === 'FA3')!
  assert.ok(lBN.mismoPrecio,  'sin precio puntual → mismoPrecio=true')
  assert.ok(!lA3.mismoPrecio, 'con precio puntual → mismoPrecio=false')
})

test('lineasDeReparto: precio en la línea refleja el precio puntual', () => {
  const r: Reparto = { FA3: { qty: 2, precio: 0.75 } }
  const { lineas } = lineasDeReparto(jobBN, r, [fotoA3])
  assert.equal(lineas[0].precio, 0.75)
})
