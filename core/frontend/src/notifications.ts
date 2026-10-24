// Benachrichtigungen (Glocke): vom Server, nur mit Netz. Die Meldungen entstehen
// serverseitig (core/backend/fmis_core/notifications.py), z.B. beim Abtausch.
import { useEffect, useSyncExternalStore } from 'react'
import { API_URL, getToken } from './auth'

export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  created_at: string
  read: boolean
}
export interface NotificationState {
  unread: number
  items: AppNotification[]
  notifyEmail: boolean
}

const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' })
let state: NotificationState | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export async function refreshNotifications(): Promise<void> {
  if (!getToken() || (typeof navigator !== 'undefined' && !navigator.onLine)) return
  try {
    const res = await fetch(`${API_URL}/core/notifications`, { headers: headers() })
    if (!res.ok) return
    const d = (await res.json()) as { unread: number; items: AppNotification[]; notify_email: boolean }
    state = { unread: d.unread, items: d.items, notifyEmail: d.notify_email }
    emit()
  } catch {
    // ohne Netz: alter Stand bleibt
  }
}

export async function markNotificationsRead(ids: string[] | 'all'): Promise<void> {
  await fetch(`${API_URL}/core/notifications/read`, { method: 'POST', headers: headers(), body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) })
  await refreshNotifications()
}

export async function setNotifyEmail(on: boolean): Promise<void> {
  const res = await fetch(`${API_URL}/core/profile/notifications`, { method: 'PUT', headers: headers(), body: JSON.stringify({ notify_email: on }) })
  if (!res.ok) throw new Error(`Speichern fehlgeschlagen (${res.status})`)
  await refreshNotifications()
}

let polling = 0
/** Stand der Glocke; fragt beim Start, alle 60 s, beim Zurückkehren in die App und nach jedem Sync neu. */
export function useNotifications(): NotificationState | null {
  useEffect(() => {
    if (polling++ === 0) void refreshNotifications()
    const t = setInterval(() => void refreshNotifications(), 60_000)
    const vis = () => document.visibilityState === 'visible' && void refreshNotifications()
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('online', vis)
    return () => {
      polling--
      clearInterval(t)
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('online', vis)
    }
  }, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
