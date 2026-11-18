import { useState, type FormEvent } from 'react'
import { Toaster, toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthProvider'
import PasswordInput from './PasswordInput'
import { MIN_PASSWORD, authErrorMessage, newPasswordError } from './messages'

/** Se abre al llegar desde el enlace de «recuperar contraseña»: pide la nueva antes de entrar a la app. */
export default function ResetPasswordPage() {
  const { session, endRecovery, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const invalid = newPasswordError(password, confirm)
    if (invalid) return setError(invalid)
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(authErrorMessage(error))
    toast.success('Contraseña cambiada.')
    endRecovery()
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-stone-100 p-4">
      <Toaster position="bottom-center" richColors toastOptions={{ duration: 4000 }} />
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 shadow">
        <div>
          <h1 className="text-xl font-semibold">La Constructora</h1>
          <p className="text-sm text-stone-600">Contraseña nueva para {session?.user.email}</p>
        </div>
        {/* Campo de usuario oculto: así el gestor de contraseñas del navegador guarda la nueva con su correo. */}
        <input type="email" value={session?.user.email ?? ''} autoComplete="username" readOnly hidden />
        <PasswordInput placeholder={`Contraseña nueva (mín. ${MIN_PASSWORD})`} value={password}
                       autoComplete="new-password" enterKeyHint="next" aria-label="Contraseña nueva"
                       minLength={MIN_PASSWORD} onChange={e => setPassword(e.target.value)} required autoFocus />
        <PasswordInput placeholder="Repite la contraseña" value={confirm} autoComplete="new-password" enterKeyHint="go"
                       aria-label="Repite la contraseña" onChange={e => setConfirm(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white disabled:opacity-60">
          {busy ? 'Guardando…' : 'Guardar contraseña'}
        </button>
        <button type="button" onClick={() => void signOut()}
                className="w-full p-2 text-center text-sm text-amber-800 hover:underline">
          Cancelar
        </button>
      </form>
    </div>
  )
}
