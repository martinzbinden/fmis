import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import SyncStatusDot from './SyncStatusDot'
import { logout } from './auth'
import { useHasPermission } from './AuthContext'
import AdminMenu from './AdminMenu'
import NotificationBell from './NotificationBell'
import { useSyncStatus } from './useSyncStatus'
import type { ModuleDescriptor, NavItem } from './ModuleDescriptor'
import { FOOTER_SLOT_ID } from './FooterBar'

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
      {/* Am Handy (375 px) muss alles in eine Zeile passen: Titel kürzt sich, Abmelden
          gibt es dort auf der Übersicht (🏠) statt hier. */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-1 border-b bg-white px-2 pb-1 pt-[calc(0.25rem+env(safe-area-inset-top,0px))] sm:px-3">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <NavLink to="/dashboard" className="grid min-h-12 min-w-12 shrink-0 place-items-center rounded-full text-xl active:bg-gray-100" title="Zur Übersicht" aria-label="Zur Übersicht">
            🏠
          </NavLink>
          <span className="truncate text-base font-bold text-brand-800 sm:text-lg">{title}</span>
        </div>
        <div className="flex shrink-0 items-center sm:gap-1">
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
          <NotificationBell />
          <AdminMenu />
          <button
            type="button"
            onClick={() => {
              logout()
              onLoggedOut()
            }}
            title="Abmelden"
            aria-label="Abmelden"
            className="hidden min-h-12 min-w-12 place-items-center rounded-full px-3 text-xs text-gray-600 active:bg-gray-100 sm:grid"
          >
            Abmelden
          </button>
        </div>
      </header>

      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">{children}</main>

      <div className="fixed bottom-0 left-0 right-0 z-20">
        {/* Platz für laufende Zwischenstände über dem Menü (core/FooterBar.tsx) */}
        <div id={FOOTER_SLOT_ID} />
        <nav
          className="grid border-t bg-white pb-[env(safe-area-inset-bottom,0px)]"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === ''}
              className={({ isActive }) =>
                `flex min-w-0 flex-col items-center justify-center gap-0.5 py-2 text-[11px] sm:text-xs ${
                  isActive ? 'text-brand-700 font-semibold' : 'text-gray-500'
                }`
              }
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span className="max-w-full truncate px-0.5">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
