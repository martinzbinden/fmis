import type { NavItem } from './ModuleDescriptor'

/** Ereignis, nach dem die Fussleiste ihre dynamischen Punkte (NavItem.resolve) neu liest. */
export const NAV_EVENT = 'fmis-nav-changed'

export function notifyNavChanged(): void {
  window.dispatchEvent(new Event(NAV_EVENT))
}

/** Dynamische Punkte auflösen; ein fehlerhaftes `resolve` lässt den festen Punkt stehen. */
export function resolveNav(items: NavItem[]): NavItem[] {
  return items.map((i) => {
    if (!i.resolve) return i
    try {
      return { ...i, ...i.resolve() }
    } catch {
      return i
    }
  })
}

/** `rest` = Pfad nach dem Modul ohne Schrägstriche am Rand ('' = Startseite). */
export function navIsActive(rest: string, item: Pick<NavItem, 'to' | 'also'>): boolean {
  return [item.to, ...(item.also ?? [])].some((p) => (p === '' ? rest === '' : rest === p || rest.startsWith(`${p}/`)))
}
