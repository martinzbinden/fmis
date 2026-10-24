import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import AdminMenu from '@fmis/core/AdminMenu'
import NotificationBell from '@fmis/core/NotificationBell'
import { logout } from '@fmis/core/auth'
import type { ModuleDescriptor, ModuleGroup, QuickLink } from '@fmis/core/ModuleDescriptor'

// Reihenfolge der Übersicht: Dienste (Kachel) → Tiere → Maschinen & Betrieb → Weitere → Flächen
const GROUPS: { key: ModuleGroup | undefined; title: string }[] = [
  { key: 'tiere', title: 'Tiere' },
  { key: 'betrieb', title: 'Maschinen & Betrieb' },
  { key: undefined, title: 'Weitere' },
  { key: 'flaechen', title: 'Flächen' },
]

function QuickLinkIcon({ link }: { link: QuickLink }) {
  const allowed = useHasPermission(link.permission)
  if (!allowed) return null
  return (
    <Link to={link.to} className="grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100" title={link.title} aria-label={link.title}>
      {link.icon}
    </Link>
  )
}

export default function Dashboard({
  modules,
  onLoggedOut,
}: {
  modules: ModuleDescriptor[]
  onLoggedOut: () => void
}) {
  const canImport = useHasPermission('core:import:write')
  const tiles = (section: 'top' | 'maschinen') =>
    modules.flatMap((m) => (m.dashboardTiles ?? []).filter((t) => t.section === section).map(({ Tile }, i) => <Tile key={`${m.key}-${section}-${i}`} />))

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-4 py-3">
        <span className="text-lg font-bold text-brand-800">FMIS</span>
        <div className="flex items-center gap-1">
          {modules.flatMap((m) => (m.quickLinks ?? []).map((l) => <QuickLinkIcon key={`${m.key}-${l.to}`} link={l} />))}
          {canImport && (
            <Link to="/import" className="grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100" title="Daten importieren" aria-label="Daten importieren">
              📥
            </Link>
          )}
          <NotificationBell />
          <AdminMenu />
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

      <main className="mx-auto w-full max-w-md flex-1 p-4">
        {modules.length === 0 ? (
          <p className="mt-8 text-center text-sm text-gray-500">
            Keine Module aktiviert — bitte einen Admin kontaktieren.
          </p>
        ) : (
          <>
            {/* Heute: Dienste ganz oben (prüft Rechte selbst) */}
            {tiles('top')}
            {GROUPS.map((g) => {
              const list = modules.filter((m) => m.group === g.key)
              const extra = g.key === 'betrieb' ? tiles('maschinen') : null
              if (!list.length && !extra) return null
              return (
                <section key={g.title} className="mt-5">
                  <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.title}</h2>
                  {extra}
                  <div className={`grid grid-cols-2 gap-3 ${extra ? 'mt-3' : ''}`}>
                    {list.map((mod) => (
                      <Link
                        key={mod.key}
                        to={`/${mod.key}`}
                        className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-white p-4 text-center shadow-sm active:bg-gray-100"
                      >
                        <span className="text-3xl">{mod.icon}</span>
                        <span className="font-semibold text-gray-800">{mod.title}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}
        {canImport && modules.some((m) => m.importer) && (
          <Link to="/import" className="mt-4 block rounded-xl bg-white p-4 text-center text-sm shadow-sm active:bg-gray-100">
            <span className="font-semibold text-brand-700">📥 Daten importieren</span>
            <span className="block text-xs text-gray-500">Herdebuch, TVD, Leistungsausweise, GELAN-Raumdaten … — Zuordnung automatisch</span>
          </Link>
        )}
      </main>
    </div>
  )
}
