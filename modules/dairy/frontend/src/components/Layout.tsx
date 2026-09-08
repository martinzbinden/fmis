import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import SyncStatusDot from './SyncStatusDot'
import { logout } from '../db/auth'
import { useHasPermission } from '../db/AuthContext'

const navItems = [
  { to: '/', label: 'Milch', icon: '🥛' },
  { to: '/kuehe', label: 'Kühe', icon: '🐄' },
]

export default function Layout({
  children,
  onLoggedOut,
}: {
  children: ReactNode
  onLoggedOut: () => void
}) {
  const canManageUsers = useHasPermission('users:manage')
  const canViewHistory = useHasPermission('history:read')

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-4 py-3">
        <span className="text-lg font-bold text-brand-800">Milchleistung</span>
        <div className="flex items-center gap-1">
          <SyncStatusDot />
          {canViewHistory && (
            <NavLink to="/verlauf" className="rounded px-2 py-1 text-lg active:bg-gray-100">
              📜
            </NavLink>
          )}
          {canManageUsers && (
            <NavLink to="/admin" className="rounded px-2 py-1 text-lg active:bg-gray-100">
              ⚙️
            </NavLink>
          )}
          <button
            type="button"
            onClick={() => {
              logout()
              onLoggedOut()
            }}
            className="rounded px-2 py-1 text-xs text-gray-500 active:bg-gray-100"
          >
            Abmelden
          </button>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 grid grid-cols-2 border-t bg-white">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 py-2 text-xs ${
                isActive ? 'text-brand-700 font-semibold' : 'text-gray-500'
              }`
            }
          >
            <span className="text-xl leading-none">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
