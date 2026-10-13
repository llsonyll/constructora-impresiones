import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) return setError('')
    // Solo "Invalid login credentials" es contraseña mala; lo demás (red, config) se muestra tal cual.
    setError(error.message.includes('Invalid login credentials')
      ? 'Correo o contraseña incorrectos'
      : `No se pudo conectar: ${error.message}`)
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-stone-100 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">La Constructora</h1>
        <input className="min-h-12 w-full rounded-lg border px-3 text-base" type="email" placeholder="Correo" value={email}
               autoComplete="username" autoCapitalize="none" enterKeyHint="next" aria-label="Correo"
               onChange={e => setEmail(e.target.value)} required />
        <input className="min-h-12 w-full rounded-lg border px-3 text-base" type="password" placeholder="Contraseña" value={password}
               autoComplete="current-password" enterKeyHint="go" aria-label="Contraseña"
               onChange={e => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="min-h-12 w-full rounded-lg bg-amber-700 font-medium text-white">Ingresar</button>
      </form>
    </div>
  )
}
