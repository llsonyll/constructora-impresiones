import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Role } from '@/types/domain'

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: '/ventas', label: 'Ventas', roles: ['admin', 'cajero'] },
  { to: '/inventario', label: 'Inventario', roles: ['admin', 'almacen'] },
  { to: '/proveedores', label: 'Proveedores', roles: ['admin', 'almacen'] },
  { to: '/documentos', label: 'Documentos', roles: ['admin', 'cajero'] },
]

export default function Layout() {
  const { profile } = useAuth()
  return (
    <div className="min-h-screen bg-stone-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-amber-800 px-3 py-2 text-white md:px-4">
        <strong className="max-sm:hidden">La Constructora</strong>
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="La Constructora" className="h-7 w-7 sm:hidden" />
        <nav className="flex flex-1 gap-3 overflow-x-auto text-sm">
          {NAV.filter(n => profile && n.roles.includes(profile.role)).map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `shrink-0 py-1 ${isActive ? 'underline' : 'opacity-80'}`}>{n.label}</NavLink>
          ))}
        </nav>
        <span className="text-xs max-md:hidden">{profile?.full_name} · {profile?.role}</span>
        <button className="shrink-0 text-xs underline" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <Outlet />
    </div>
  )
}
