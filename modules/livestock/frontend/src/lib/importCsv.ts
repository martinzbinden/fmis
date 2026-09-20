import type { PGlite } from '@electric-sql/pglite'
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

export interface EarTagImportResult {
  added: number
  alreadyMember: number
  unmatched: string[]
}

/**
 * Fügt anhand einer Ohrmarken-Liste (z.B. von einem APR600-Datenpool)
 * BEREITS EXISTIERENDE Tiere einer Gruppe hinzu — legt bewusst KEIN neues
 * Tier an, wenn die Ohrmarke unbekannt ist: der Leser liefert nur die
 * Ohrmarke, keine Pflichtfelder wie `sex` (not null), ein fabriziertes Tier
 * wäre falscher als eine sichtbare "unbekannt"-Meldung. Unbekannte Ohrmarken
 * werden stattdessen zurückgegeben, damit sie manuell (CSV/PDF-Import,
 * Ersterfassung) nachgetragen werden können. Wiederholter Import derselben
 * Ohrmarken ist idempotent (keine doppelten Mitgliedschaften).
 */
export async function addEarTagsToGroup(
  pg: PGlite,
  groupId: string,
  earTags: string[],
  startDate: string,
): Promise<EarTagImportResult> {
  const { rows: animals } = await pg.query<{ id: string; ear_tag: string }>(
    'select id, ear_tag from animals where deleted_at is null',
  )
  const earTagToId = new Map(animals.map((a) => [a.ear_tag, a.id]))

  const { rows: openMemberships } = await pg.query<{ animal_id: string }>(
    'select animal_id from group_memberships where group_id = $1 and end_date is null and deleted_at is null',
    [groupId],
  )
  const alreadyMemberIds = new Set(openMemberships.map((m) => m.animal_id))

  let added = 0
  let alreadyMember = 0
  const unmatched: string[] = []
  for (const earTag of earTags) {
    const animalId = earTagToId.get(earTag)
    if (!animalId) {
      unmatched.push(earTag)
      continue
    }
    if (alreadyMemberIds.has(animalId)) {
      alreadyMember++
      continue
    }
    await upsertRow('group_memberships', {
      id: crypto.randomUUID(),
      animal_id: animalId,
      group_id: groupId,
      start_date: startDate,
      end_date: null,
    })
    alreadyMemberIds.add(animalId)
    added++
  }

  return { added, alreadyMember, unmatched }
}
