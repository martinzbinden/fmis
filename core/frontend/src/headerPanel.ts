// Welches Seitenfenster der Kopfzeile offen ist (SidePanel.tsx). Immer höchstens eines: ein anderes Symbol wechselt
// direkt, dasselbe nochmals schliesst. Gemeinsam für alle Kopfzeilen (Module, Übersicht, Verwaltung).

import { useSyncExternalStore } from 'react'

export type PanelKey = 'status' | 'import' | 'verlauf' | 'benachrichtigungen' | 'profil' | 'suche'

let open: PanelKey | null = null
/** nächster Seitenwechsel schliesst nicht (z.B. /import öffnet und springt zurück) */
let keepOnNextNavigation = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openPanel(key: PanelKey, opts: { survivesNavigation?: boolean } = {}): void {
  keepOnNextNavigation = !!opts.survivesNavigation
  if (open === key) return
  open = key
  emit()
}

export function closePanel(key?: PanelKey): void {
  if (open == null || (key && open !== key)) return
  open = null
  emit()
}

export function togglePanel(key: PanelKey): void {
  if (open === key) closePanel()
  else openPanel(key)
}

/** Seitenwechsel: offenes Fenster schliessen (ein Link im Fenster führt woandershin). */
export function panelNavigated(): void {
  if (keepOnNextNavigation) {
    keepOnNextNavigation = false
    return
  }
  closePanel()
}

export function useOpenPanel(): PanelKey | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => open,
  )
}
