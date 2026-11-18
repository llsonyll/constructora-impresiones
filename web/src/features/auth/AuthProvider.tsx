import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { authLink, supabase } from '@/lib/supabase'
import type { Profile } from '@/types/domain'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Llegó desde el enlace de «recuperar contraseña»: hay que pedir la contraseña nueva antes de entrar. */
  recovering: boolean
  /** Termina la recuperación (contraseña cambiada) y deja pasar a la app. */
  endRecovery: () => void
  /** Cierra la sesión correctamente; no dispara el aviso de expiración. */
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState>({
  session: null, profile: null, loading: true, recovering: false, endRecovery: () => {}, signOut: async () => {},
})
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Pick<AuthState, 'session' | 'profile' | 'loading'>>({
    session: null, profile: null, loading: true,
  })
  const [recovering, setRecovering] = useState(authLink.type === 'recovery')
  const endRecovery = useCallback(() => setRecovering(false), [])
  // wasSignedIn: había sesión activa antes del último cambio de estado.
  // isManualSignOut: el cierre lo inició el usuario (no expiración automática).
  const wasSignedIn = useRef(false)
  const isManualSignOut = useRef(false)

  const signOut = useCallback(async () => {
    isManualSignOut.current = true
    setRecovering(false)
    await supabase.auth.signOut()
  }, [])

  useEffect(() => {
    const load = async (session: Session | null) => {
      if (!session) {
        if (wasSignedIn.current && !isManualSignOut.current) {
          toast.warning('Tu sesión expiró. Iniciá sesión de nuevo.')
        }
        wasSignedIn.current = false
        isManualSignOut.current = false
        return setData({ session: null, profile: null, loading: false })
      }
      wasSignedIn.current = true
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      setData({ session, profile: (data as Profile) ?? null, loading: false })
    }
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      void load(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [signOut])

  return <Ctx.Provider value={{ ...data, recovering, endRecovery, signOut }}>{children}</Ctx.Provider>
}
