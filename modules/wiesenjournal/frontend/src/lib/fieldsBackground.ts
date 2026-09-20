// Optionaler, rein lesender Blick in die Kulturen (fields)-Parzellen als
// Karten-Hintergrund — NICHT über eine SQL-FK (Module sind isoliert, siehe
// core/backend/fmis_core/db.py), sondern indem der Browser direkt eine
// zweite pglite-Instanz auf derselben IndexedDB öffnet, die das
// fields-Modul selbst anlegt ('idb://fields'). Klappt nur, wenn die
// Kulturen-App in diesem Browser schon mal geöffnet/synchronisiert wurde —
// sonst existiert die Datenbank/Tabelle noch nicht, was hier bewusst als
// "nicht verfügbar" statt als Fehler behandelt wird (best effort, v1: kein
// technischer Verbund zwischen den Modulen, siehe modules/wiesenjournal/README.md).
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
        const { PGlite } = await import('@electric-sql/pglite')
        const pg = new PGlite('idb://fields')
        const year = new Date().getFullYear()
        const { rows } = await pg.query<{
          id: string
          flurname: string | null
          kultur_name_de: string | null
          geometry: string | null
        }>(
          `select id, flurname, kultur_name_de, geometry from field_declarations
           where deleted_at is null and geometry is not null and jahr = $1
           order by jahr desc limit 500`,
          [year],
        )
        await pg.close()
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
