import { useAuthUser, useRealUser } from './AuthContext'
import HeaderMenu, { MenuItem } from './HeaderMenu'
import SidePanel from './SidePanel'
import Switch from './Switch'
import { logout } from './auth'
import { openPanel } from './headerPanel'
import { cachedModules } from './modulesApi'
import { setNotifyEmail, useNotifications } from './notifications'
import { errorText, notifyError } from './toast'
import { useViewAs } from './viewAs'

/** Anfangsbuchstabe der E-Mail im runden Symbol (ohne Namen im Konto) */
function initial(email: string | undefined): string {
  return (email ?? '?').trim().charAt(0).toUpperCase() || '?'
}

/** 👤 in der Kopfzeile: nur ein Menü (öffnet selbst nichts) mit Profil und Abmelden; Platz für weitere Einträge. */
export default function ProfileMenu({ onLoggedOut }: { onLoggedOut: () => void }) {
  const user = useAuthUser()
  return (
    <HeaderMenu
      label={user ? `Benutzer ${user.email}` : 'Benutzer'}
      icon={
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">
          {initial(user?.email)}
        </span>
      }
      width="w-64"
    >
      {(close) => (
        <>
          {user && (
            <div className="border-b px-3 pb-2 pt-1.5">
              <div className="truncate text-sm font-semibold text-gray-900">{user.email}</div>
              {user.role && <div className="text-xs text-gray-600">{user.role}</div>}
            </div>
          )}
          <MenuItem onSelect={() => (close(), openPanel('profil'))}>
            <span aria-hidden>👤</span> Profil
          </MenuItem>
          <MenuItem onSelect={() => (close(), openPanel('status'))}>
            <span aria-hidden>🩺</span> Status und Version
          </MenuItem>
          <div className="my-1 border-t" />
          <MenuItem
            danger
            onSelect={() => {
              close()
              logout()
              onLoggedOut()
            }}
          >
            <span aria-hidden>🚪</span> Abmelden
          </MenuItem>
        </>
      )}
    </HeaderMenu>
  )
}

const AREA_LABEL: Record<string, string> = { core: 'Allgemein' }
// Fachbegriffe der Rechte (core/backend/fmis_core/schema/0001_core.sql) in Worten
const WHAT_LABEL: Record<string, string> = {
  history: 'Verlauf', animals: 'Tiere', import: 'Daten importieren', korrektur: 'Korrekturen nach Frist', 'modules:manage': 'Module verwalten',
  'users:manage': 'Benutzer verwalten', milk: 'Milch', groups: 'Gruppen', feed: 'Futter', expenses: 'Kosten', medications: 'Medikamente',
  weighings: 'Wägungen', slaughter: 'Schlachtungen', economics: 'Wirtschaftlichkeit', projekte: 'Projekte', dienste: 'Dienstplan',
  tracking: 'Erfassung', wuensche: 'Wünsche', fields: 'Flächen', dz: 'Direktzahlungen', herden: 'Herden',
}
const LEVEL_LABEL: Record<string, string> = { read: 'ansehen', write: 'ändern' }

/** Profil im Seitenfenster: Konto, Rolle, Benachrichtigungen per E-Mail, Rechte je Modul in Worten. */
export function ProfilePanel() {
  const user = useAuthUser()
  const real = useRealUser()
  const view = useViewAs()
  const n = useNotifications()
  const titles: Record<string, string> = Object.fromEntries((cachedModules() ?? []).map((m) => [m.key, m.title]))
  // Bereich → Recht → Stufen (ansehen, ändern)
  const byArea = new Map<string, Map<string, Set<string>>>()
  for (const p of user?.permissions ?? []) {
    const [area, ...rest] = p.split(':')
    const last = rest[rest.length - 1]
    const level = LEVEL_LABEL[last] ? last : null
    const what = (level ? rest.slice(0, -1) : rest).join(':')
    const m = byArea.get(area) ?? new Map<string, Set<string>>()
    const set = m.get(what) ?? new Set<string>()
    if (level) set.add(LEVEL_LABEL[level])
    m.set(what, set)
    byArea.set(area, m)
  }
  const areaName = (a: string) => titles[a] ?? AREA_LABEL[a] ?? a
  const rightsText = (m: Map<string, Set<string>>) =>
    [...m.entries()]
      .map(([what, levels]) => `${WHAT_LABEL[what] ?? what}${levels.size ? `: ${[...levels].sort((a, b) => (a === 'ansehen' ? -1 : b === 'ansehen' ? 1 : 0)).join(', ')}` : ''}`)
      .sort((a, b) => a.localeCompare(b, 'de'))
  const h = 'mb-1 mt-4 text-sm font-bold text-gray-800 first:mt-0'
  return (
    <SidePanel panel="profil" title="Profil">
      {!user ? (
        <p className="text-sm text-gray-700">Nicht angemeldet.</p>
      ) : (
        <>
          <h3 className={h}>Konto</h3>
          <dl className="text-sm">
            <div className="flex justify-between gap-3 py-0.5">
              <dt className="text-gray-600">E-Mail</dt>
              <dd className="truncate font-medium text-gray-900">{real?.email ?? user.email}</dd>
            </div>
            <div className="flex justify-between gap-3 py-0.5">
              <dt className="text-gray-600">Rolle</dt>
              <dd className="font-medium text-gray-900">{real?.role ?? user.role ?? '–'}</dd>
            </div>
          </dl>
          {view && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">Du siehst die App gerade als {view.email}. Zurück über den roten Balken.</p>}

          <h3 className={h}>Benachrichtigungen</h3>
          {n ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-gray-700">Auch per E-Mail</span>
              <Switch checked={n.notifyEmail} onChange={(v) => void setNotifyEmail(v).catch((e) => notifyError(errorText(e)))} label="Benachrichtigungen auch per E-Mail" />
            </div>
          ) : (
            <p className="text-sm text-gray-600">Nur mit Verbindung zum Server.</p>
          )}

          <h3 className={h}>Rechte{view ? ' (in dieser Ansicht)' : ''}</h3>
          <ul className="space-y-1.5 text-sm">
            {[...byArea.entries()]
              .sort((a, b) => areaName(a[0]).localeCompare(areaName(b[0]), 'de'))
              .map(([area, m]) => (
                <li key={area}>
                  <span className="font-semibold text-gray-900">{areaName(area)}</span>
                  <span className="block text-sm text-gray-700">{rightsText(m).join(' · ')}</span>
                </li>
              ))}
          </ul>
        </>
      )}
    </SidePanel>
  )
}
