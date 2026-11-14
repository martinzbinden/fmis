import { readLastView } from './lastView'

/** Ansichten des Fussleisten-Punkts «Gruppen»: Karten (links, Vorgabe beim ersten Besuch) und Vergleich. */
export const GROUP_VIEWS = [
  { to: 'dashboard', label: 'Karten' },
  { to: 'gruppen', label: 'Vergleich' },
]

export const GROUP_VIEW_TOPIC = 'gruppen'

/** Zuletzt benutzte Ansicht des Punkts «Gruppen» (Pfad im Modul). */
export const lastGroupView = (moduleKey: string) =>
  readLastView(moduleKey, GROUP_VIEW_TOPIC, GROUP_VIEWS.map((v) => v.to), GROUP_VIEWS[0].to)

/** Adresse einer Tiergruppe in der zuletzt benutzten Ansicht; `animalId` hebt das Tier hervor. */
export function groupViewPath(moduleKey: string, groupId: string, animalId?: string): string {
  const q = new URLSearchParams({ gruppe: `herde:${groupId}` })
  if (animalId) q.set('tier', animalId)
  return `/${moduleKey}/${lastGroupView(moduleKey)}?${q.toString()}`
}
