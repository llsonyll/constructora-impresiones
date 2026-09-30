import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { refreshCatalog, startAutoSync } from '@/features/pos/sync'
import AppRoutes from '@/routes'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

/** Con sesión activa: refresca el catálogo local y sincroniza la cola de ventas. */
function Sync() {
  const { session } = useAuth()
  useEffect(() => {
    if (!session) return
    refreshCatalog().catch(() => { /* offline: se usa la caché local */ })
    return startAutoSync(() => { refreshCatalog().catch(() => {}) })
  }, [session])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider><Sync /><AppRoutes /></AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
