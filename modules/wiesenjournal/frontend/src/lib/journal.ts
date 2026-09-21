import type { PGlite } from '@electric-sql/pglite'
import type { FertilizationEntry, Parcel, UsageEntry } from '../types'
import { isoDate, usageDescription } from './format'

export interface JournalRow {
  id: string
  kind: 'nutzung' | 'duengung'
  date: string
  parcelId: string
  parcelName: string
  summary: string
  detail: string | null
  source: UsageEntry | FertilizationEntry
}

export async function loadJournalRows(pg: PGlite, seasonYear: number, showAcker = true): Promise<JournalRow[]> {
  const { rows: parcels } = await pg.query<Parcel>(
    `select * from parcels where season_year = $1 and deleted_at is null${showAcker ? '' : " and category <> 'acker'"}`,
    [seasonYear],
  )
  const parcelName = new Map(parcels.map((p) => [p.id, p.name]))
  const parcelIds = parcels.map((p) => p.id)
  if (parcelIds.length === 0) return []

  const [{ rows: usage }, { rows: fert }] = await Promise.all([
    pg.query<UsageEntry>(
      `select * from usage_entries where deleted_at is null and parcel_id = any($1)`,
      [parcelIds],
    ),
    pg.query<FertilizationEntry>(
      `select * from fertilization_entries where deleted_at is null and parcel_id = any($1)`,
      [parcelIds],
    ),
  ])

  const rows: JournalRow[] = [
    ...usage.map((u): JournalRow => ({
      id: u.id,
      kind: 'nutzung',
      date: isoDate(u.entry_date),
      parcelId: u.parcel_id,
      parcelName: parcelName.get(u.parcel_id) ?? '?',
      summary: usageDescription(u),
      detail: [u.animal_group, u.notes].filter(Boolean).join(' · ') || null,
      source: u,
    })),
    ...fert.map((f): JournalRow => ({
      id: f.id,
      kind: 'duengung',
      date: isoDate(f.entry_date),
      parcelId: f.parcel_id,
      parcelName: parcelName.get(f.parcel_id) ?? '?',
      summary: f.duengung_code,
      detail: [f.amount != null ? `${f.amount} ${f.unit}` : null, f.gabe_number ? `Gabe ${f.gabe_number}` : null]
        .filter(Boolean)
        .join(' · ') || null,
      source: f,
    })),
  ]

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return rows
}
