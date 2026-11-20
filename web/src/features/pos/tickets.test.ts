// npm test (node --test). Tickets abiertos compartidos: edición local, guardado y mezcla con el servidor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_STATE, activeTicket, applyRemote, migrateLegacy, ticketTitle, ticketsOf, ticketsReducer, toSave,
  type RemoteTicket, type TicketsAction, type TicketsState,
} from './tickets.ts'

const clavo = { id: 'p-clavo', name: 'Clavo 2"', price: 0.5 }
const run = (s: TicketsState, ...actions: TicketsAction[]) => actions.reduce(ticketsReducer, s)
const add = (caja: 'ferreteria' | 'copias' = 'ferreteria'): TicketsAction =>
  ({ type: 'edit', caja, action: { type: 'addProduct', product: clavo }, me: 'Ana Quispe' })
const remote = (over: Partial<RemoteTicket> & { id: string }): RemoteTicket => ({
  caja: 'ferreteria', label: null, lines: [], quote: null, status: 'abierto', version: 1,
  created_by_name: 'Luis', updated_by_name: 'Luis', created_at: '2026-11-20T15:00:00Z', ...over,
})

test('editar sin ticket activo crea uno y lo deja con cambios por subir', () => {
  const s = run(EMPTY_STATE, add(), add())
  const t = activeTicket(s, 'ferreteria')!
  assert.equal(t.lines.length, 1)
  assert.equal(t.lines[0].qty, 2)
  assert.equal(t.version, 0)
  assert.ok(t.dirty)
  assert.equal(t.created_by_name, 'Ana Quispe')
  assert.deepEqual(toSave(s).map(x => x.id), [t.id])
})

test('«Nuevo» deja el anterior abierto y no acumula tickets vacíos', () => {
  const me = 'Ana'
  let s = run(EMPTY_STATE, add())
  const first = activeTicket(s, 'ferreteria')!.id
  s = run(s, { type: 'new', caja: 'ferreteria', me }, { type: 'new', caja: 'ferreteria', me })
  assert.equal(ticketsOf(s, 'ferreteria').length, 2)
  assert.notEqual(s.active.ferreteria, first)
  // Volver al primero tira el nuevo que quedó vacío.
  s = run(s, { type: 'select', caja: 'ferreteria', id: first })
  assert.equal(ticketsOf(s, 'ferreteria').length, 1)
  assert.equal(s.active.ferreteria, first)
})

test('un ticket nuevo vacío no se sube al servidor', () => {
  const s = run(EMPTY_STATE, { type: 'new', caja: 'copias', me: null })
  assert.equal(toSave(s).length, 0)
})

test('guardado: si se siguió editando mientras se guardaba, queda pendiente otro guardado', () => {
  let s = run(EMPTY_STATE, add())
  const t = activeTicket(s, 'ferreteria')!
  const sentRev = t.rev
  s = run(s, add())   // se editó durante el guardado
  s = run(s, { type: 'saved', id: t.id, rev: sentRev, row: remote({ id: t.id, version: 1 }) })
  const after = activeTicket(s, 'ferreteria')!
  assert.equal(after.version, 1)
  assert.ok(after.dirty)
  s = run(s, { type: 'saved', id: t.id, rev: after.rev, row: remote({ id: t.id, version: 2 }) })
  assert.equal(activeTicket(s, 'ferreteria')!.dirty, false)
})

test('llegan los tickets de otro equipo sin cambiar el ticket activo de este', () => {
  let s = run(EMPTY_STATE, add())
  const mine = s.active.ferreteria
  s = run(s, { type: 'remote', snapshot: true, rows: [remote({ id: 'otro', lines: [{ key: 'k', product_id: null, description: 'Arena', qty: 1, unit_price: 20 }] })] })
  assert.equal(ticketsOf(s, 'ferreteria').length, 2)
  assert.equal(s.active.ferreteria, mine)
})

