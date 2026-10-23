import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchUserView, listUsers, type AdminUser } from './admin'
import { useAuthUser, useRealPermission, useRealUser } from './AuthContext'
import { notifyError, errorText } from './toast'
import { startViewAs, useViewAs } from './viewAs'

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
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  useEffect(() => {
    if (!open || !canViewAs) return
    let alive = true
    listUsers()
      .then((u) => alive && setUsers(u))
      .catch((e) => alive && notifyError(errorText(e)))
    return () => {
      alive = false
    }
  }, [open, canViewAs])

  if (!canUsers && !canModules) return null

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  async function viewAs(u: AdminUser) {
    setBusy(u.id)
    try {
      startViewAs(await fetchUserView(u.id))
      setOpen(false)
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

  const item = 'flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm active:bg-gray-100'
  return (
    <div ref={box} className="sm:relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Verwaltung"
        aria-label="Verwaltung"
        className="grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100"
      >
        ⚙️
      </button>
      {open && (
        <div role="menu" className="absolute right-2 top-full z-[2300] mt-1 max-h-[75vh] w-72 max-w-[calc(100vw-1rem)] sm:right-0 overflow-y-auto rounded-xl bg-white py-1 shadow-2xl ring-1 ring-black/10">
          {canModules && (
            <button type="button" role="menuitem" className={item} onClick={() => go('/verwaltung/module')}>
              🧩 Module
            </button>
          )}
          {canUsers && (
            <button type="button" role="menuitem" className={item} onClick={() => go('/verwaltung/benutzer')}>
              👥 Benutzer
            </button>
          )}
          {canViewAs && (
            <>
              <div className="mt-1 border-t px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Ansicht wechseln</div>
              {view && (
                <div className="px-3 pb-1 text-xs text-red-700">
                  Gerade: {view.email} — zurück über den roten Balken
                </div>
              )}
              {users == null && <div className="px-3 py-2 text-xs text-gray-500">Lädt…</div>}
              {users != null && candidates.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Keine anderen aktiven Nutzer.</div>}
              {candidates.map((u) => (
                <button key={u.id} type="button" role="menuitem" className={item} disabled={busy != null} onClick={() => void viewAs(u)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{u.email}</span>
                    <span className="block text-xs text-gray-500">{u.role_name}</span>
                  </span>
                  <span aria-hidden>{busy === u.id ? '…' : '👁'}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
