// npm test (node --test). Fechas de la agenda: addDays, addMonths, diffDays y eventDates.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, addMonths, diffDays, eventDates, nthDate } from './agenda.ts'

// ---------- addDays ----------

test('addDays: cero devuelve la misma fecha', () => {
  assert.equal(addDays('2026-06-15', 0), '2026-06-15')
})

test('addDays: suma días cruzando mes y año', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01')
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('addDays: resta días', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
})

// ---------- addMonths ----------

test('addMonths: mes normal, día conservado', () => {
  assert.equal(addMonths('2026-01-15', 1),  '2026-02-15')
  assert.equal(addMonths('2026-01-15', 12), '2027-01-15')
})

test('addMonths: día 31 en meses cortos cae en el último día (regla del negocio)', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'enero→febrero')
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31', 'enero→marzo sigue siendo 31')
  assert.equal(addMonths('2026-01-31', 3), '2026-04-30', 'enero→abril')
  assert.equal(addMonths('2026-01-31', 4), '2026-05-31', 'enero→mayo')
})

test('addMonths: día 29 en febrero no bisiesto → 28', () => {
  assert.equal(addMonths('2026-01-29', 1), '2026-02-28', '2026 no es bisiesto')
})

test('addMonths: día 29 en febrero bisiesto → 29', () => {
  assert.equal(addMonths('2028-01-29', 1), '2028-02-29', '2028 es bisiesto')
})

test('addMonths: parámetro day ancla el día original en la serie mensual', () => {
  // La serie del 31 pasa day=31 para que febrero no quede anclado en 28
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31')
  assert.equal(addMonths('2026-02-28', 2, 31), '2026-04-30')
})

// ---------- diffDays ----------

test('diffDays: misma fecha = 0', () => {
  assert.equal(diffDays('2026-06-01', '2026-06-01'), 0)
})

test('diffDays: diferencia positiva y negativa', () => {
  assert.equal(diffDays('2026-01-01', '2026-01-08'),  7)
  assert.equal(diffDays('2026-01-08', '2026-01-01'), -7)
})

test('diffDays: cruza cambio de mes sin desfase', () => {
  assert.equal(diffDays('2026-01-31', '2026-02-01'), 1)
  assert.equal(diffDays('2026-02-28', '2026-03-01'), 1)
})

// ---------- eventDates: evento de una sola vez ----------

test('eventDates: una sola vez, dentro del rango', () => {
  const ev = { start_date: '2026-06-15', repeat_unit: null, repeat_every: 1, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-01-01', '2026-12-31'), [{ date: '2026-06-15', index: 1 }])
})

test('eventDates: una sola vez, fuera del rango → vacío', () => {
  const ev = { start_date: '2026-06-15', repeat_unit: null, repeat_every: 1, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-07-01', '2026-12-31'), [])
})

// ---------- eventDates: repetición semanal ----------

test('eventDates: semanal, fechas e índices consecutivos', () => {
  const ev = { start_date: '2026-01-05', repeat_unit: 'week' as const, repeat_every: 1, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-01-05', '2026-01-19'), [
    { date: '2026-01-05', index: 1 },
    { date: '2026-01-12', index: 2 },
    { date: '2026-01-19', index: 3 },
  ])
})

test('eventDates: semanal cada 2 semanas', () => {
  const ev = { start_date: '2026-01-05', repeat_unit: 'week' as const, repeat_every: 2, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-01-05', '2026-02-02'), [
    { date: '2026-01-05', index: 1 },
    { date: '2026-01-19', index: 2 },
    { date: '2026-02-02', index: 3 },
  ])
})

test('eventDates: semanal desde el pasado, índice correcto en ventana actual', () => {
  // La 1.ª ocurrencia es 2026-01-05; la ventana empieza en la 2.ª
  const ev = { start_date: '2026-01-05', repeat_unit: 'week' as const, repeat_every: 1, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-01-12', '2026-01-19'), [
    { date: '2026-01-12', index: 2 },
    { date: '2026-01-19', index: 3 },
  ])
})

// ---------- eventDates: repetición mensual ----------

