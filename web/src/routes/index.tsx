import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import { useAuth } from '@/features/auth/AuthProvider'
import LoginPage from '@/features/auth/LoginPage'
import PosPage from '@/features/pos/PosPage'
import InventoryPage from '@/features/inventory/InventoryPage'
import StockCountPage from '@/features/inventory/StockCountPage'
import type { Role } from '@/types/domain'
import type { ReactNode } from 'react'

const Soon = ({ name }: { name: string }) => <p className="p-6 text-stone-500">{name}: pendiente</p>

/** Oculta pantallas a roles sin permiso (la protección real de datos es RLS). */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth()
  return profile && roles.includes(profile.role) ? <>{children}</> : <Navigate to="/" replace />
}

// HashRouter: no requiere fallback de SPA (GitHub Pages). Con Vercel/Netlify se puede cambiar a BrowserRouter.
export default function AppRoutes() {
  const { session, profile, loading } = useAuth()
  if (loading) return <p className="p-6">Cargando…</p>
  if (!session) return <LoginPage />
  if (!profile?.active) return <p className="p-6">Tu cuenta está pendiente de aprobación por un administrador.</p>

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to={profile.role === 'almacen' ? '/inventario' : '/ventas'} replace />} />
          <Route path="ventas" element={<RequireRole roles={['admin', 'cajero']}><PosPage /></RequireRole>} />
          <Route path="inventario" element={<RequireRole roles={['admin', 'almacen']}><InventoryPage /></RequireRole>} />
          <Route path="inventario/conteo" element={<RequireRole roles={['admin', 'almacen']}><StockCountPage /></RequireRole>} />
          <Route path="proveedores" element={<Soon name="Proveedores" />} />
          <Route path="documentos" element={<Soon name="Documentos" />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
