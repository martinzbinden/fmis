import type { PGlite } from '@electric-sql/pglite'
import type { FertilizationEntry, UsageEntry } from '../types'

export interface DayEntries {
  usage: UsageEntry[]
  fertilizations: FertilizationEntry[]
}

/** Lädt alle Nutzungs-/Düngungs-Einträge für eine (Parzelle, Tag)-Kombination. */
export async function loadDayEntries(pg: PGlite, parcelId: string, date: string): Promise<DayEntries> {
  const [usage, fert] = await Promise.all([
    pg.query<UsageEntry>(
      'select * from usage_entries where parcel_id = $1 and entry_date = $2 and deleted_at is null order by updated_at',
      [parcelId, date],
    ),
    pg.query<FertilizationEntry>(
      'select * from fertilization_entries where parcel_id = $1 and entry_date = $2 and deleted_at is null order by updated_at',
      [parcelId, date],
    ),
  ])
  return { usage: usage.rows, fertilizations: fert.rows }
}

/** Lädt Nutzungs-/Düngungs-Einträge für ALLE Parzellen in einem Datumsbereich (für das Journal-Raster). */
export async function loadEntriesInRange(
  pg: PGlite,
  from: string,
  to: string,
): Promise<{ usage: UsageEntry[]; fertilizations: FertilizationEntry[] }> {
  const [usage, fert] = await Promise.all([
    pg.query<UsageEntry>(
      'select * from usage_entries where entry_date between $1 and $2 and deleted_at is null',
      [from, to],
    ),
    pg.query<FertilizationEntry>(
      'select * from fertilization_entries where entry_date between $1 and $2 and deleted_at is null',
      [from, to],
    ),
  ])
  return { usage: usage.rows, fertilizations: fert.rows }
}
