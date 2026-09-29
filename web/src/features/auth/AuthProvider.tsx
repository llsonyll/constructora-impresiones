import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/domain'

interface AuthState { session: Session | null; profile: Profile | null; loading: boolean }
const Ctx = createContext<AuthState>({ session: null, profile: null, loading: true })
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, profile: null, loading: true })

  useEffect(() => {
    const load = async (session: Session | null) => {
      if (!session) return setState({ session: null, profile: null, loading: false })
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      setState({ session, profile: (data as Profile) ?? null, loading: false })
    }
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { void load(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
