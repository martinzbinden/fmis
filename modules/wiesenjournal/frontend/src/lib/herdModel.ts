// Herdengruppen und Standorte (schema/0017_herds.sql) — reine Funktionen
// (getestet): Kategorien, Bestand an einem Tag, Weide fürs Journal-Raster.

import type { AnimalRef } from '@fmis/core/animals'
import type { AnimalCategory, HerdCount, HerdGroup, HerdMember, HerdSpecies, HerdStay, UsageEntry } from '../types'
import { addDaysIso } from './format'

export interface HerdCategory {
  key: string
  label: string
  /** Kategorie im Weidejournal (Buchstabe X/Y/Z/G/W) */
  journal: AnimalCategory
}

export const HERD_CATEGORIES: Record<HerdSpecies, HerdCategory[]> = {
  schafe: [
    { key: 'auen_gemolken', label: 'Auen gemolken', journal: 'schafe' },
    { key: 'auen_galt', label: 'Auen galt', journal: 'schafe' },
    { key: 'jungschafe', label: 'Jungschafe', journal: 'schafe' },
    { key: 'widder', label: 'Widder', journal: 'schafe' },
    { key: 'laemmer', label: 'Lämmer', journal: 'schafe' },
  ],
  rinder: [
    { key: 'kuehe', label: 'Kühe', journal: 'kuehe' },
    { key: 'galtkuehe', label: 'Galtkühe', journal: 'galtkuehe' },
    { key: 'rinder', label: 'Rinder', journal: 'rinder' },
    { key: 'kaelber', label: 'Kälber', journal: 'kaelber' },
  ],
}

const ALL_CATEGORIES = [...HERD_CATEGORIES.schafe, ...HERD_CATEGORIES.rinder]
export const categoryLabel = (key: string) => ALL_CATEGORIES.find((c) => c.key === key)?.label ?? key
export const journalCategory = (key: string): AnimalCategory => ALL_CATEGORIES.find((c) => c.key === key)?.journal ?? 'schafe'

const ageDays = (birth: string | null, date: string) =>
  birth ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${birth}T00:00:00Z`)) / 86_400_000) : null

/** Vorschlag für die Kategorie eines Einzeltiers in einer Gruppe. */
export function defaultCategory(a: AnimalRef, milkingGroup: boolean, date: string): string {
  const age = ageDays(a.birth_date, date)
  if (a.species === 'schafe') {
    if (a.fattening || (age != null && age < 180)) return 'laemmer'
    if (a.sex === 'm') return 'widder'
    if (!a.parity) return 'jungschafe'
    return milkingGroup && !a.dry ? 'auen_gemolken' : 'auen_galt'
  }
  if (age != null && age < 180) return 'kaelber'
  if (a.sex !== 'w' || !a.parity) return 'rinder'
  return milkingGroup && !a.dry ? 'kuehe' : 'galtkuehe'
}

/** Zeile gilt am Tag `date` (from ≤ date ≤ to, to leer = offen). */
export const activeAt = (r: { from_date: string; to_date: string | null; deleted_at?: string | null }, date: string) =>
  !r.deleted_at && r.from_date <= date && (r.to_date == null || r.to_date >= date)

export interface Composition {
  members: HerdMember[]
  counts: HerdCount[]
  /** je Kategorie: Einzeltiere und ohne Nummer */
  byCategory: Map<string, { identified: number; anonymous: number }>
  total: number
}

export function compositionAt(groupId: string, members: HerdMember[], counts: HerdCount[], date: string): Composition {
  const m = members.filter((x) => x.group_id === groupId && activeAt(x, date))
  const c = counts.filter((x) => x.group_id === groupId && activeAt(x, date) && x.count > 0)
  const byCategory = new Map<string, { identified: number; anonymous: number }>()
  for (const x of m) {
    const e = byCategory.get(x.category) ?? { identified: 0, anonymous: 0 }
    e.identified++
    byCategory.set(x.category, e)
  }
  for (const x of c) {
    const e = byCategory.get(x.category) ?? { identified: 0, anonymous: 0 }
    e.anonymous += x.count
    byCategory.set(x.category, e)
  }
  return { members: m, counts: c, byCategory, total: m.length + c.reduce((s, x) => s + x.count, 0) }
}

/** "6 Auen gemolken (Nr.) · 11 Auen galt · 6 Jungschafe" */
export function compositionText(comp: Composition): string {
  return [...comp.byCategory]
    .map(([cat, n]) => {
      const total = n.identified + n.anonymous
      const detail = n.identified && n.anonymous ? ` (${n.identified} mit Nr.)` : n.identified ? ' (Nr.)' : ''
      return `${total} ${categoryLabel(cat)}${detail}`
    })
    .join(' · ')
}

/** Weide im Journal-Raster aus den Aufenthalten: je Tag, Parzelle und
 * Journal-Kategorie ein Eintrag mit der Anzahl Tiere der Gruppe. */
export function derivedWeideEntries(
  groups: HerdGroup[],
  stays: HerdStay[],
  members: HerdMember[],
  counts: HerdCount[],
  from: string,
  to: string,
  /** Offene Aufenthalte zählen bis zu diesem Tag (heute) — nicht in die Zukunft. */
  until: string = to,
): UsageEntry[] {
  const out: UsageEntry[] = []
  const byId = new Map(groups.map((g) => [g.id, g]))
  for (const s of stays) {
    if (s.deleted_at || s.slot !== 'weide' || !s.parcel_id) continue
    const group = byId.get(s.group_id)
    if (!group || group.deleted_at) continue
    let day = s.from_date > from ? s.from_date : from
    const end = s.to_date ?? (until < to ? until : to)
    const last = end > to ? to : end
    while (day <= last) {
      const comp = compositionAt(group.id, members, counts, day)
      const perJournal = new Map<AnimalCategory, number>()
      for (const [cat, n] of comp.byCategory) {
        const j = journalCategory(cat)
        perJournal.set(j, (perJournal.get(j) ?? 0) + n.identified + n.anonymous)
      }
      for (const [cat, n] of perJournal) {
        if (n <= 0) continue
        out.push({
          id: `herd-${s.id}-${day}-${cat}`,
          parcel_id: s.parcel_id,
          entry_date: day,
          usage_type: 'weide',
          animal_count: n,
          animal_group: group.name,
          paddock_version_id: null,
          notes: `Herde «${group.name}»`,
          updated_at: s.updated_at,
          deleted_at: null,
          animal_category: cat,
          day_only: s.day_only,
          label: null,
          value_num: null,
          yield_amount: null,
          yield_unit: null,
          import_key: null,
          is_planned: false,
          herd_group_id: group.id,
        })
      }
      day = addDaysIso(day, 1)
    }
  }
  return out
}
