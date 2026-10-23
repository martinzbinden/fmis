import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import {
  ALL_PERMISSIONS,
  assignRole,
  createRole,
  listRoles,
  listUsers,
  setUserEnabled,
  type AdminRole,
  type AdminUser,
} from './admin'
import { fetchModules, setModuleEnabled, setReaderSettings, type ModuleInfo } from './modulesApi'
import { useHasPermission, useRealUser } from './AuthContext'
import AsyncButton from './AsyncButton'
import Switch from './Switch'
import { errorText, notifySuccess } from './toast'

const STATUS_LABEL: Record<AdminUser['status'], string> = {
  pending: 'Wartet auf Freischaltung',
  active: 'Aktiv',
  disabled: 'Gesperrt',
}

const STATUS_COLOR: Record<AdminUser['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  disabled: 'bg-gray-200 text-gray-600',
}

/** Verwaltung mit Untermenü: Module und Benutzer. Schalter und Auswahl
 * ändern zunächst nur den Entwurf; erst «Speichern» führt die Änderungen aus. */
export default function Admin() {
  const canManageUsers = useHasPermission('core:users:manage')
  const canManageModules = useHasPermission('core:modules:manage')
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const anyDirty = Object.values(dirty).some(Boolean)
  const setSectionDirty = useCallback((key: string, v: boolean) => setDirty((d) => (d[key] === v ? d : { ...d, [key]: v })), [])

  // Neuladen/Schliessen mit ungespeicherten Änderungen: Browser fragt nach
  useEffect(() => {
    if (!anyDirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anyDirty])

  if (!canManageUsers && !canManageModules) {
    return <p className="p-6 text-center text-gray-500">Kein Zugriff — nur für Admins.</p>
  }

  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold ${isActive ? 'bg-brand-700 text-white' : 'bg-white text-gray-700 shadow-sm'}`
  const guard = (e: React.MouseEvent) => {
    if (anyDirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) e.preventDefault()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <nav className="flex gap-2" aria-label="Verwaltung">
        {canManageModules && (
          <NavLink to="/verwaltung/module" onClick={guard} className={tab}>
            🧩 Module
          </NavLink>
        )}
        {canManageUsers && (
          <NavLink to="/verwaltung/benutzer" onClick={guard} className={tab}>
            👥 Benutzer
          </NavLink>
        )}
      </nav>
      <Routes>
        {canManageModules && <Route path="module" element={<ModulesSection onDirty={(v) => setSectionDirty('module', v)} />} />}
        {canManageUsers && <Route path="benutzer" element={<UsersSection onDirty={(v) => setSectionDirty('benutzer', v)} />} />}
        <Route path="*" element={<Navigate to={canManageModules ? 'module' : 'benutzer'} replace />} />
      </Routes>
    </div>
  )
}

/** Feste Leiste unten: Anzahl Änderungen, Verwerfen, Speichern. */
function SaveBar({
  count,
  hint,
  canSave,
  onDiscard,
  onSave,
}: {
  count: number
  hint?: string | null
  canSave: boolean
  onDiscard: () => void
  onSave: () => Promise<unknown>
}) {
  if (count === 0) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-2xl items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-800">
            {count} {count === 1 ? 'Änderung' : 'Änderungen'} nicht gespeichert
          </div>
          {hint && <div className="truncate text-xs text-red-700">{hint}</div>}
        </div>
        <button type="button" onClick={onDiscard} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
          Verwerfen
        </button>
        <AsyncButton
          onClick={onSave}
          disabled={!canSave}
          busyLabel="Speichert…"
          doneLabel="✓ gespeichert"
          className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Speichern
        </AsyncButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Module

interface ModuleDraft {
  enabled: boolean
  reader: { enabled: boolean; host: string; port: string } | null
}

const draftOf = (m: ModuleInfo): ModuleDraft => ({
  enabled: m.enabled,
  reader: m.reader_capable && m.reader ? { enabled: m.reader.enabled, host: m.reader.host, port: String(m.reader.port) } : null,
})

/** Was an einem Modul geändert wurde. */
export function moduleChanges(m: ModuleInfo, d: ModuleDraft): { enabled: boolean; reader: boolean } {
  const r = m.reader
  return {
    enabled: d.enabled !== m.enabled,
    reader: !!d.reader && !!r && (d.reader.enabled !== r.enabled || d.reader.host.trim() !== r.host || Number(d.reader.port) !== r.port),
  }
}

function ModulesSection({ onDirty }: { onDirty: (v: boolean) => void }) {
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [drafts, setDrafts] = useState<Record<string, ModuleDraft>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    try {
      const list = await fetchModules()
      setModules(list)
      setDrafts(Object.fromEntries(list.map((m) => [m.key, draftOf(m)])))
      setError(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const changed = useMemo(
    () =>
      modules.filter((m) => {
        const d = drafts[m.key]
        if (!d) return false
        const c = moduleChanges(m, d)
        return c.enabled || c.reader
      }),
    [modules, drafts],
  )
  useEffect(() => onDirty(changed.length > 0), [changed.length, onDirty])

  const readerProblem = changed
    .map((m) => drafts[m.key])
    .find((d) => d.reader?.enabled && (!d.reader.host.trim() || !(Number(d.reader.port) >= 1 && Number(d.reader.port) <= 65535)))

  const patch = (key: string, p: Partial<ModuleDraft>) => setDrafts((all) => ({ ...all, [key]: { ...all[key], ...p } }))
  const patchReader = (key: string, p: Partial<NonNullable<ModuleDraft['reader']>>) =>
    setDrafts((all) => ({ ...all, [key]: { ...all[key], reader: all[key].reader ? { ...all[key].reader!, ...p } : null } }))

  async function save() {
    const failures: string[] = []
    let enabledChanged = false
    for (const m of changed) {
      const d = drafts[m.key]
      const c = moduleChanges(m, d)
      try {
        if (c.enabled) {
          await setModuleEnabled(m.key, d.enabled)
          enabledChanged = true
        }
        if (c.reader && d.reader) await setReaderSettings(m.key, { enabled: d.reader.enabled, host: d.reader.host.trim(), port: Number(d.reader.port) })
      } catch (err) {
        failures.push(`${m.title}: ${errorText(err)}`)
      }
    }
    await reload()
    // Navigation und Routen der App an die neue Modulliste anpassen
    if (enabledChanged) window.dispatchEvent(new Event('fmis:modules-changed'))
    if (failures.length) {
      setError(failures.join(' · '))
      throw new Error(`${failures.length} von ${changed.length} nicht gespeichert`)
    }
    notifySuccess('Module gespeichert')
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-gray-800">Module</h1>
      <p className="mb-3 text-xs text-gray-500">
        Ein ausgeschaltetes Modul verschwindet für alle Nutzer und nimmt keine Daten mehr an. Änderungen gelten erst nach «Speichern».
      </p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {loading && modules.length === 0 ? (
        <div className="p-4 text-center text-gray-500">Lädt…</div>
      ) : (
        <ul className="space-y-2">
          {modules.map((m) => {
            const d = drafts[m.key]
            if (!d) return null
            const c = moduleChanges(m, d)
            return (
              <li key={m.key} className={`rounded-lg bg-white p-3 shadow-sm ${c.enabled || c.reader ? 'ring-2 ring-amber-400' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-gray-800">{m.title}</div>
                    <div className={`text-xs ${c.enabled ? (d.enabled ? 'font-semibold text-green-700' : 'font-semibold text-red-700') : 'text-gray-500'}`}>
                      {c.enabled ? (d.enabled ? 'wird eingeschaltet' : 'wird ausgeschaltet') : m.enabled ? 'eingeschaltet' : 'ausgeschaltet'}
                    </div>
                  </div>
                  <Switch checked={d.enabled} onChange={(v) => patch(m.key, { enabled: v })} label={`${m.title} ein/aus`} />
                </div>
                {d.reader && (
                  <div className="mt-2 border-t border-gray-100 pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-700">Ohrmarkenleser</span>
                      <Switch checked={d.reader.enabled} onChange={(v) => patchReader(m.key, { enabled: v })} label={`Ohrmarkenleser ${m.title} ein/aus`} />
                    </div>
                    {d.reader.enabled && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={d.reader.host}
                          onChange={(e) => patchReader(m.key, { host: e.target.value })}
                          placeholder="Adresse"
                          aria-label="Adresse des Lesers"
                          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-2 text-sm"
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          value={d.reader.port}
                          onChange={(e) => patchReader(m.key, { port: e.target.value })}
                          placeholder="Port"
                          aria-label="Port des Lesers"
                          className="w-24 rounded border border-gray-300 px-2 py-2 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <SaveBar
        count={changed.length}
        hint={readerProblem ? 'Leser: Adresse und Port (1–65535) angeben' : null}
        canSave={!readerProblem}
        onDiscard={() => setDrafts(Object.fromEntries(modules.map((m) => [m.key, draftOf(m)])))}
        onSave={save}
      />
    </div>
  )
}

// -------------------------------------------------------------- Benutzer

interface UserDraft {
  role_id: string | null
  active: boolean
}

const userDraftOf = (u: AdminUser): UserDraft => ({ role_id: u.role_id, active: u.status === 'active' })

/** Hat sich am Nutzer etwas geändert, das gespeichert werden muss? */
export function userChanged(u: AdminUser, d: UserDraft): boolean {
  // Wartende werden erst mit Schalter + Rolle aktiv; eine Rolle allein speichert nichts
  if (u.status === 'pending') return d.active
  return d.role_id !== u.role_id || d.active !== (u.status === 'active')
}

function UsersSection({ onDirty }: { onDirty: (v: boolean) => void }) {
  const real = useRealUser()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<AdminRole[]>([])
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewRole, setShowNewRole] = useState(false)

  async function reload() {
    try {
      const [u, r] = await Promise.all([listUsers(), listRoles()])
      setUsers(u)
      setRoles(r)
      setDrafts(Object.fromEntries(u.map((x) => [x.id, userDraftOf(x)])))
      setError(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const changed = useMemo(() => users.filter((u) => drafts[u.id] && userChanged(u, drafts[u.id])), [users, drafts])
  useEffect(() => onDirty(changed.length > 0), [changed.length, onDirty])
  const missingRole = changed.find((u) => drafts[u.id].active && !drafts[u.id].role_id)

  const patch = (id: string, p: Partial<UserDraft>) => setDrafts((all) => ({ ...all, [id]: { ...all[id], ...p } }))

  async function save() {
    const failures: string[] = []
    for (const u of changed) {
      const d = drafts[u.id]
      try {
        if (u.status === 'pending') {
          if (d.active && d.role_id) await assignRole(u.id, d.role_id)
        } else {
          const roleChanged = d.role_id !== u.role_id
          if (roleChanged && d.role_id) await assignRole(u.id, d.role_id) // schaltet auch frei
          const activeNow = roleChanged ? true : u.status === 'active'
          if (d.active !== activeNow) await setUserEnabled(u.id, d.active)
        }
      } catch (err) {
        failures.push(`${u.email}: ${errorText(err)}`)
      }
    }
    await reload()
    if (failures.length) {
      setError(failures.join(' · '))
      throw new Error(`${failures.length} von ${changed.length} nicht gespeichert`)
    }
    notifySuccess('Benutzer gespeichert')
  }

  const ownEmail = (real?.email ?? '').toLowerCase()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-bold text-gray-800">Benutzer</h1>
        <p className="mb-3 text-xs text-gray-500">
          Rolle wählen und mit dem Schieber freischalten oder sperren. Änderungen gelten erst nach «Speichern». Das eigene Konto lässt sich hier nicht ändern.
        </p>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {loading && users.length === 0 ? (
          <div className="p-4 text-center text-gray-500">Lädt…</div>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => {
              const d = drafts[u.id]
              if (!d) return null
              const own = u.email.toLowerCase() === ownEmail
              const dirty = userChanged(u, d)
              return (
                <li key={u.id} className={`rounded-lg bg-white p-3 shadow-sm ${dirty ? 'ring-2 ring-amber-400' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-800">{u.email}</div>
                      <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[u.status]}`}>{STATUS_LABEL[u.status]}</span>
                      {own && <span className="ml-1 text-xs text-gray-500">(du)</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="hidden text-xs text-gray-500 sm:inline">{d.active ? 'aktiv' : u.status === 'pending' ? 'wartet' : 'gesperrt'}</span>
                      <Switch checked={d.active} disabled={own} onChange={(v) => patch(u.id, { active: v })} label={`${u.email} freigeschaltet`} />
                    </div>
                  </div>
                  <select
                    value={d.role_id ?? ''}
                    disabled={own}
                    onChange={(e) => patch(u.id, { role_id: e.target.value || null })}
                    aria-label={`Rolle von ${u.email}`}
                    className="mt-2 w-full rounded border border-gray-300 p-2 text-sm disabled:bg-gray-50"
                  >
                    <option value="" disabled>
                      Rolle wählen…
                    </option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowNewRole((v) => !v)}
          className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
        >
          {showNewRole ? 'Schliessen' : '+ Neue Rolle'}
        </button>
        {showNewRole && <NewRoleForm onCreated={reload} onDone={() => setShowNewRole(false)} />}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Bestehende Rollen</h2>
        <ul className="space-y-2">
          {roles.map((r) => (
            <li key={r.id} className="rounded-lg bg-white p-3 text-sm shadow-sm">
              <div className="font-medium text-gray-800">{r.name}</div>
              <div className="text-xs text-gray-500">{r.permissions.join(', ') || '(keine Rechte)'}</div>
            </li>
          ))}
        </ul>
      </div>

      <SaveBar
        count={changed.length}
        hint={missingRole ? `${missingRole.email}: zuerst eine Rolle wählen` : null}
        canSave={!missingRole}
        onDiscard={() => setDrafts(Object.fromEntries(users.map((x) => [x.id, userDraftOf(x)])))}
        onSave={save}
      />
    </div>
  )
}

function NewRoleForm({ onCreated, onDone }: { onCreated: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [permissions, setPermissions] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(perm: string) {
    setPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(perm)) next.delete(perm)
      else next.add(perm)
      return next
    })
  }

  async function handleSubmit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createRole(name.trim(), [...permissions])
      onCreated()
      onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
      <label className="block text-sm">
        Rollenname
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 p-2"
          placeholder="z.B. Nur Medikamente"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-1 text-sm">
        {ALL_PERMISSIONS.map((perm) => (
          <label key={perm} className="flex items-center gap-2">
            <input type="checkbox" checked={permissions.has(perm)} onChange={() => toggle(perm)} />
            {perm}
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={busy || !name.trim()}
        className="mt-3 w-full rounded-lg bg-brand-700 py-2 font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Erstelle…' : 'Rolle erstellen'}
      </button>
    </div>
  )
}
