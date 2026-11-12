// Gruppe mit dem Lesegerät scannen: Auswertung der gelesenen Ohrmarken und Vorschau des Speicherns.
// Gelesen wird live (Dialog «Gruppe scannen») oder offline vom Gerät (Vorschläge aus reader_pools).

import type { AnimalRef } from '@fmis/core/animals'
import { animalKey } from '@fmis/core/earTag'
import { readerTagToEarTag } from '@fmis/core/tagReader'
import { activeAt } from './herdModel'
import type { HerdData } from './herds'
import type { HerdGroup, HerdMember, HerdSpecies } from '../types'

export interface ScanResolved {
  /** erkannte Tiere, je Tier einmal, in Lesereihenfolge */
  matched: { tag: string; animal: AnimalRef }[]
  /** Ohrmarken, die zu keinem Tier im Bestand gehören */
  unknown: string[]
}

/** Gelesene Ohrmarken (lange Form vom Gerät) den Tieren im Bestand zuordnen. */
export function resolveTags(tags: string[], animals: readonly AnimalRef[]): ScanResolved {
  const byKey = new Map<string, AnimalRef>()
  for (const a of animals) {
    const k = animalKey(a.ear_tag)
    if (k && !byKey.has(k)) byKey.set(k, a)
  }
  const seen = new Set<string>()
  const matched: ScanResolved['matched'] = []
  const unknown: string[] = []
  for (const tag of tags) {
    const key = animalKey(readerTagToEarTag(tag))
    const animal = key ? byKey.get(key) : undefined
    if (!animal) {
      if (!unknown.includes(tag)) unknown.push(tag)
      continue
    }
    if (seen.has(animal.id)) continue
    seen.add(animal.id)
    matched.push({ tag, animal })
  }
  return { matched, unknown }
}

/** Tierart der Gruppe: die häufigste der erkannten Tiere (bei Gleichstand Schafe). */
export function majoritySpecies(animals: readonly AnimalRef[]): HerdSpecies {
  const n = animals.filter((a) => a.species === 'rinder').length
  return n > animals.length - n ? 'rinder' : 'schafe'
}

export interface SavePlan {
  /** kommen neu in die Gruppe */
  add: AnimalRef[]
  /** stehen schon in der Gruppe */
  stay: AnimalRef[]
  /** verlassen die Gruppe (nur beim Ersetzen) */
  leaving: HerdMember[]
  /** kommen aus einer anderen Gruppe */
  moving: { animal: AnimalRef; from: HerdGroup }[]
}

/** Was passiert beim Speichern? Gleiche Regeln wie lib/herds.ts constituteGroup. */
export function planSave(data: HerdData, group: HerdGroup | null, animals: readonly AnimalRef[], date: string, replace: boolean): SavePlan {
  const ids = new Set(animals.map((a) => a.id))
  const inGroup = group ? data.members.filter((m) => m.group_id === group.id && (m.to_date == null || m.to_date >= date)) : []
  const already = new Set(inGroup.filter((m) => m.from_date <= date).map((m) => m.animal_id))
  const add = animals.filter((a) => !already.has(a.id))
  const stay = animals.filter((a) => already.has(a.id))
  const leaving = replace && group ? inGroup.filter((m) => !ids.has(m.animal_id)) : []
  const moving: SavePlan['moving'] = []
  for (const a of add) {
    const m = data.members.find((x) => x.animal_id === a.id && activeAt(x, date))
    const from = m ? data.groups.find((g) => g.id === m.group_id) : undefined
    if (from && from.id !== group?.id) moving.push({ animal: a, from })
  }
  return { add, stay, leaving, moving }
}

// Der Entwurf überlebt Schliessen des Dialogs und Neuladen (Handy im Stall): je Gerät im Browser.
const DRAFT_KEY = 'tiere_scan_draft'

export function loadScanDraft(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveScanDraft(tags: string[]): void {
  try {
    if (tags.length === 0) localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(tags))
  } catch {
    // nur bis zum Neuladen
  }
}

export interface PoolProposal {
  id: string
  device_group_id: string
  name: string | null
  device_count: number | null
  tag_count: number
  tags: string[]
  unmatched: string[]
  fetched_at: string
  status: 'neu' | 'bekannt' | 'importiert' | 'verworfen' | 'ersetzt'
}

const parseList = (text: unknown): string[] => {
  try {
    const v = JSON.parse(String(text ?? '[]')) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** Zeile aus reader_pools → Vorschlag (Ohrmarken und nicht verstandene Zeilen als Listen). */
export function toProposal(r: Record<string, unknown>): PoolProposal {
  return {
    id: String(r.id),
    device_group_id: String(r.device_group_id),
    name: (r.name as string | null) ?? null,
    device_count: r.device_count == null ? null : Number(r.device_count),
    tag_count: Number(r.tag_count ?? 0),
    tags: parseList(r.tags),
    unmatched: parseList(r.unmatched),
    fetched_at: r.fetched_at instanceof Date ? r.fetched_at.toISOString() : String(r.fetched_at),
    status: String(r.status) as PoolProposal['status'],
  }
}
