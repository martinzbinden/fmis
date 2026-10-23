import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import SyncStatusDot from './SyncStatusDot'
import { logout } from './auth'
import { useHasPermission } from './AuthContext'
import AdminMenu from './AdminMenu'
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
  const canViewHistory = useHasPermission(historyPermission)
  const canImport = useHasPermission('core:import:write')
  const { status, error, pending } = useSyncStatus(sync)

  return (
    <div data-module={moduleKey} className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-3 pb-1 pt-[calc(0.25rem+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-2">
          <NavLink to="/dashboard" className="grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100" title="Zur Übersicht">
            🏠
          </NavLink>
          <span className="text-lg font-bold text-brand-800">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <SyncStatusDot status={status} error={error} pending={pending} onSync={() => void sync.syncNow()} />
          {canImport && (
            <NavLink to="/import" className="hidden min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100 sm:grid" title="Daten importieren">
              📥
            </NavLink>
          )}
          {canViewHistory && (
            <NavLink to="verlauf" className="grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100">
              📜
            </NavLink>
          )}
          <AdminMenu />
          <button
            type="button"
            onClick={() => {
              logout()
              onLoggedOut()
            }}
            title="Abmelden"
            aria-label="Abmelden"
            className="grid min-h-12 min-w-12 place-items-center rounded-full text-xs text-gray-600 active:bg-gray-100 sm:px-3"
          >
            <span aria-hidden className="text-xl sm:hidden">🚪</span>
            <span className="hidden sm:inline">Abmelden</span>
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
