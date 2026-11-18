// Lógica pura del acceso: leer lo que Supabase deja en la URL al volver de un correo (confirmar cuenta,
// recuperar contraseña) y traducir sus errores al español del negocio. Sin dependencias: se prueba con node --test.

export interface AuthHashInfo {
  /** `recovery` (recuperar contraseña), `signup` (confirmar cuenta), etc.; null si la URL no viene de un correo. */
  type: string | null
  /** Mensaje listo para mostrar si el enlace falló (vencido, ya usado…). */
  error: string | null
}

/**
 * Lee el `#access_token=…&type=recovery` o el `#error=…&error_code=…` con que Supabase redirige desde el correo.
 * La app usa HashRouter, así que un hash de rutas (`#/ventas`) no es de Supabase y se ignora.
 */
export function parseAuthHash(hash: string): AuthHashInfo {
  const raw = hash.replace(/^#/, '')
  if (!raw || raw.startsWith('/')) return { type: null, error: null }
  const p = new URLSearchParams(raw)
  if (!p.has('access_token') && !p.has('error') && !p.has('error_code')) return { type: null, error: null }
  const code = p.get('error_code') ?? p.get('error')
  return {
    type: p.get('type'),
    error: code ? linkErrorMessage(code, p.get('error_description')) : null,
  }
}

function linkErrorMessage(code: string, description: string | null): string {
  if (code === 'otp_expired') return 'El enlace del correo venció o ya se usó. Pide uno nuevo.'
  if (code === 'access_denied') return 'El enlace del correo no es válido. Pide uno nuevo.'
  return `El enlace del correo no funcionó: ${description ?? code}`
}

/** Traduce los errores de Supabase Auth que puede ver la persona en la pantalla de acceso. */
export function authErrorMessage(err: { message: string; status?: number; code?: string }): string {
  const m = err.message.toLowerCase()
  const code = err.code ?? ''
  if (code === 'invalid_credentials' || m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos'
  if (code === 'email_not_confirmed' || m.includes('email not confirmed'))
    return 'Falta confirmar el correo: abre el enlace que te enviamos.'
  if (code === 'user_already_exists' || m.includes('already registered'))
    return 'Ese correo ya tiene cuenta. Ingresa o recupera tu contraseña.'
  if (code === 'weak_password' || m.includes('password should be'))
    return 'La contraseña es muy débil: usa al menos 8 caracteres.'
  if (code === 'same_password' || m.includes('different from the old'))
    return 'La contraseña nueva debe ser distinta de la anterior.'
  if (code === 'signup_disabled' || m.includes('signups not allowed'))
    return 'El registro está desactivado. Pide a un administrador que te cree la cuenta.'
  if (err.status === 429 || code.includes('rate_limit') || m.includes('rate limit'))
    return 'Se enviaron demasiados correos. Espera unos minutos e inténtalo de nuevo.'
  if (code === 'email_address_invalid' || m.includes('invalid format') || m.includes('is invalid'))
    return 'El correo no es válido.'
  return `No se pudo conectar: ${err.message}`
}

/** Largo mínimo que la app pide para una contraseña nueva (Supabase acepta desde 6). */
export const MIN_PASSWORD = 8

/** Valida la contraseña nueva y su repetición; devuelve el error a mostrar o null si está bien. */
export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`
  if (password !== confirm) return 'Las contraseñas no coinciden.'
  return null
}
