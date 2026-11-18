// npm test (node --test). Acceso: lectura del enlace del correo y mensajes de error.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authErrorMessage, newPasswordError, parseAuthHash } from './messages.ts'

// ---------- parseAuthHash ----------

test('parseAuthHash: sin hash o con ruta de HashRouter no es un enlace de correo', () => {
  assert.deepEqual(parseAuthHash(''), { type: null, error: null })
  assert.deepEqual(parseAuthHash('#'), { type: null, error: null })
  assert.deepEqual(parseAuthHash('#/ventas'), { type: null, error: null })
  assert.deepEqual(parseAuthHash('#/proveedores/ordenes/abc?type=recovery'), { type: null, error: null })
})

test('parseAuthHash: enlace de recuperar contraseña', () => {
  const h = '#access_token=eyJ&expires_at=1&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'
  assert.deepEqual(parseAuthHash(h), { type: 'recovery', error: null })
})

test('parseAuthHash: enlace de confirmar cuenta', () => {
  assert.deepEqual(parseAuthHash('#access_token=eyJ&type=signup'), { type: 'signup', error: null })
})

test('parseAuthHash: enlace vencido', () => {
  const h = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
  assert.deepEqual(parseAuthHash(h), { type: null, error: 'El enlace del correo venció o ya se usó. Pide uno nuevo.' })
})

test('parseAuthHash: otro error muestra la descripción', () => {
  const h = '#error=server_error&error_description=Algo+raro'
  assert.equal(parseAuthHash(h).error, 'El enlace del correo no funcionó: Algo raro')
})

test('parseAuthHash: parámetros sin token ni error se ignoran', () => {
  assert.deepEqual(parseAuthHash('#type=recovery'), { type: null, error: null })
})

// ---------- authErrorMessage ----------

test('authErrorMessage: credenciales incorrectas, por código o por texto', () => {
  assert.equal(authErrorMessage({ message: 'x', code: 'invalid_credentials' }), 'Correo o contraseña incorrectos')
  assert.equal(authErrorMessage({ message: 'Invalid login credentials' }), 'Correo o contraseña incorrectos')
})

test('authErrorMessage: correo ya registrado y contraseña débil', () => {
  assert.match(authErrorMessage({ message: 'User already registered' }), /ya tiene cuenta/)
  assert.match(authErrorMessage({ message: 'Password should be at least 6 characters.' }), /muy débil/)
})

test('authErrorMessage: límite de correos', () => {
  assert.match(authErrorMessage({ message: 'email rate limit exceeded', status: 429 }), /demasiados correos/)
  assert.match(authErrorMessage({ message: 'x', code: 'over_email_send_rate_limit' }), /demasiados correos/)
})

test('authErrorMessage: registro desactivado', () => {
  assert.match(authErrorMessage({ message: 'Signups not allowed for this instance' }), /registro está desactivado/)
})

test('authErrorMessage: lo desconocido se muestra tal cual', () => {
  assert.equal(authErrorMessage({ message: 'Failed to fetch' }), 'No se pudo conectar: Failed to fetch')
})

// ---------- newPasswordError ----------

test('newPasswordError: largo mínimo y coincidencia', () => {
  assert.match(newPasswordError('corta', 'corta') ?? '', /al menos 8/)
  assert.equal(newPasswordError('suficiente', 'suficientE'), 'Las contraseñas no coinciden.')
  assert.equal(newPasswordError('suficiente', 'suficiente'), null)
})
