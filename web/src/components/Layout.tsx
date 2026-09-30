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
      <header className="flex items-center gap-4 bg-amber-800 px-4 py-2 text-white">
        <strong>La Constructora</strong>
        <nav className="flex flex-1 gap-3 text-sm">
          {NAV.filter(n => profile && n.roles.includes(profile.role)).map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'underline' : 'opacity-80'}>{n.label}</NavLink>
          ))}
        </nav>
        <span className="text-xs">{profile?.full_name} · {profile?.role}</span>
        <button className="text-xs underline" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <Outlet />
    </div>
  )
}
