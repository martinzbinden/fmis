// Die Fussleiste hat einen dynamischen Punkt: die zuletzt benutzte Erfassungsfunktion (statt eines Menüs «Erfassen»).
// Jede Erfassungsseite merkt sich beim Öffnen (components/LastCapture.tsx), der Punkt zeigt sie beim nächsten Rendern.

import type { NavItem } from '@fmis/core/ModuleDescriptor'
import { notifyNavChanged } from '@fmis/core/navItems'

/** Erfassungsfunktionen (Pfad im Modul) mit Fussleisten-Beschriftung. */
export function captureInfo(path: string, sheep: boolean): { label: string; icon: string } | null {
  switch (path) {
    case 'geburt':
      return { label: sheep ? 'Ablammung' : 'Abkalbung', icon: sheep ? '🐑' : '🐄' }
    case 'belegung':
      return { label: 'Belegung', icon: '❤️' }
    case 'traechtigkeit':
      return { label: 'Trächtigkeit', icon: '🤰' }
    case 'klauen':
      return { label: 'Klauen', icon: '🐾' }
    case 'journal':
      return { label: 'Behandlung', icon: '💉' }
    case 'ohrmarken':
      return { label: 'Ohrmarken', icon: '🏷️' }
    case 'milchwaegung':
      return { label: 'Milchwägung', icon: '⚖️' }
    case 'tvd':
      return { label: 'TVD', icon: '📨' }
    default:
      return null
  }
}

export const CAPTURE_PATHS = ['geburt', 'belegung', 'traechtigkeit', 'klauen', 'journal', 'ohrmarken', 'milchwaegung', 'tvd']
const DEFAULT_CAPTURE = 'geburt'
const storageKey = (moduleKey: string) => `fmis_${moduleKey}_last_capture`

export function readLastCapture(moduleKey: string): string {
  try {
    const v = localStorage.getItem(storageKey(moduleKey))
    return v && CAPTURE_PATHS.includes(v) ? v : DEFAULT_CAPTURE
  } catch {
    return DEFAULT_CAPTURE
  }
}

export function writeLastCapture(moduleKey: string, path: string): void {
  if (!CAPTURE_PATHS.includes(path)) return
  try {
    if (localStorage.getItem(storageKey(moduleKey)) === path) return
    localStorage.setItem(storageKey(moduleKey), path)
  } catch {
    // ohne Speicher: gilt nur bis zum Neuladen nicht
  }
  notifyNavChanged()
}

/** Der Fussleisten-Punkt «zuletzt benutzte Erfassung». */
export function captureNavItem(moduleKey: string, sheep: boolean): NavItem {
  const path = readLastCapture(moduleKey)
  const info = captureInfo(path, sheep) ?? { label: 'Erfassen', icon: '✏️' }
  return { to: path, label: info.label, icon: info.icon, also: CAPTURE_PATHS }
}
