// Login ist jetzt app-weit (ein Backend, ein JWT für alle Module) — ein
// einziger Satz Storage-Keys statt vormals einem Präfix pro Modul.
import { getViewedEmail, stopViewAs } from './viewAs'

const TOKEN_KEY = 'fmis_token'
const EMAIL_KEY = 'fmis_email'
const ME_KEY = 'fmis_me'

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
  localStorage.removeItem(ME_KEY)
  stopViewAs()
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

/** Für die Anzeige («meine Dienste»): in einer fremden Ansicht (Admin →
 * Ansicht wechseln) die E-Mail des angezeigten Nutzers. Verlauf und
 * created_by nehmen weiter getCurrentUserEmail. */
export function getViewedUserEmail(): string | null {
  return getViewedEmail(getCurrentUserEmail())
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

/** Portal-Anmeldung vorhanden, aber FMIS lehnt den Nutzer ab (gesperrt, Gruppe entfernt, wartet). */
export class SsoDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsoDeniedError'
  }
}

/**
 * Tauscht eine bestehende Portal-Anmeldung (Authelia-Cookie) gegen ein
 * fmis-Token. `redirect: 'manual'` ist wichtig: ohne gültige Portal-Sitzung
 * antwortet die ForwardAuth mit einer Umleitung auf eine fremde Origin, der
 * zu folgen nur eine CORS-Fehlermeldung einbrächte. Gibt null zurück, wenn
 * dieser Weg gerade nicht trägt — dann führt der Weg über PORTAL_ENTRY_PATH.
 */
async function ssoExchange(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/sso`, {
    method: 'POST',
    redirect: 'manual',
    signal: withTimeout(8000),
  })
  if (!res.ok) {
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null
      throw new SsoDeniedError(body?.detail ?? 'Anmeldung abgelehnt')
    }
    return null
  }
  return ((await res.json()) as { access_token: string }).access_token
}

export async function ssoLogin(): Promise<boolean> {
  const token = await ssoExchange()
  if (!token) return false
  localStorage.setItem(TOKEN_KEY, token)
  markSsoChecked()
  return true
}

// --- Regelmässige Portal-Prüfung -------------------------------------------
// Ein FMIS-Token gilt lange (Feld ohne Netz). Damit eine Sperre oder eine
// entfernte Gruppe im Portal trotzdem bald greift, fragt die App im
// Hintergrund alle 6 Stunden das Portal erneut (Rolle wird nachgeführt, das
// Token erneuert). Der Server lässt Portal-Tokens zusätzlich nach 24 Stunden
// ohne diese Prüfung ablaufen (SSO_MAX_AGE_HOURS).
const SSO_CHECKED_KEY = 'fmis_sso_checked'
const SSO_TRIED_KEY = 'fmis_sso_tried'
export const SSO_RECHECK_MS = 6 * 3600_000
/** Nach einem erfolglosen Versuch (kein Netz, keine Portal-Sitzung) frühestens wieder nach … */
export const SSO_RETRY_MS = 30 * 60_000

function markSsoChecked(): void {
  try {
    localStorage.setItem(SSO_CHECKED_KEY, String(Date.now()))
  } catch {
    // dann eben bei jedem Start
  }
}

/** Ist eine Portal-Prüfung fällig? (rein, getestet) */
export function ssoRecheckDue(checkedAt: number | null, triedAt: number | null, now: number): boolean {
  if (checkedAt != null && now - checkedAt < SSO_RECHECK_MS) return false
  if (triedAt != null && now - triedAt < SSO_RETRY_MS) return false
  return true
}

/** Nutzer-ID (sub) aus einem JWT, ohne Prüfung — nur um «dieselbe Person» zu erkennen. */
export function jwtSub(token: string | null): string | null {
  try {
    const part = token?.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

const num = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

/** Portal-Prüfung im Hintergrund, wenn fällig. Gibt zurück, was passiert ist. */
export async function recheckSso(now = Date.now()): Promise<'skipped' | 'refreshed' | 'none' | 'denied'> {
  if (!isLoggedIn() || !ssoRecheckDue(num(SSO_CHECKED_KEY), num(SSO_TRIED_KEY), now)) return 'skipped'
  try {
    localStorage.setItem(SSO_TRIED_KEY, String(now))
  } catch {
    // egal
  }
  try {
    const token = await ssoExchange()
    if (!token) return 'none'
    // Das Portal meldet eine andere Person an als dieses Gerät: Token nicht tauschen
    if (jwtSub(token) !== jwtSub(getToken())) return 'none'
    localStorage.setItem(TOKEN_KEY, token)
    markSsoChecked()
    return 'refreshed'
  } catch (err) {
    // Gesperrt/Gruppe entfernt: hier abmelden. Kein Netz (TypeError/Abbruch): später wieder.
    if (err instanceof SsoDeniedError) {
      logout()
      return 'denied'
    }
    return 'none'
  }
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

/** Zuletzt bekannte Rechte dieses Geräts. Ohne diesen Zwischenspeicher fehlen
 * beim App-Start OHNE Netz (Funkloch auf dem Feld) alle Schreibknöpfe, obwohl
 * alle Daten lokal da sind — /auth/me kann dann nicht antworten. Die
 * eigentliche Durchsetzung bleibt serverseitig beim Sync. */
export function cachedMe(): CurrentUser | null {
  try {
    const v = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as Partial<CurrentUser> | null
    if (!v || typeof v.email !== 'string' || !Array.isArray(v.permissions)) return null
    return { email: v.email, role: typeof v.role === 'string' ? v.role : null, permissions: v.permissions.filter((p) => typeof p === 'string') }
  } catch {
    return null
  }
}

export async function fetchMe(): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    // Token ungültig/entzogen: alte Rechte nicht weiter vorhalten
    if (res.status === 401 || res.status === 403) localStorage.removeItem(ME_KEY)
    throw new Error(`Nutzerdaten konnten nicht geladen werden (${res.status})`)
  }
  const me = (await res.json()) as CurrentUser
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(me))
  } catch {
    // Speicher voll/gesperrt — nur der Offline-Start fällt dann weg
  }
  return me
}

/**
 * Vollständige Navigation hierhin holt eine Portal-Anmeldung nach. Muss eine
 * echte Navigation sein, kein fetch: nur so greift die Umleitung des Portals.
 * Der Pfad liegt in der navigateFallbackDenylist des Service-Workers, wird
 * also nicht aus dem Cache beantwortet.
 */
export const PORTAL_ENTRY_PATH = '/auth/portal'
