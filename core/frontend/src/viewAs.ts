// «Ansicht wechseln» für Admins: die App mit den Rechten eines anderen Nutzers
// sehen. Es ist nur eine Ansicht — der Admin bleibt mit dem eigenen Token
// angemeldet, Sync und Speichern laufen unter dem eigenen Namen (Verlauf,
// created_by). Nach 20 Minuten ohne Bedienung geht es automatisch zurück.

import { useSyncExternalStore } from 'react'
import type { CurrentUser } from './auth'

const KEY = 'fmis_view_as'
/** Inaktivität, nach der die eigene Ansicht zurückkommt. */
export const VIEW_AS_IDLE_MS = 20 * 60_000

export interface ViewAs extends CurrentUser {
  /** letzte Bedienung (ms) */
  lastActive: number
}

/** Gespeicherte Ansicht prüfen: gültig und nicht abgelaufen, sonst null. */
export function parseViewAs(raw: string | null, now: number): ViewAs | null {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<ViewAs> | null
    if (!v || typeof v.email !== 'string' || !Array.isArray(v.permissions) || typeof v.lastActive !== 'number') return null
    if (now - v.lastActive > VIEW_AS_IDLE_MS) return null
    return {
      email: v.email,
      role: typeof v.role === 'string' ? v.role : null,
      permissions: v.permissions.filter((p): p is string => typeof p === 'string'),
      lastActive: v.lastActive,
    }
  } catch {
    return null
  }
}

let cache: ViewAs | null = null
let loaded = false
const listeners = new Set<() => void>()

function read(): ViewAs | null {
  try {
    const raw = localStorage.getItem(KEY)
    const v = parseViewAs(raw, Date.now())
    if (raw && !v) localStorage.removeItem(KEY) // abgelaufen oder beschädigt
    return v
  } catch {
    return null
  }
}

/** Markierung am <html>: die CSS-Regeln in index.css schieben Kopfzeilen unter den roten Balken. */
function markPage(on: boolean) {
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-view-as', on)
}

function emit() {
  listeners.forEach((l) => l())
}

function write(v: ViewAs | null) {
  cache = v
  loaded = true
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    // ohne Speicher gilt die Ansicht nur bis zum Neuladen
  }
  markPage(!!v)
  emit()
}

export function getViewAs(): ViewAs | null {
  if (!loaded) {
    cache = read()
    loaded = true
    markPage(!!cache)
  }
  return cache
}

export function startViewAs(user: CurrentUser): void {
  write({ ...user, lastActive: Date.now() })
}

export function stopViewAs(): void {
  write(null)
}

let lastTouch = 0
/** Bedienung melden (höchstens alle 10 s gespeichert). */
export function touchViewAs(now = Date.now()): void {
  if (!cache || now - lastTouch < 10_000) return
  lastTouch = now
  write({ ...cache, lastActive: now })
}

/** Abgelaufen? Dann zurück zur eigenen Ansicht; true, wenn zurückgesetzt. */
export function expireViewAs(now = Date.now()): boolean {
  if (!cache) return false
  if (now - cache.lastActive <= VIEW_AS_IDLE_MS) return false
  write(null)
  return true
}

export function subscribeViewAs(l: () => void): () => void {
  listeners.add(l)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cache = read()
    loaded = true
    markPage(!!cache)
    l()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(l)
    window.removeEventListener('storage', onStorage)
  }
}

export function useViewAs(): ViewAs | null {
  return useSyncExternalStore(subscribeViewAs, getViewAs)
}

/** E-Mail, mit der die Anzeige arbeitet (z.B. «meine Dienste»): in einer
 * fremden Ansicht die des Nutzers, sonst die eigene. Für Verlauf und
 * created_by gilt weiter die eigene (getCurrentUserEmail). */
export function getViewedEmail(own: string | null): string | null {
  return getViewAs()?.email ?? own
}
