import { API_URL, getToken } from './auth'

export interface AdminUser {
  id: string
  email: string
  status: 'pending' | 'active' | 'disabled'
  role_id: string | null
  role_name: string | null
}

export interface AdminRole {
  id: string
  name: string
  permissions: string[]
}

// Muss mit core/backend/fmis_core/schema/0001_core.sql (Seed-Rollen) und den
// TABLE_AREA-Werten in modules/<name>/backend/app/tables.py übereinstimmen.
// Rein für die Rollen-Erstellungs-UI. Modul-präfixiert seit dem Merge zu
// einer App — deckt alle drei Module plus die Core-Berechtigungen ab.
export const ALL_PERMISSIONS = [
  'livestock:animals:read', 'livestock:animals:write',
  'livestock:groups:read', 'livestock:groups:write',
  'livestock:weighings:read', 'livestock:weighings:write',
  'livestock:medications:read', 'livestock:medications:write',
  'livestock:feed:read', 'livestock:feed:write',
  'livestock:expenses:read', 'livestock:expenses:write',
  'livestock:slaughter:read', 'livestock:slaughter:write',
  'livestock:economics:read',
  'livestock:history:read',
  'dairy:animals:read', 'dairy:animals:write',
  'dairy:milk:read', 'dairy:milk:write',
  'dairy:history:read',
  'fields:fields:read', 'fields:fields:write',
  'fields:history:read',
  'core:users:manage',
  'core:modules:manage',
] as const

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getToken()}` }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Fehler ${res.status}`)
  }
  return (await res.json()) as T
}

export async function listUsers(): Promise<AdminUser[]> {
  return handle(await fetch(`${API_URL}/admin/users`, { headers: authHeaders() }))
}

export async function listRoles(): Promise<AdminRole[]> {
  return handle(await fetch(`${API_URL}/admin/roles`, { headers: authHeaders() }))
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  await handle(
    await fetch(`${API_URL}/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ role_id: roleId }),
    }),
  )
}

export async function setUserEnabled(userId: string, enabled: boolean): Promise<void> {
  await handle(
    await fetch(`${API_URL}/admin/users/${userId}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST',
      headers: authHeaders(),
    }),
  )
}

export async function createRole(name: string, permissions: string[]): Promise<AdminRole> {
  return handle(
    await fetch(`${API_URL}/admin/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, permissions }),
    }),
  )
}
