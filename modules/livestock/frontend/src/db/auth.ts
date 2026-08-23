const TOKEN_KEY = 'mastplaner_token'
const EMAIL_KEY = 'mastplaner_email'

// `??` statt `||`: ein bewusst leerer VITE_API_URL (Produktions-Build, gleiche
// Origin wie das Frontend) soll NICHT auf localhost zurückfallen — nur ein
// tatsächlich fehlender (undefined) Wert tut das, praktisch für Ad-hoc-Dev.
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EMAIL_KEY)
}

/**
 * Für write.ts (data_history.changed_by): unabhängig vom React-Context in
 * localStorage gespiegelt, damit die E-Mail auch offline direkt nach
 * App-Start verfügbar ist (vor dem ersten erfolgreichen /auth/me), nicht
 * erst nachdem AuthUserProvider fertig geladen hat.
 */
export function setCurrentUserEmail(email: string): void {
  localStorage.setItem(EMAIL_KEY, email)
}

export function getCurrentUserEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY)
}

export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/request-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    throw new Error(`Anfrage fehlgeschlagen (${res.status})`)
  }
}

export async function verifyToken(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Anmeldung fehlgeschlagen (${res.status})`)
  }
  const data = (await res.json()) as { access_token: string }
  localStorage.setItem(TOKEN_KEY, data.access_token)
}

/**
 * Nur für Test-/Entwicklungsumgebungen: loggt per Passwort statt Magic-Link
 * ein. Funktioniert nur, wenn das Backend TEST_LOGIN_PASSWORD gesetzt hat
 * (in Produktion nie der Fall — der Endpunkt lehnt dann immer ab).
 */
export async function passwordLogin(password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Anmeldung fehlgeschlagen (${res.status})`)
  }
  const data = (await res.json()) as { access_token: string }
  localStorage.setItem(TOKEN_KEY, data.access_token)
}

export interface CurrentUser {
  email: string
  role: string | null
  permissions: string[]
}

export async function fetchMe(): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    throw new Error(`Nutzerdaten konnten nicht geladen werden (${res.status})`)
  }
  return (await res.json()) as CurrentUser
}
