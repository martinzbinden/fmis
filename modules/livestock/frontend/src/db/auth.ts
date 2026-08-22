const TOKEN_KEY = 'mastplaner_token'

export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function login(password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error('Falsches Passwort')
    throw new Error(`Anmeldung fehlgeschlagen (${res.status})`)
  }
  const data = (await res.json()) as { access_token: string }
  localStorage.setItem(TOKEN_KEY, data.access_token)
}
