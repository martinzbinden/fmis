import { upsertRow } from '../db/write'

export interface SeedRow {
  ear_tag: string
  birth_date: string
  sex: 'm' | 'w' | 'k'
}

export function parseIntakeCsv(csv: string): SeedRow[] {
  const lines = csv.trim().split(/\r?\n/)
  const [header, ...dataLines] = lines
  const cols = header.split(',').map((c) => c.trim())
  return dataLines
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const values = line.split(',').map((v) => v.trim())
      const row: Record<string, string> = {}
      cols.forEach((c, i) => (row[c] = values[i]))
      return row as unknown as SeedRow
    })
}

/**
 * Legt eine neue Gruppe an und importiert die übergebenen Tiere (aus CSV- oder
 * PDF-Import) als aktive Tiere mit Gruppenmitgliedschaft ab dem Eingangsdatum.
 * Die Quelldatei kommt vom Nutzer per Datei-Upload — es gibt keine im Build
 * enthaltene Tierdaten-Datei, damit keine echten Tierdaten im Repo/Build landen.
 */
export async function importAnimalRows(
  rows: SeedRow[],
  groupName: string,
  intakeDate: string,
): Promise<{ groupId: string; count: number }> {
  if (rows.length === 0) {
    throw new Error('Keine Tiere zum Importieren gefunden')
  }
  const groupId = crypto.randomUUID()

  await upsertRow('animal_groups', {
    id: groupId,
    name: groupName,
    created_date: intakeDate,
    target_weight_min_kg: 45,
    target_weight_max_kg: 50,
    status: 'aktiv',
    notes: null,
  })

  for (const row of rows) {
    const animalId = crypto.randomUUID()
    await upsertRow('animals', {
      id: animalId,
      ear_tag: row.ear_tag,
      birth_date: row.birth_date,
      sex: row.sex,
      status: 'aktiv',
      entry_date: intakeDate,
      entry_weight_kg: null,
      purchase_cost: 0,
      source_tvd_nr: null,
      source_name: null,
      notes: null,
    })

    await upsertRow('group_memberships', {
      id: crypto.randomUUID(),
      animal_id: animalId,
      group_id: groupId,
      start_date: intakeDate,
      end_date: null,
    })
  }

  return { groupId, count: rows.length }
}
