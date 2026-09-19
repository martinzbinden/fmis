import { useEffect, useState } from 'react'
import {
  ALL_PERMISSIONS,
  assignRole,
  createRole,
  listRoles,
  listUsers,
  setUserEnabled,
  type AdminRole,
  type AdminUser,
} from '../db/admin'
import { useHasPermission } from '../db/AuthContext'

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

export default function Admin() {
  const canManage = useHasPermission('users:manage')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<AdminRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewRole, setShowNewRole] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [u, r] = await Promise.all([listUsers(), listRoles()])
      setUsers(u)
      setRoles(r)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canManage) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage])

  if (!canManage) {
    return <p className="p-6 text-center text-gray-500">Kein Zugriff — nur für Admins.</p>
  }
  if (loading) {
    return <div className="p-4 text-center text-gray-400">Lädt…</div>
  }

  async function handleRoleChange(userId: string, roleId: string) {
    if (!roleId) return
    try {
      await assignRole(userId, roleId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zuweisung fehlgeschlagen')
    }
  }

  async function handleToggleEnabled(user: AdminUser) {
    try {
      await setUserEnabled(user.id, user.status !== 'active')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-xl font-bold text-gray-800">Nutzerverwaltung</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-800">{u.email}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[u.status]}`}>
                {STATUS_LABEL[u.status]}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={u.role_id ?? ''}
                onChange={(e) => handleRoleChange(u.id, e.target.value)}
                className="flex-1 rounded border border-gray-300 p-2 text-sm"
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
              {u.status !== 'pending' && (
                <button
                  type="button"
                  onClick={() => handleToggleEnabled(u)}
                  className="whitespace-nowrap rounded border border-gray-300 px-3 py-2 text-sm text-gray-600"
                >
                  {u.status === 'active' ? 'Sperren' : 'Entsperren'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

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
      setError(err instanceof Error ? err.message : 'Erstellen fehlgeschlagen')
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
            <input
              type="checkbox"
              checked={permissions.has(perm)}
              onChange={() => toggle(perm)}
            />
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
