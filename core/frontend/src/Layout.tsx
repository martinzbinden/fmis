import { useEffect, useReducer, useState, type ReactNode } from 'react'
import ImportButton from './ImportButton'
import { Link, NavLink, matchPath, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import SyncStatusDot from './SyncStatusDot'
import ProfileMenu from './ProfileMenu'
import SidePanel, { PanelButton } from './SidePanel'
import { useHasPermission } from './AuthContext'
import AdminMenu from './AdminMenu'
import NotificationBell from './NotificationBell'
import { useSyncStatus } from './useSyncStatus'
import type { ModuleDescriptor, NavItem } from './ModuleDescriptor'
import { FOOTER_SLOT_ID } from './FooterBar'
import UndoBar from './UndoBar'
import { NAV_EVENT, navIsActive, resolveNav } from './navItems'
import { SearchButton } from './GlobalSearch'
import { openPanel } from './headerPanel'
import { LockButton } from './StallLock'
import { useStallMode } from './stallMode'
import { recordRecent, type FunctionEntry } from './search'
import AppIcon from './AppIcon'

export default function Layout({
  children,
  moduleKey,
  title,
  icon,
  functions,
  navItems,
  pageTitles,
  historyPermission,
  sync,
  onLoggedOut,
  history,
}: {
  children: ReactNode
  moduleKey: string
  title: string
  /** Symbol des Moduls (für «zuletzt geöffnet» in der Suche) */
  icon?: string
  /** Funktionen des Moduls (Symbole für «zuletzt geöffnet») */
  functions?: FunctionEntry[]
  navItems: NavItem[]
  pageTitles?: Record<string, string>
  historyPermission: string
  sync: ModuleDescriptor['sync']
  onLoggedOut: () => void
  /** Verlauf des Moduls (Route «verlauf»), erscheint im Seitenfenster 📜 */
  history?: ReactNode
}) {
  const canViewHistory = useHasPermission(historyPermission)
  const canImport = useHasPermission('core:import:write')
  const { status, error, pending } = useSyncStatus(sync)
  useScrollTopOnNavigate()
  const page = usePageTitle(moduleKey, title, navItems, pageTitles)
  // dynamische Punkte (NavItem.resolve) bei jedem Rendern und nach notifyNavChanged() neu lesen
  const [, refreshNav] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener(NAV_EVENT, refreshNav)
    return () => window.removeEventListener(NAV_EVENT, refreshNav)
  }, [])
  const location = useLocation()
  const { pathname } = location
  const navigate = useNavigate()
  const rest = pathname.slice(moduleKey.length + 1).replace(/^\/|\/$/g, '')
  const shownNav = resolveNav(navItems)
  // Seiten mit wenig Platz (z.B. Milchwägung) blenden die Kopfzeile beim Hinunterscrollen aus und beim Hinaufscrollen
  // wieder ein: sie setzen dafür document.body.dataset.autohideHeader = 'on'
  const [headerHidden, setHeaderHidden] = useState(false)
  useEffect(() => {
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (document.body.dataset.autohideHeader !== 'on' || y < 40) setHeaderHidden(false)
      else if (y > last + 4) setHeaderHidden(true)
      else if (y < last - 4) setHeaderHidden(false)
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => setHeaderHidden(false), [pathname])
  const stall = useStallMode()
  // Seite für «zuletzt geöffnet» (Suche, Mehr) merken; der Verlauf ist kein Ziel
  useEffect(() => {
    if (!page || rest === 'verlauf') return
    // Symbol: eigene Funktion des Moduls, sonst der Menüpunkt genau dieser Seite (nicht über `also`), sonst das Modul
    const base = (to: string) => to.split('?')[0]
    const fn = functions?.find((f) => !f.to.startsWith('/') && base(f.to) === rest)
    const nav = navItems.find((n) => !n.resolve && n.to === rest)
    recordRecent({ path: pathname, title: page, sub: title, icon: fn?.icon ?? nav?.icon ?? icon })
    // nur beim Seitenwechsel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, page])

  return (
    <div data-module={moduleKey} className="flex min-h-screen flex-col bg-gray-50">
      {/* Am Handy (375 px) muss alles in eine Zeile passen: Titel kürzt sich, Abmelden
          gibt es dort auf der Übersicht (🏠) statt hier. */}
      {/* Tastatur: über Kopfzeile und Menü direkt zum Inhalt (erscheint erst beim ersten Tab) */}
      <a href="#inhalt" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-brand-800 focus:shadow-lg">
        Zum Inhalt springen
      </a>
      <header data-app-header className={`sticky top-0 z-20 flex items-center transition-transform duration-200 ${headerHidden ? '-translate-y-full' : ''} justify-between gap-1 border-b bg-white px-2 pb-1 pt-[calc(0.25rem+env(safe-area-inset-top,0px))] sm:px-3`}>
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <NavLink to="/dashboard" className="grid min-h-12 min-w-10 shrink-0 place-items-center rounded-full text-xl active:bg-gray-100 sm:min-w-12" title="Zur Übersicht" aria-label="Zur Übersicht">
            <AppIcon icon="home" size={30} />
          </NavLink>
          {/* Modul klein (führt zu dessen Startseite), darunter die Seite — auch
              nach einem Link aus einer anderen Seite sieht man, wo man ist */}
          <div className="min-w-0 leading-tight">
            <NavLink to={`/${moduleKey}`} end className="-my-1.5 block truncate py-1.5 text-xs font-semibold text-brand-700">
              {title}
            </NavLink>
            <span className="block truncate text-base font-bold text-gray-800">{page ?? title}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center sm:gap-1">
          <SyncStatusDot status={status} error={error} pending={pending} onSync={() => void sync.syncNow()} />
          <SearchButton />
          {stall && <LockButton />}
          {canImport && !stall && (
            <ImportButton className="hidden min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100 sm:grid" />
          )}
          {canViewHistory && history && !stall && (
            // Seitenfenster wie Status, Import und Benachrichtigungen; nochmals antippen schliesst
            <PanelButton panel="verlauf" label="Verlauf" className="hidden sm:grid">
              📜
            </PanelButton>
          )}
          {!stall && <NotificationBell />}
          {!stall && <AdminMenu />}
          <ProfileMenu onLoggedOut={onLoggedOut} onHistory={canViewHistory && history ? () => openPanel('verlauf') : undefined} />
        </div>
      </header>
      {canViewHistory && history && (
        <SidePanel panel="verlauf" title="Verlauf">
          {/* die Verlaufsseite bringt ihren eigenen Titel und Rand mit: hier trägt das Fenster den Titel */}
          <div className="-m-4 [&>div>h1:first-child]:sr-only [&>div]:pb-4">{history}</div>
        </SidePanel>
      )}

      {/* Ab Desktop-Breite (lg) steht das Menü links statt unten, unter der Kopfzeile (57 px) */}
      <main id="inhalt" tabIndex={-1} className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] outline-none lg:pl-52">
        {children}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-20 lg:left-52">
        {/* «Gespeichert · Rückgängig» nach jeder Eingabe (core/undo.ts) */}
        <UndoBar />
        {/* Platz für laufende Zwischenstände über dem Menü (core/FooterBar.tsx) */}
        <div id={FOOTER_SLOT_ID} />
        <nav
          className="grid border-t bg-white pb-[env(safe-area-inset-bottom,0px)] lg:fixed lg:bottom-0 lg:left-0 lg:top-[57px] lg:!flex lg:w-52 lg:flex-col lg:gap-0.5 lg:border-r lg:border-t-0 lg:px-2 lg:pt-4"
          style={{ gridTemplateColumns: `repeat(${shownNav.length}, minmax(0, 1fr))` }}
        >
          {shownNav.map((item) => {
            const isActive = navIsActive(rest, item)
            return (
              <Link
                key={item.label}
                to={item.to}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-w-0 flex-col items-center justify-center gap-0.5 py-2 text-[11px] sm:text-xs lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:py-2.5 lg:text-sm ${
                  isActive ? 'text-brand-700 font-semibold lg:bg-brand-50' : 'text-gray-500 lg:hover:bg-gray-50'
                }`}
              >
                <AppIcon icon={item.icon} size={26} muted={!isActive} />
                <span className="max-w-full truncate px-0.5">{item.label}</span>
              </Link>
            )
          })}
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
