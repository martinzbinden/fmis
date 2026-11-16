// Laden von Journal-Einträgen. Aus fmis lib/journalEntry.ts und lib/journal.ts (59425bb), ohne die aus den Herden
// abgeleitete Weide; seit Etappe 1c direkt aus dem Store.

import type { Store } from '../db/store'
import type { FertilizationEntry, Parcel, UsageEntry } from '../types'
import { usageDescription, UNIT_LABEL } from './format'
import { nutzungen } from './herden'

const byUpdated = (a: { updated_at: string }, b: { updated_at: string }) => (a.updated_at < b.updated_at ? -1 : 1)

/** Alle Einträge für eine (Parzelle, Tag)-Kombination; Düngungen auch über Anteile. */
export function loadDayEntries(s: Store, parcelId: string, date: string) {
  const usage = s.rows('usage_entries').filter((u) => u.parcel_id === parcelId && u.entry_date === date).sort(byUpdated)
  const viaShare = new Set(s.rows('fertilization_shares').filter((x) => x.parcel_id === parcelId).map((x) => x.entry_id))
  const fertilizations = s
    .rows('fertilization_entries')
    .filter((e) => e.entry_date === date && (e.parcel_id === parcelId || viaShare.has(e.id)))
    .sort(byUpdated)
  return { usage, fertilizations }
}

export function loadEntriesInRange(s: Store, from: string, to: string): { usage: UsageEntry[]; fertilizations: FertilizationEntry[] } {
  const inRange = (d: string) => d >= from && d <= to
  return {
    usage: nutzungen(s, from, to),
    fertilizations: s.rows('fertilization_entries').filter((e) => inRange(e.entry_date)),
  }
}

export interface JournalRow {
  id: string
  kind: 'nutzung' | 'duengung'
  date: string
  parcel: Parcel
  summary: string
  detail: string | null
  incomplete: boolean
}

const EXTENT_TEXT: Record<string, string> = { parcels: 'mehrere Parzellen', polygon: 'Teilfläche' }

/** Flaches Journal einer Saison, neueste zuerst. */
export function loadJournalRows(s: Store, year: number): { rows: JournalRow[]; parcels: Parcel[] } {
  const parcels = s
    .rows('parcels')
    .filter((p) => p.season_year === year)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const byId = new Map(parcels.map((p) => [p.id, p]))
  const rows: JournalRow[] = []
  for (const u of nutzungen(s, `${year}-01-01`, `${year}-12-31`)) {
    const parcel = byId.get(u.parcel_id)
    if (!parcel) continue
    rows.push({
      id: u.id,
      kind: 'nutzung',
      date: u.entry_date,
      parcel,
      summary: usageDescription(u),
      detail: [u.herde_aufenthalt_id ? `Herde ${u.animal_group}` : u.animal_group, u.notes].filter(Boolean).join(' · ') || null,
      incomplete: false,
    })
  }
  for (const f of s.rows('fertilization_entries')) {
    const parcel = f.parcel_id ? byId.get(f.parcel_id) : undefined
    if (!parcel) continue
    rows.push({
      id: f.id,
      kind: 'duengung',
      date: f.entry_date,
      parcel,
      summary: `${f.code}${f.amount != null ? ` ${Number(f.amount)} ${UNIT_LABEL[f.unit] ?? f.unit}` : ''}`,
      detail:
        [
          f.container_count != null ? `${Number(f.container_count)} × ${Number(f.container_size ?? 0)}` : null,
          f.n_kg != null ? `${Number(f.n_kg)} kg N` : null,
          EXTENT_TEXT[f.extent_type] ?? null,
          f.gabe_number ? `Gabe ${f.gabe_number}` : null,
          f.trip_id ? 'aus GPS-Fahrt' : null,
          f.notes,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      incomplete: !!f.incomplete,
    })
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return { rows, parcels }
}
