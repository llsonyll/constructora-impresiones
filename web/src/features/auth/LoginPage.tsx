import { useEffect, useState, type FormEvent } from 'react'
import { Toaster } from 'sonner'
import { authLink, authRedirectUrl, supabase } from '@/lib/supabase'
import PasswordInput from './PasswordInput'
import { MIN_PASSWORD, authErrorMessage, newPasswordError } from './messages'

type Mode = 'login' | 'signup' | 'forgot'

const TITLES: Record<Mode, string> = {
  login: 'Ingresar',
  signup: 'Crear cuenta',
  forgot: 'Recuperar contraseña',
}

const inputCls = 'min-h-12 w-full rounded-lg border px-3 text-base'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  // El error de un enlace vencido llega en la URL al volver del correo.
  const [error, setError] = useState(authLink.error ?? '')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // Quita el `#error=…` del enlace para que HashRouter no lo tome como una ruta.
  useEffect(() => {
    if (authLink.error) history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  function go(next: Mode) {
    setMode(next)
    setError('')
    setNotice('')
    setPassword('')
    setConfirm('')
  }

  async function login() {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(authErrorMessage(error))
  }

  async function signup() {
    const invalid = newPasswordError(password, confirm)
    if (invalid) return setError(invalid)
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: authRedirectUrl() },
    })
    if (error) return setError(authErrorMessage(error))
    // Con confirmación por correo activa, Supabase no dice que el correo ya existe: devuelve un usuario sin identidades.
    if (data.user && data.user.identities?.length === 0) {
      return setError('Ese correo ya tiene cuenta. Ingresa o recupera tu contraseña.')
    }
    // Con sesión, AuthProvider entra solo (a la app, o a «pendiente de aprobación»). Sin sesión, falta confirmar.
    if (!data.session) {
      setPassword('')
      setConfirm('')
      setNotice(`Te enviamos un correo a ${email}. Abre el enlace para confirmar tu cuenta; `
        + 'luego un administrador debe aprobarla.')
    }
  }

  async function forgot() {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() })
    if (error) return setError(authErrorMessage(error))
    // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
    setNotice(`Si ${email} tiene cuenta, te llegará un correo con un enlace para poner una contraseña nueva. `
      + 'Revisa también la carpeta de spam.')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await (mode === 'login' ? login() : mode === 'signup' ? signup() : forgot())
    } catch (err) {
      setError(authErrorMessage({ message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-stone-100 p-4">
      <Toaster position="bottom-center" richColors toastOptions={{ duration: 4000 }} />
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 shadow">
        <div>
          <h1 className="text-xl font-semibold">La Constructora</h1>
          {mode !== 'login' && <p className="text-sm text-stone-600">{TITLES[mode]}</p>}
        </div>

        {mode === 'forgot' && (
          <p className="text-sm text-stone-600">Escribe tu correo y te enviaremos un enlace para poner una contraseña nueva.</p>
        )}

        {mode === 'signup' && (
          <input className={inputCls} placeholder="Nombre y apellido" value={name} autoComplete="name"
                 enterKeyHint="next" aria-label="Nombre y apellido" onChange={e => setName(e.target.value)} required />
        )}

        <input className={inputCls} type="email" placeholder="Correo" value={email}
               autoComplete={mode === 'signup' ? 'email' : 'username'} autoCapitalize="none" aria-label="Correo"
               enterKeyHint={mode === 'forgot' ? 'send' : 'next'}
               onChange={e => setEmail(e.target.value)} required />

        {mode === 'login' && (
          <PasswordInput placeholder="Contraseña" value={password} autoComplete="current-password" enterKeyHint="go"
                         aria-label="Contraseña" onChange={e => setPassword(e.target.value)} required />
        )}

        {mode === 'signup' && (<>
          <PasswordInput placeholder={`Contraseña (mín. ${MIN_PASSWORD})`} value={password}
                         autoComplete="new-password" enterKeyHint="next" aria-label="Contraseña" minLength={MIN_PASSWORD}
                         onChange={e => setPassword(e.target.value)} required />
          <PasswordInput placeholder="Repite la contraseña" value={confirm} autoComplete="new-password" enterKeyHint="go"
                         aria-label="Repite la contraseña" onChange={e => setConfirm(e.target.value)} required />
        </>)}

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

        <button disabled={busy} className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white disabled:opacity-60">
          {busy ? 'Un momento…' : mode === 'login' ? 'Ingresar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>

        <div className="flex flex-col items-center gap-1 pt-1 text-sm">
          {mode === 'login' ? (<>
            <button type="button" onClick={() => go('forgot')} className="p-2 text-amber-800 hover:underline">
              ¿Olvidaste tu contraseña?
            </button>
            <button type="button" onClick={() => go('signup')} className="p-2 text-amber-800 hover:underline">
              ¿No tienes cuenta? Crear cuenta
            </button>
          </>) : (
            <button type="button" onClick={() => go('login')} className="p-2 text-amber-800 hover:underline">
              Volver a ingresar
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
