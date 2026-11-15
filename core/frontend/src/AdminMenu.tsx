import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchUserView, listUsers, type AdminUser } from './admin'
import { useAuthUser, useRealPermission, useRealUser } from './AuthContext'
import { notifyError, errorText } from './toast'
import { startViewAs, useViewAs } from './viewAs'
import { usePageSettingsEntry } from './pageSettings'
import HeaderMenu, { MenuItem } from './HeaderMenu'

/** Zahnrad-Menü für Admins: Verwaltung (Module, Benutzer) und schneller
 * Wechsel in die Ansicht eines anderen Nutzers. */
export default function AdminMenu() {
  const shown = useAuthUser()
  const real = useRealUser()
  const canViewAs = useRealPermission('core:users:manage')
  const canUsers = shown?.permissions.includes('core:users:manage') ?? false
  const canModules = shown?.permissions.includes('core:modules:manage') ?? false
  const view = useViewAs()
  const navigate = useNavigate()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loadUsers, setLoadUsers] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const pageSettings = usePageSettingsEntry()

  useEffect(() => {
    if (!loadUsers || !canViewAs) return
    let alive = true
    listUsers()
      .then((u) => alive && setUsers(u))
      .catch((e) => alive && notifyError(errorText(e)))
    return () => {
      alive = false
    }
  }, [loadUsers, canViewAs])

  if (!canUsers && !canModules && !pageSettings) return null

  async function viewAs(u: AdminUser, close: () => void) {
    setBusy(u.id)
    try {
      startViewAs(await fetchUserView(u.id))
      close()
      navigate('/dashboard')
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(null)
    }
  }
  const candidates = (users ?? [])
    .filter((u) => u.status === 'active' && u.role_id && u.email.toLowerCase() !== (real?.email ?? '').toLowerCase())
    .sort((a, b) => a.email.localeCompare(b.email))

  const label = pageSettings ? `Einstellungen ${pageSettings.title} und Verwaltung` : 'Verwaltung'
  return (
    <HeaderMenu label={label} icon="⚙️" width="w-80">
      {(close) => (
        <>
          <LoadUsers onOpen={() => setLoadUsers(true)} />
          {pageSettings && (
            <div className="border-b px-3 pb-3 pt-2">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Einstellungen {pageSettings.title}</div>
              {pageSettings.render()}
            </div>
          )}
          {canModules && (
            <MenuItem onSelect={() => (close(), navigate('/verwaltung/module'))}>
              <span aria-hidden>🧩</span> Module
            </MenuItem>
          )}
          {canUsers && (
            <MenuItem onSelect={() => (close(), navigate('/verwaltung/benutzer'))}>
              <span aria-hidden>👥</span> Benutzer
            </MenuItem>
          )}
          {canViewAs && (
            <>
              <div className="mt-1 border-t px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Ansicht wechseln</div>
              {view && <div className="px-3 pb-1 text-xs text-red-700">Gerade: {view.email} — zurück über den roten Balken</div>}
              {users == null && <div className="px-3 py-2 text-xs text-gray-500">Lädt…</div>}
              {users != null && candidates.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Keine anderen aktiven Nutzer.</div>}
              {candidates.map((u) => (
                <MenuItem key={u.id} disabled={busy != null} onSelect={() => void viewAs(u, close)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{u.email}</span>
                    <span className="block text-xs text-gray-500">{u.role_name}</span>
                  </span>
                  <span aria-hidden>{busy === u.id ? '…' : '👁'}</span>
                </MenuItem>
              ))}
            </>
          )}
        </>
      )}
    </HeaderMenu>
  )
}

/** Benutzerliste erst laden, wenn das Menü offen ist. */
function LoadUsers({ onOpen }: { onOpen: () => void }) {
  useEffect(() => onOpen(), [onOpen])
  return null
}
