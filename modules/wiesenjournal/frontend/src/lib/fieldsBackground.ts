// Optionaler, rein lesender Blick in die Kulturen (fields)-Parzellen als
// Karten-Hintergrund — NICHT über eine SQL-FK (Module sind fachlich isoliert,
// siehe core/backend/fmis_core/db.py), sondern per schema-qualifizierter
// Abfrage auf der gemeinsamen pglite-Datenbank (core/frontend/src/db.ts):
// wiesenjournal liest "fields.field_declarations" direkt, ohne eine eigene
// Verbindung zu öffnen. Klappt nur, wenn das Schema "fields" in diesem
// Browser schon existiert — d.h. die Kulturen-App wurde hier schon mal
// geöffnet/synchronisiert. Sonst wirft die Abfrage (Schema/Tabelle fehlt),
// was hier bewusst als "nicht verfügbar" statt als Fehler behandelt wird
// (best effort, kein technischer Verbund zwischen den Modulen, siehe
// modules/wiesenjournal/README.md).
import { getSharedDbRaw } from '@fmis/core/db'

export interface FieldsBackgroundFeature {
  id: string
  flurname: string | null
  kulturName: string | null
  geometry: string
}

let cached: Promise<FieldsBackgroundFeature[]> | null = null

export async function loadFieldsBackground(): Promise<FieldsBackgroundFeature[]> {
  if (!cached) {
    cached = (async () => {
      try {
        const pg = await getSharedDbRaw()
        const year = new Date().getFullYear()
        const { rows } = await pg.query<{
          id: string
          flurname: string | null
          kultur_name_de: string | null
          geometry: string | null
        }>(
          `select id, flurname, kultur_name_de, geometry from "fields"."field_declarations"
           where deleted_at is null and geometry is not null and jahr = $1
           order by jahr desc limit 500`,
          [year],
        )
        return rows
          .filter((r) => r.geometry)
          .map((r) => ({ id: r.id, flurname: r.flurname, kulturName: r.kultur_name_de, geometry: r.geometry! }))
      } catch {
        return []
      }
    })()
  }
  return cached
}