test('versión más nueva del servidor gana; si había cambios locales se avisa', () => {
  let s = run(EMPTY_STATE, { type: 'remote', snapshot: true, rows: [remote({ id: 't1', version: 1 })] },
                           { type: 'select', caja: 'ferreteria', id: 't1' }, add())
  assert.ok(activeTicket(s, 'ferreteria')!.dirty)
  const r = applyRemote(s, [remote({ id: 't1', version: 2, label: 'Sr. del casco' })], false)
  assert.equal(r.overwritten.length, 1)
  const t = r.state.tickets.find(x => x.id === 't1')!
  assert.equal(t.label, 'Sr. del casco')
  assert.equal(t.dirty, false)
  // Una versión igual o vieja no pisa los cambios locales.
  const same = applyRemote(s, [remote({ id: 't1', version: 1 })], false)
  assert.equal(same.overwritten.length, 0)
  assert.ok(same.state.tickets.find(x => x.id === 't1')!.dirty)
})

test('el eco del propio guardado (Realtime antes que la respuesta) no cuenta como cambio de otro equipo', () => {
  const s = run(EMPTY_STATE, add())
  const id = s.active.ferreteria!
  const r = applyRemote(s, [remote({ id, version: 1 })], false, new Set([id]))
  assert.equal(r.overwritten.length, 0)
  assert.ok(r.state.tickets.find(x => x.id === id)!.dirty)
})

test('cobrado o descartado en otro equipo: desaparece de este y se avisa', () => {
  let s = run(EMPTY_STATE, { type: 'remote', snapshot: true, rows: [remote({ id: 't1' }), remote({ id: 't2' })] },
                           { type: 'select', caja: 'ferreteria', id: 't1' })
  const byEvent = applyRemote(s, [remote({ id: 't1', status: 'cobrado', version: 2 })], false)
  assert.deepEqual(byEvent.gone.map(t => t.id), ['t1'])
  assert.equal(byEvent.state.active.ferreteria, null)
  // En una consulta completa, el que ya no viene se cerró.
  const bySnapshot = applyRemote(s, [remote({ id: 't1' })], true)
  assert.deepEqual(bySnapshot.gone.map(t => t.id), ['t2'])
  // Los que nunca llegaron al servidor no se tocan.
  s = run(s, add('copias'))
  assert.equal(applyRemote(s, [], true).state.tickets.filter(t => t.caja === 'copias').length, 1)
})

test('lo que este equipo cerró no reaparece aunque el servidor aún lo muestre abierto', () => {
  let s = run(EMPTY_STATE, { type: 'remote', snapshot: true, rows: [remote({ id: 't1' })] },
                           { type: 'select', caja: 'ferreteria', id: 't1' })
  s = run(s, { type: 'close', id: 't1', discard: true })
  assert.equal(s.tickets.length, 0)
  assert.deepEqual(s.discards, ['t1'])
  s = run(s, { type: 'remote', snapshot: true, rows: [remote({ id: 't1' })] })
  assert.equal(s.tickets.length, 0)
  s = run(s, { type: 'discarded', id: 't1' })
  assert.deepEqual(s.discards, [])
})

test('cerrar un ticket que nunca se guardó no deja nada pendiente', () => {
  let s = run(EMPTY_STATE, { type: 'new', caja: 'ferreteria', me: null })
  s = run(s, { type: 'close', id: s.active.ferreteria!, discard: true })
  assert.deepEqual(s.discards, [])
  assert.deepEqual(s.closed, {})
})

test('el ticket de la versión anterior se convierte en un ticket por subir', () => {
  const s = migrateLegacy({ ferreteria: [{ key: 'k', product_id: 'p', description: 'Clavo', qty: 3, unit_price: 0.5 }], copias: [] },
                          { ferreteria: null, copias: null }, 'Ana')
  assert.equal(s.tickets.length, 1)
  assert.equal(s.active.ferreteria, s.tickets[0].id)
  assert.equal(toSave(s).length, 1)
})

test('título: etiqueta, cliente de la cotización o quién lo abrió y a qué hora (Lima)', () => {
  assert.equal(ticketTitle({ label: 'Maestro Juan', created_by_name: 'Ana', created_at: '2026-11-20T15:05:00Z' }), 'Maestro Juan')
  assert.equal(ticketTitle({ label: null, created_by_name: 'Ana', created_at: '2026-11-20T15:05:00Z',
                             quote: { id: 'q', label: 'COT-000004', customer_name: 'Ferrecons SAC', customer_doc: null } }), 'Ferrecons SAC')
  assert.equal(ticketTitle({ label: null, created_by_name: 'Ana Quispe', created_at: '2026-11-20T15:05:00Z' }), 'Ana 10:05')
})
