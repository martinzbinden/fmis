import { getDb } from '../db/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import type { Parcel } from '../types'

// Tabellen, die per parcel_id auf parcels zeigen — beim Zusammenführen
// zweier Parzellen werden diese Zeilen umgehängt (über upsertRow, damit
// Outbox/Verlauf stimmen). Die Nährstoff-Anteile (fertilization_shares)
// tragen danach noch die Fläche der alten Parzelle — unter Auswertung
// „Neu berechnen" ausführen.
const REFERENCING: Array<
  'usage_entries' | 'fertilization_entries' | 'fertilization_shares' | 'n_dose_summary' | 'paddocks' | 'weed_observations'
> = ['usage_entries', 'fertilization_entries', 'fertilization_shares', 'n_dose_summary', 'paddocks', 'weed_observations']

/**
 * Führt eine manuell/aus Excel angelegte Parzelle (source) in eine GELAN-
 * Parzelle (target) über: alle Einträge wandern zur Ziel-Parzelle, leere
 * Textfelder des Ziels werden aus der Quelle übernommen, die Quelle wird
 * soft-gelöscht. Einfachste Form der "GELAN-Zuordnung" ohne
 * Geometrie-Duplikate — das Raster zeigt danach nur noch eine Zeile.
 */
export async function mergeParcel(source: Parcel, target: Parcel): Promise<void> {
  const pg = await getDb()
  for (const table of REFERENCING) {
    const { rows } = await pg.query<Record<string, unknown>>(
      `select * from "${table}" where parcel_id = $1 and deleted_at is null`,
      [source.id],
    )
    for (const row of rows) {
      await upsertRow(table, { ...row, parcel_id: target.id } as never)
    }
  }
  const patch: Partial<Parcel> = {}
  if (!target.wiesentyp && source.wiesentyp) patch.wiesentyp = source.wiesentyp
  if (!target.intensitaet && source.intensitaet) patch.intensitaet = source.intensitaet
  if (!target.notes && source.notes) patch.notes = source.notes
  if (Object.keys(patch).length > 0) {
    await upsertRow('parcels', { ...target, ...patch } as never)
  }
  await softDeleteRow('parcels', source.id)
}
