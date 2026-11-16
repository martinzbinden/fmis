// Meine Links (core/backend/fmis_core/user_links.py): persönliche Verweise auf der Startseite, nur für die Person
// selbst. Für unterwegs ohne Netz zuletzt bekannte Liste je Gerät gemerkt.

import { useSyncExternalStore } from 'react'
import { API_URL, getToken } from './auth'

export interface MyLink {
  id: string
  title: string
  url: string
  icon: string | null
}

const CACHE = 'fmis_my_links'
let links: MyLink[] | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? 'null') as MyLink[] | null
  } catch {
    return null
  }
})()
const listeners = new Set<() => void>()
function set(next: MyLink[]) {
  links = next
  try {
    localStorage.setItem(CACHE, JSON.stringify(next))
  } catch {
    // nur im Speicher
  }
  listeners.forEach((l) => l())
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(init.headers ?? {}) } })
  if (!res.ok) {
    const d = (await res.json().catch(() => null)) as { detail?: unknown } | null
    throw new Error(typeof d?.detail === 'string' ? d.detail : `Fehler (${res.status})`)
  }
  return (await res.json()) as T
}

export async function refreshMyLinks(): Promise<void> {
  try {
    set(await call<MyLink[]>('/core/my-links'))
  } catch {
    // offline: zuletzt bekannte Liste bleibt
  }
}

export async function addMyLink(link: { title: string; url: string; icon?: string | null }): Promise<void> {
  const added = await call<MyLink>('/core/my-links', { method: 'POST', body: JSON.stringify(link) })
  set([...(links ?? []), added])
}

export async function removeMyLink(id: string): Promise<void> {
  await call(`/core/my-links/${id}`, { method: 'DELETE' })
  set((links ?? []).filter((l) => l.id !== id))
}

/** Beim Abmelden: Liste dieses Geräts vergessen */
export function forgetMyLinks(): void {
  links = null
  try {
    localStorage.removeItem(CACHE)
  } catch {
    // egal
  }
}

export function useMyLinks(): MyLink[] | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => links,
  )
}
