// Dashboard: Gruppenwechsel als Entwurf. Ziehen oder «Verschieben» ändert nur diesen Entwurf;
// erst «Bestätigen» schreibt (mit einem Datum, das noch angepasst werden kann).

/** Tier-ID → Ziel-Gruppe (null = ohne Gruppe). Nur Tiere, deren Ziel von der heutigen Gruppe abweicht. */
export type DraftMoves = Record<string, string | null>

/** Heutige Gruppe je Tier (null = ohne Gruppe). */
export type CurrentGroups = ReadonlyMap<string, string | null>

/** Ziel für diese Tiere setzen. Wer schon in der Zielgruppe steht, bekommt keinen Eintrag (und ein alter fällt weg). */
export function setTargets(draft: DraftMoves, animalIds: string[], target: string | null, current: CurrentGroups): DraftMoves {
  const next = { ...draft }
  for (const id of animalIds) {
    if ((current.get(id) ?? null) === target) delete next[id]
    else next[id] = target
  }
  return next
}

export function clearTargets(draft: DraftMoves, animalIds: string[]): DraftMoves {
  const next = { ...draft }
  for (const id of animalIds) delete next[id]
  return next
}

/** Gruppe, in der das Tier mit dem Entwurf steht. */
export function effectiveGroup(draft: DraftMoves, id: string, current: CurrentGroups): string | null {
  return id in draft ? draft[id] : (current.get(id) ?? null)
}

export interface DraftLine {
  from: string | null
  to: string | null
  ids: string[]
}

/** Zusammenfassung «n Tiere von A nach B» für die Bestätigung. */
export function summarizeDraft(draft: DraftMoves, current: CurrentGroups, nameOf: (groupId: string | null) => string): DraftLine[] {
  const lines = new Map<string, DraftLine>()
  for (const [id, to] of Object.entries(draft)) {
    const from = current.get(id) ?? null
    const key = `${from ?? ''}>${to ?? ''}`
    const line = lines.get(key) ?? { from, to, ids: [] }
    line.ids.push(id)
    lines.set(key, line)
  }
  return [...lines.values()].sort((a, b) => nameOf(a.from).localeCompare(nameOf(b.from), 'de') || nameOf(a.to).localeCompare(nameOf(b.to), 'de'))
}

/** Tiere des Entwurfs je Zielgruppe; `null` sammelt die, die ohne Gruppe enden. */
export function groupByTarget(draft: DraftMoves): Map<string | null, string[]> {
  const out = new Map<string | null, string[]>()
  for (const [id, to] of Object.entries(draft)) out.set(to, [...(out.get(to) ?? []), id])
  return out
}

export const draftSize = (draft: DraftMoves) => Object.keys(draft).length

/** Überholte Einträge streichen: Tier nicht mehr im Bestand, Zielgruppe aufgelöst, oder das Tier steht
 * inzwischen schon dort (z.B. von einem anderen Gerät verschoben). */
export function pruneDraft(draft: DraftMoves, current: CurrentGroups, groupExists: (id: string) => boolean): DraftMoves {
  const next: DraftMoves = {}
  for (const [id, to] of Object.entries(draft)) {
    if (!current.has(id)) continue
    if (to != null && !groupExists(to)) continue
    if ((current.get(id) ?? null) === to) continue
    next[id] = to
  }
  return next
}
