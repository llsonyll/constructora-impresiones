import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import { useAuth } from '@/features/auth/AuthProvider'
import LoginPage from '@/features/auth/LoginPage'
import PosPage from '@/features/pos/PosPage'

const Soon = ({ name }: { name: string }) => <p className="p-6 text-stone-500">{name}: pendiente</p>

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
          <Route path="ventas" element={<PosPage />} />
          <Route path="inventario" element={<Soon name="Inventario" />} />
          <Route path="proveedores" element={<Soon name="Proveedores" />} />
          <Route path="documentos" element={<Soon name="Documentos" />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
