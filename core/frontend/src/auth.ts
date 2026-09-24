// Login ist jetzt app-weit (ein Backend, ein JWT für alle Module) — ein
// einziger Satz Storage-Keys statt vormals einem Präfix pro Modul.
const TOKEN_KEY = 'fmis_token'
const EMAIL_KEY = 'fmis_email'

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
 * Für write.ts (data_history.changed_by) in jedem Modul: unabhängig vom
 * React-Context in localStorage gespiegelt, damit die E-Mail auch offline
 * direkt nach App-Start verfügbar ist (vor dem ersten erfolgreichen
 * /auth/me), nicht erst nachdem AuthUserProvider fertig geladen hat.
 */
export function setCurrentUserEmail(email: string): void {
  localStorage.setItem(EMAIL_KEY, email)
}

export function getCurrentUserEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY)
}

/**
 * Abbruchsignal für die Anmelde-Abfragen. Ohne Frist bliebe der Login-Schirm
 * bei einer hängenden Verbindung endlos auf "Anmeldung wird geprüft…" stehen,
 * statt das E-Mail-Formular zu zeigen. In alten Browsern ohne
 * AbortSignal.timeout gibt es eben keine Frist — dann verhält es sich wie
 * vorher.
 */
function withTimeout(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(ms)
    : undefined
}

export type AuthConfig = {
  /** Testpasswort-Login (TEST_LOGIN_PASSWORD im Backend) — in Produktion aus. */
  passwordLogin: boolean
  /** Anmeldung am vorgelagerten Portal gegen ein fmis-Token tauschen. */
  sso: boolean
}

/**
 * Welche Anmeldewege es hier überhaupt gibt. Das Frontend ist ein statischer
 * Build und kann die Backend-Konfiguration nicht kennen — was es nicht gibt,
 * soll es auch nicht anbieten.
 */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch(`${API_URL}/auth/config`, { signal: withTimeout(8000) })
  if (!res.ok) {
    throw new Error(`Konfiguration nicht abrufbar (${res.status})`)
  }
  const data = (await res.json()) as { password_login?: boolean; sso?: boolean }
  return { passwordLogin: data.password_login === true, sso: data.sso === true }
}

/**
 * Tauscht eine bestehende Portal-Anmeldung (Authelia-Cookie) gegen ein
 * fmis-Token. `redirect: 'manual'` ist wichtig: ohne gültige Portal-Sitzung
 * antwortet die ForwardAuth mit einer Umleitung auf eine fremde Origin, der
 * zu folgen nur eine CORS-Fehlermeldung einbrächte. Gibt false zurück, wenn
 * dieser Weg gerade nicht trägt — dann führt der Weg über PORTAL_ENTRY_PATH.
 */
export async function ssoLogin(): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/sso`, {
    method: 'POST',
    redirect: 'manual',
    signal: withTimeout(8000),
  })
  if (!res.ok) {
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null
      throw new Error(body?.detail ?? 'Anmeldung abgelehnt')
    }
    return false
  }
  const data = (await res.json()) as { access_token: string }
  localStorage.setItem(TOKEN_KEY, data.access_token)
  return true
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

/**
 * Vollständige Navigation hierhin holt eine Portal-Anmeldung nach. Muss eine
 * echte Navigation sein, kein fetch: nur so greift die Umleitung des Portals.
 * Der Pfad liegt in der navigateFallbackDenylist des Service-Workers, wird
 * also nicht aus dem Cache beantwortet.
 */
export const PORTAL_ENTRY_PATH = '/auth/portal'
