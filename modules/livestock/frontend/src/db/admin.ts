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

// Muss mit backend/schema/0001_auth.sql (Seed-Rollen) und den TABLE_AREA-Werten
// in backend/app/tables.py übereinstimmen. Rein für die Rollen-Erstellungs-UI.
export const ALL_PERMISSIONS = [
  'animals:read', 'animals:write',
  'groups:read', 'groups:write',
  'weighings:read', 'weighings:write',
  'medications:read', 'medications:write',
  'feed:read', 'feed:write',
  'expenses:read', 'expenses:write',
  'slaughter:read', 'slaughter:write',
  'economics:read',
  'users:manage',
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
