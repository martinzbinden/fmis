import { useEffect, type ReactNode } from 'react'
import { NavLink, matchPath, useLocation, useNavigationType } from 'react-router-dom'
import SyncStatusDot from './SyncStatusDot'
import { logout } from './auth'
import { useHasPermission } from './AuthContext'
import AdminMenu from './AdminMenu'
import NotificationBell from './NotificationBell'
import { useSyncStatus } from './useSyncStatus'
import type { ModuleDescriptor, NavItem } from './ModuleDescriptor'
import { FOOTER_SLOT_ID } from './FooterBar'
import UndoBar from './UndoBar'

export default function Layout({
  children,
  moduleKey,
  title,
  navItems,
  pageTitles,
  historyPermission,
  sync,
  onLoggedOut,
}: {
  children: ReactNode
  moduleKey: string
  title: string
  navItems: NavItem[]
  pageTitles?: Record<string, string>
  historyPermission: string
  sync: ModuleDescriptor['sync']
  onLoggedOut: () => void
}) {
  const canViewHistory = useHasPermission(historyPermission)
  const canImport = useHasPermission('core:import:write')
  const { status, error, pending } = useSyncStatus(sync)
  useScrollTopOnNavigate()
  const page = usePageTitle(moduleKey, title, navItems, pageTitles)

  return (
    <div data-module={moduleKey} className="flex min-h-screen flex-col bg-gray-50">
      {/* Am Handy (375 px) muss alles in eine Zeile passen: Titel kürzt sich, Abmelden
          gibt es dort auf der Übersicht (🏠) statt hier. */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-1 border-b bg-white px-2 pb-1 pt-[calc(0.25rem+env(safe-area-inset-top,0px))] sm:px-3">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <NavLink to="/dashboard" className="grid min-h-12 min-w-12 shrink-0 place-items-center rounded-full text-xl active:bg-gray-100" title="Zur Übersicht" aria-label="Zur Übersicht">
            🏠
          </NavLink>
          {/* Modul klein (führt zu dessen Startseite), darunter die Seite — auch
              nach einem Link aus einer anderen Seite sieht man, wo man ist */}
          <div className="min-w-0 leading-tight">
            <NavLink to={`/${moduleKey}`} end className="block truncate text-xs font-semibold text-brand-700">
              {title}
            </NavLink>
            <span className="block truncate text-base font-bold text-gray-800">{page ?? title}</span>
          </div>
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

      {/* Ab Desktop-Breite (lg) steht das Menü links statt unten, unter der Kopfzeile (57 px) */}
      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pl-52">{children}</main>

      <div className="fixed bottom-0 left-0 right-0 z-20 lg:left-52">
        {/* «Gespeichert · Rückgängig» nach jeder Eingabe (core/undo.ts) */}
        <UndoBar />
        {/* Platz für laufende Zwischenstände über dem Menü (core/FooterBar.tsx) */}
        <div id={FOOTER_SLOT_ID} />
        <nav
          className="grid border-t bg-white pb-[env(safe-area-inset-bottom,0px)] lg:fixed lg:bottom-0 lg:left-0 lg:top-[57px] lg:!flex lg:w-52 lg:flex-col lg:gap-0.5 lg:border-r lg:border-t-0 lg:px-2 lg:pt-4"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === ''}
              className={({ isActive }) =>
                `flex min-w-0 flex-col items-center justify-center gap-0.5 py-2 text-[11px] sm:text-xs lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:py-2.5 lg:text-sm ${
                  isActive ? 'text-brand-700 font-semibold lg:bg-brand-50' : 'text-gray-500 lg:hover:bg-gray-50'
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

/** Titel der aktuellen Seite: pageTitles des Moduls, sonst der passende
 * Menüpunkt der Fussleiste. Setzt auch den Titel des Browser-Tabs. */
function usePageTitle(moduleKey: string, moduleTitle: string, navItems: NavItem[], pageTitles?: Record<string, string>): string | null {
  const { pathname } = useLocation()
  const rest = pathname.slice(moduleKey.length + 1).replace(/^\/|\/$/g, '')
  let page: string | null = null
  for (const [pattern, t] of Object.entries(pageTitles ?? {})) {
    if (matchPath({ path: `/${pattern}`, end: true }, `/${rest}`)) {
      page = t
      break
    }
  }
  if (!page) {
    const nav = navItems
      .filter((n) => (n.to === '' ? rest === '' : rest === n.to || rest.startsWith(`${n.to}/`)))
      .sort((a, b) => b.to.length - a.to.length)[0]
    page = nav?.label ?? (rest === 'verlauf' ? 'Verlauf' : null)
  }
  useEffect(() => {
    document.title = `${page ? `${page} · ` : ''}${moduleTitle} · FMIS`
  }, [page, moduleTitle])
  return page
}

/** Neue Seite beginnt oben (sonst bleibt die Scrollhöhe der vorherigen und der
 * Titel ist abgeschnitten). Nicht beim Zurück-Gehen und nicht bei Sprungzielen
 * (#abschnitt, ?tier=), die selber scrollen. */
function useScrollTopOnNavigate(): void {
  const { pathname, hash } = useLocation()
  const type = useNavigationType()
  useEffect(() => {
    if (type !== 'POP' && !hash) window.scrollTo(0, 0)
    // nur beim Seitenwechsel, nicht bei jedem Rendern
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
}
