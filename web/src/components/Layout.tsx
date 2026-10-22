import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarDays, ChartColumn, Ellipsis, FileText, LogOut, MapPin, Package, ShoppingCart, Truck, Wallet, type LucideIcon } from 'lucide-react'
import { Toaster } from 'sonner'
import Sheet from '@/components/Sheet'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'
import type { Role } from '@/types/domain'

interface Section { to: string; label: string; icon: LucideIcon; roles: Role[] }

const SECTIONS: Section[] = [
  { to: '/ventas', label: 'Vender', icon: ShoppingCart, roles: ['admin', 'cajero'] },
  { to: '/hoy', label: 'Hoy', icon: CalendarDays, roles: ['admin', 'cajero'] },
  { to: '/caja', label: 'Caja', icon: Wallet, roles: ['admin', 'cajero'] },
  { to: '/reportes', label: 'Reportes', icon: ChartColumn, roles: ['admin'] },
  { to: '/inventario', label: 'Inventario', icon: Package, roles: ['admin', 'almacen'] },
  { to: '/inventario/ubicaciones', label: 'Ubicaciones', icon: MapPin, roles: ['admin', 'cajero', 'almacen'] },
  { to: '/proveedores', label: 'Proveedores', icon: Truck, roles: ['admin', 'almacen'] },
  { to: '/documentos', label: 'Documentos', icon: FileText, roles: ['admin', 'cajero'] },
]

/** Pestañas inferiores del celular: lo de todos los días de cada rol. El resto va en "Más". */
const TABS: Record<Role, string[]> = {
  cajero: ['/ventas', '/hoy', '/caja'],
  almacen: ['/inventario', '/inventario/ubicaciones', '/proveedores'],
  admin: ['/ventas', '/inventario', '/reportes'],
}

// Pantallas de una tarea con su propia barra de acciones abajo: ahí no van las pestañas.
const FOCUSED = [/^\/inventario\/(conteo|precios)/, /^\/proveedores\/ordenes\//]

/** Sección a la que pertenece la ruta: la de prefijo más largo (/inventario/precios → Inventario). */
const sectionOf = (path: string, list: Section[]) => list
  .filter(s => path === s.to || path.startsWith(`${s.to}/`))
  .sort((a, b) => b.to.length - a.to.length)[0]

const TOAST_OFFSET = {
  bottom: 'calc(5rem + var(--nav-h, 0px) + env(safe-area-inset-bottom))',
  top: 'calc(1rem + var(--header-h) + env(safe-area-inset-top))',
}

const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', cajero: 'Caja', almacen: 'Almacén' }

export default function Layout() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const mine = SECTIONS.filter(s => profile && s.roles.includes(profile.role))
  const tabs = profile ? TABS[profile.role].map(to => mine.find(s => s.to === to)!).filter(Boolean) : []
  const more = mine.filter(s => !tabs.includes(s))
  const current = sectionOf(pathname, mine)
  const showTabs = !FOCUSED.some(r => r.test(pathname))
  const closeMore = () => { setMoreOpen(false); setConfirmOut(false) }

  return (
    // --nav-h: alto de las pestañas inferiores; las barras flotantes (bottom-safe-*) se ponen encima.
    <div className={cn('min-h-dvh bg-stone-100', showTabs && '[--nav-h:3.5rem] md:[--nav-h:0px]')}>
      {/* Celular: sin barra superior; solo el color de la marca detrás de la hora y el notch. */}
      <div aria-hidden className="sticky top-0 z-10 h-[env(safe-area-inset-top)] bg-amber-800 md:hidden" />

      <header className="sticky top-0 z-10 flex items-center gap-3 bg-amber-800 pt-safe px-safe-3 text-white max-md:hidden">
        <strong>La Constructora</strong>
        <nav className="flex flex-1 gap-3 overflow-x-auto text-sm">
          {mine.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/inventario' && mine.some(s => s.to === '/inventario/ubicaciones')}
                     className={({ isActive }) => `flex min-h-11 shrink-0 items-center px-1 ${isActive ? 'underline' : 'opacity-80'}`}>{n.label}</NavLink>
          ))}
        </nav>
        <span className="text-xs">{profile?.full_name} · {profile?.role}</span>
        <button className="min-h-11 shrink-0 px-1 text-xs underline" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>

      <div className="pb-[var(--nav-h,0px)]">
        <Outlet />
      </div>

      {showTabs && (
        <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-white px-safe-3 pb-[env(safe-area-inset-bottom)] md:hidden">
          {tabs.map(t => {
            const active = current === t
            return (
              <Link key={t.to} to={t.to} aria-current={active ? 'page' : undefined}
                    className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'font-semibold text-amber-800' : 'text-stone-500')}>
                <t.icon className="size-6" strokeWidth={active ? 2.25 : 1.75} />{t.label}
              </Link>
            )
          })}
          <button onClick={() => setMoreOpen(true)} aria-haspopup="dialog"
                  className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
                                current && more.includes(current) ? 'font-semibold text-amber-800' : 'text-stone-500')}>
            <Ellipsis className="size-6" />Más
          </button>
        </nav>
      )}

      {moreOpen && (
        <Sheet onClose={closeMore} label="Más secciones" className="space-y-3 sm:max-w-sm">
          <div className="pt-1">
            <div className="font-semibold">{profile?.full_name}</div>
            <div className="text-sm text-stone-500">{profile && ROLE_LABEL[profile.role]}</div>
          </div>
          <ul className="divide-y rounded-xl border">
            {more.map(s => (
              <li key={s.to}>
                <Link to={s.to} replace onClick={closeMore} className="flex min-h-12 items-center gap-3 px-3">
                  <s.icon className="size-5 text-stone-500" />{s.label}
                </Link>
              </li>
            ))}
          </ul>
          {confirmOut ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmOut(false)} className="min-h-12 rounded-lg border">Cancelar</button>
              <button onClick={() => supabase.auth.signOut()} className="min-h-12 rounded-lg bg-red-600 font-medium text-white">Sí, salir</button>
            </div>
          ) : (
            <button onClick={() => setConfirmOut(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border text-red-700">
              <LogOut className="size-5" />Cerrar sesión
            </button>
          )}
        </Sheet>
      )}

      {/* Avisos abajo, sobre la barra del ticket y las pestañas: no tapan el buscador. */}
      <Toaster position="bottom-center" richColors toastOptions={{ duration: 2500 }}
               offset={TOAST_OFFSET} mobileOffset={TOAST_OFFSET} />
    </div>
  )
}