test('eventDates: mensual, fechas e índices correctos', () => {
  const ev = { start_date: '2026-01-15', repeat_unit: 'month' as const, repeat_every: 1, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-01-01', '2026-04-30'), [
    { date: '2026-01-15', index: 1 },
    { date: '2026-02-15', index: 2 },
    { date: '2026-03-15', index: 3 },
    { date: '2026-04-15', index: 4 },
  ])
})

test('eventDates: mensual día 31 → último día del mes corto (regla del negocio)', () => {
  const ev = { start_date: '2026-01-31', repeat_unit: 'month' as const, repeat_every: 1, repeat_until: null }
  const result = eventDates(ev, '2026-01-01', '2026-05-31')
  assert.deepEqual(result.map(r => r.date), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
  ])
})

test('eventDates: mensual, índice correcto cuando la ventana empieza después del inicio', () => {
  // Pago mensual desde enero; vemos solo abril → debe ser la 4.ª cuota
  const ev = { start_date: '2026-01-15', repeat_unit: 'month' as const, repeat_every: 1, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-04-01', '2026-04-30'), [
    { date: '2026-04-15', index: 4 },
  ])
})

test('eventDates: mensual cada 3 meses', () => {
  const ev = { start_date: '2026-01-01', repeat_unit: 'month' as const, repeat_every: 3, repeat_until: null }
  const result = eventDates(ev, '2026-01-01', '2026-12-31')
  assert.deepEqual(result.map(r => r.date), [
    '2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01',
  ])
})

// ---------- eventDates: repetición anual ----------

test('eventDates: anual, tres años seguidos', () => {
  const ev = { start_date: '2026-03-15', repeat_unit: 'year' as const, repeat_every: 1, repeat_until: null }
  assert.deepEqual(eventDates(ev, '2026-01-01', '2028-12-31'), [
    { date: '2026-03-15', index: 1 },
    { date: '2027-03-15', index: 2 },
    { date: '2028-03-15', index: 3 },
  ])
})

// ---------- eventDates: repeat_until y series de N veces ----------

test('eventDates: repeat_until limita la serie inclusive', () => {
  const ev = { start_date: '2026-01-01', repeat_unit: 'month' as const, repeat_every: 1, repeat_until: '2026-03-01' }
  const result = eventDates(ev, '2026-01-01', '2026-12-31')
  assert.deepEqual(result.map(r => r.date), ['2026-01-01', '2026-02-01', '2026-03-01'])
})

test('eventDates: serie de N veces — nthDate calcula el repeat_until correcto', () => {
  const evBase = { start_date: '2026-04-01', repeat_unit: 'month' as const, repeat_every: 1 }
  const until = nthDate(evBase, 3)
  assert.equal(until, '2026-06-01', 'la 3.ª cuota cae el 1 de junio')
  const ev = { ...evBase, repeat_until: until }
  const result = eventDates(ev, '2026-01-01', '2026-12-31')
  assert.equal(result.length, 3)
  assert.deepEqual(result.map(r => r.date), ['2026-04-01', '2026-05-01', '2026-06-01'])
})

test('eventDates: N veces con día 31 y meses cortos termina en exactamente N ocurrencias', () => {
  // 4 cuotas mensuales desde enero 31: ene 31, feb 28, mar 31, abr 30
  const evBase = { start_date: '2026-01-31', repeat_unit: 'month' as const, repeat_every: 1 }
  const until = nthDate(evBase, 4)
  assert.equal(until, '2026-04-30', 'la 4.ª cuota cae el 30 de abril')
  const ev = { ...evBase, repeat_until: until }
  const result = eventDates(ev, '2026-01-01', '2026-12-31')
  assert.equal(result.length, 4)
  assert.deepEqual(result.map(r => r.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
})

test('eventDates: N veces semanal — termina en N ocurrencias', () => {
  const evBase = { start_date: '2026-02-02', repeat_unit: 'week' as const, repeat_every: 1 }
  const until = nthDate(evBase, 4) // 4 semanas: 02, 09, 16, 23 feb
  assert.equal(until, '2026-02-23')
  const ev = { ...evBase, repeat_until: until }
  const result = eventDates(ev, '2026-01-01', '2026-12-31')
  assert.equal(result.length, 4)
  assert.deepEqual(result.map(r => r.date), ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'])
})
