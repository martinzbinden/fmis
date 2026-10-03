import type { PGlite } from '@electric-sql/pglite'
import type { FertilizationEntry, UsageEntry } from '../types'
import { isoDate, todayIso } from './format'
import { loadHerdData } from './herds'
import { derivedWeideEntries } from './herdModel'

function normalize<T extends { entry_date: string }>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, entry_date: isoDate(r.entry_date) }))
}

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
    // Düngung: Anker-Parzelle ODER Anteil (Polygon/Track/mehrere Parzellen
    // erscheinen auf jeder betroffenen Parzelle).
    pg.query<FertilizationEntry>(
      `select distinct e.* from fertilization_entries e
       left join fertilization_shares s on s.entry_id = e.id and s.deleted_at is null
       where e.entry_date = $2 and e.deleted_at is null and (e.parcel_id = $1 or s.parcel_id = $1)
       order by e.updated_at`,
      [parcelId, date],
    ),
  ])
  return { usage: normalize(usage.rows), fertilizations: normalize(fert.rows) }
}

/** Nutzungseinträge EINER Parzelle in einem Datumsbereich — für die Serien-
 * Erkennung im Klassisch-Editor (components/DayEntryEditorClassic.tsx):
 * beim Öffnen eines Tages mit Eintrag die ganze zusammenhängende Reihe
 * gleicher Einträge finden (siehe lib/journalRun.ts), damit ein Bearbeiten
 * den ganzen erkennbaren Balken erfasst statt nur den einen Tag. */
export async function loadParcelUsageInRange(pg: PGlite, parcelId: string, from: string, to: string): Promise<UsageEntry[]> {
  const { rows } = await pg.query<UsageEntry>(
    'select * from usage_entries where parcel_id = $1 and entry_date between $2 and $3 and deleted_at is null order by entry_date',
    [parcelId, from, to],
  )
  return normalize(rows)
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
  // Weide aus Herdengruppen (lib/herdModel.ts) — abgeleitet, nicht gespeichert
  const herd = await loadHerdData(pg)
  const derived = derivedWeideEntries(herd.groups, herd.stays, herd.members, herd.counts, from, to, todayIso())
  return { usage: [...normalize(usage.rows), ...derived], fertilizations: normalize(fert.rows) }
}
