// Zuletzt benutzte Ansicht eines Fussleisten-Punkts mit mehreren Ansichten (ViewSwitch): der Punkt öffnet beim
// nächsten Mal wieder diese Ansicht. Je Gerät (localStorage), beim ersten Besuch gilt die Vorgabe.

import { notifyNavChanged } from '@fmis/core/navItems'

const storageKey = (moduleKey: string, topic: string) => `${moduleKey}_last_view_${topic}`

export function readLastView(moduleKey: string, topic: string, allowed: string[], fallback: string): string {
  try {
    const v = localStorage.getItem(storageKey(moduleKey, topic))
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

export function rememberView(moduleKey: string, topic: string, view: string): void {
  try {
    if (localStorage.getItem(storageKey(moduleKey, topic)) === view) return
    localStorage.setItem(storageKey(moduleKey, topic), view)
  } catch {
    // nur bis zum Neuladen
  }
  notifyNavChanged()
}
