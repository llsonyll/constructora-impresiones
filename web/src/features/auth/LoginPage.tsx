import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setError(error ? 'Correo o contraseña incorrectos' : '')
  }

  return (
    <div className="min-h-screen grid place-items-center bg-stone-100 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">La Constructora</h1>
        <input className="w-full rounded border p-2" type="email" placeholder="Correo" value={email}
               onChange={e => setEmail(e.target.value)} required />
        <input className="w-full rounded border p-2" type="password" placeholder="Contraseña" value={password}
               onChange={e => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-amber-700 p-2 font-medium text-white">Ingresar</button>
      </form>
    </div>
  )
}
