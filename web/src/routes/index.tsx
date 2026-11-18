import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import { useAuth } from '@/features/auth/AuthProvider'
import LoginPage from '@/features/auth/LoginPage'
import ResetPasswordPage from '@/features/auth/ResetPasswordPage'
import PosPage from '@/features/pos/PosPage'
import { CartsProvider } from '@/features/pos/useCart'
import TodayPage from '@/features/sales/TodayPage'
import ReportsPage from '@/features/sales/ReportsPage'
import CashPage from '@/features/cash/CashPage'
import InventoryPage from '@/features/inventory/InventoryPage'
import StockCountPage from '@/features/inventory/StockCountPage'
import PricingPage from '@/features/inventory/PricingPage'
import SynonymsPage from '@/features/inventory/SynonymsPage'
import AssortmentPage from '@/features/inventory/AssortmentPage'
import LabelsPage from '@/features/labels/LabelsPage'
import LocationsPage from '@/features/locations/LocationsPage'
import ProvidersPage from '@/features/providers/ProvidersPage'
import PurchaseOrderPage from '@/features/providers/PurchaseOrderPage'
import PurchaseOrderPdfPage from '@/features/providers/PurchaseOrderPdfPage'
import DocumentsPage from '@/features/documents/DocumentsPage'
import DocumentPage from '@/features/documents/DocumentPage'
import QuoteEditorPage from '@/features/documents/QuoteEditorPage'
import ActivityPage from '@/features/activity/ActivityPage'
import AgendaPage from '@/features/agenda/AgendaPage'
import type { Role } from '@/types/domain'
import type { ReactNode } from 'react'

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 p-10 text-center">
      <p className="font-semibold text-stone-700">Página no encontrada.</p>
      <p className="text-sm text-stone-500">La dirección que ingresaste no existe.</p>
      <Link to="/" className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white">
        Ir al inicio
      </Link>
    </div>
  )
}

/** Cuenta creada desde la pantalla de acceso, que un admin aún no activa en *profiles*. */
function PendingApproval() {
  const { session, signOut } = useAuth()
  return (
    <div className="grid min-h-dvh place-items-center bg-stone-100 p-4">
      <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 text-center shadow">
        <h1 className="text-xl font-semibold">La Constructora</h1>
        <p className="text-stone-700">Tu cuenta está pendiente de aprobación por un administrador.</p>
        <p className="text-sm text-stone-500">{session?.user.email}</p>
        <button onClick={() => void signOut()} className="min-h-12 w-full rounded-lg border font-medium text-stone-700">
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

/** Oculta pantallas a roles sin permiso (la protección real de datos es RLS). */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth()
  return profile && roles.includes(profile.role) ? <>{children}</> : <Navigate to="/" replace />
}

// HashRouter: no requiere fallback de SPA (GitHub Pages). Con Vercel/Netlify se puede cambiar a BrowserRouter.
export default function AppRoutes() {
  const { session, profile, loading, recovering } = useAuth()
  if (loading) return <p className="p-6">Cargando…</p>
  if (!session) return <LoginPage />
  if (recovering) return <ResetPasswordPage />
  if (!profile?.active) return <PendingApproval />

  return (
    <CartsProvider>
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to={profile.role === 'almacen' ? '/inventario' : '/ventas'} replace />} />
          <Route path="ventas" element={<RequireRole roles={['admin', 'cajero']}><PosPage /></RequireRole>} />
          <Route path="hoy" element={<RequireRole roles={['admin', 'cajero']}><TodayPage /></RequireRole>} />
          <Route path="caja" element={<RequireRole roles={['admin', 'cajero']}><CashPage /></RequireRole>} />
          <Route path="reportes" element={<RequireRole roles={['admin']}><ReportsPage /></RequireRole>} />
          <Route path="agenda" element={<RequireRole roles={['admin', 'cajero', 'almacen']}><AgendaPage /></RequireRole>} />
          <Route path="actividad" element={<RequireRole roles={['admin']}><ActivityPage /></RequireRole>} />
          <Route path="inventario" element={<RequireRole roles={['admin', 'almacen']}><InventoryPage /></RequireRole>} />
          <Route path="inventario/conteo" element={<RequireRole roles={['admin', 'almacen']}><StockCountPage /></RequireRole>} />
          <Route path="inventario/precios" element={<RequireRole roles={['admin', 'almacen']}><PricingPage /></RequireRole>} />
          <Route path="inventario/surtido" element={<RequireRole roles={['admin', 'almacen']}><AssortmentPage /></RequireRole>} />
          <Route path="inventario/etiquetas" element={<RequireRole roles={['admin', 'almacen']}><LabelsPage /></RequireRole>} />
          <Route path="inventario/sinonimos" element={<RequireRole roles={['admin', 'almacen']}><SynonymsPage /></RequireRole>} />
          <Route path="inventario/ubicaciones" element={<RequireRole roles={['admin', 'cajero', 'almacen']}><LocationsPage /></RequireRole>} />
          <Route path="proveedores" element={<RequireRole roles={['admin', 'almacen']}><ProvidersPage /></RequireRole>} />
          <Route path="proveedores/ordenes/:id" element={<RequireRole roles={['admin', 'almacen']}><PurchaseOrderPage /></RequireRole>} />
          <Route path="proveedores/ordenes/:id/pdf" element={<RequireRole roles={['admin', 'almacen']}><PurchaseOrderPdfPage /></RequireRole>} />
          <Route path="documentos" element={<RequireRole roles={['admin', 'cajero']}><DocumentsPage /></RequireRole>} />
          <Route path="documentos/cotizacion/nueva" element={<RequireRole roles={['admin', 'cajero']}><QuoteEditorPage /></RequireRole>} />
          <Route path="documentos/:id" element={<RequireRole roles={['admin', 'cajero']}><DocumentPage /></RequireRole>} />
          <Route path="documentos/:id/editar" element={<RequireRole roles={['admin', 'cajero']}><QuoteEditorPage /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
    </CartsProvider>
  )
}
