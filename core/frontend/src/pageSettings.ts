import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

// Einstellungen der gerade offenen Seite im Zahnrad-Menü (AdminMenu.tsx): eine Seite meldet beim Öffnen Titel und Inhalt an
// und beim Verlassen wieder ab. So stehen z.B. die Einstellungen der Milchwägung dort, wo man sie sucht.

export interface PageSettings {
  title: string
  render: () => ReactNode
}

let current: PageSettings | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function usePageSettingsEntry(): PageSettings | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

/** Für die Seite: Einstellungen im Zahnrad-Menü anbieten, solange die Seite offen ist. */
export function usePageSettings(entry: PageSettings | null, deps: unknown[]): void {
  useEffect(() => {
    current = entry
    emit()
    return () => {
      if (current === entry) {
        current = null
        emit()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
