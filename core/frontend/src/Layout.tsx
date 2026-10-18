import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import SyncStatusDot from './SyncStatusDot'
import { logout } from './auth'
import { useHasPermission } from './AuthContext'
import { useSyncStatus } from './useSyncStatus'
import type { ModuleDescriptor, NavItem } from './ModuleDescriptor'

export default function Layout({
  children,
  moduleKey,
  title,
  navItems,
  historyPermission,
  sync,
  onLoggedOut,
}: {
  children: ReactNode
  moduleKey: string
  title: string
  navItems: NavItem[]
  historyPermission: string
  sync: ModuleDescriptor['sync']
  onLoggedOut: () => void
}) {
  const canManageUsers = useHasPermission('core:users:manage')
  const canViewHistory = useHasPermission(historyPermission)
  const { status, error, pending } = useSyncStatus(sync)

  return (
    <div data-module={moduleKey} className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-2">
          <NavLink to="/dashboard" className="rounded px-1 py-1 text-lg active:bg-gray-100" title="Zur Übersicht">
            🏠
          </NavLink>
          <span className="text-lg font-bold text-brand-800">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <SyncStatusDot status={status} error={error} pending={pending} onSync={() => void sync.syncNow()} />
          <NavLink to="/import" className="rounded px-2 py-1 text-lg active:bg-gray-100" title="Daten importieren">
            📥
          </NavLink>
          {canViewHistory && (
            <NavLink to="verlauf" className="rounded px-2 py-1 text-lg active:bg-gray-100">
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

      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">{children}</main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-20 grid border-t bg-white pb-[env(safe-area-inset-bottom,0px)]"
        style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === ''}
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
