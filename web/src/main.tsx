import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { refreshCatalog, startAutoSync } from '@/features/pos/sync'
import AppRoutes from '@/routes'
import ErrorBoundary from '@/components/ErrorBoundary'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
  queryCache: new QueryCache({
    onError: (_error, query) => {
      // Las queries que ya muestran el error inline marcan meta.silent = true.
      if (query.meta?.silent) return
      toast.error('No se pudo cargar la información. Intentá de nuevo.')
    },
  }),
})

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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider><Sync /><AppRoutes /></AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
