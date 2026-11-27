// Zuchtauswahl der Jungtiere über alle Seiten: Wahl je Nachkomme lesen (neueste Zeile in lamb_selection gewinnt),
// offene Wahl erkennen (nichts gewählt oder nur vorläufig), speichern, Geburt zu einem Tier finden und die
// automatisch nachgeführte Liste «Zuchtlämmer» (Merklisten, Dashboard, Tiergruppen zuteilen).
// Wo man die Wahl trifft: nach der Geburt (Dialog), beim Absetzen/Wegnehmen (wenn offen), auf der Tierseite,
// in der Jungtier-Selektion.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import { isoDate } from './format'
import type { Preselection } from './lambRecommendation'
import type { Species } from './fertility'

/** Merkliste, die FMIS selbst führt (nicht in der Tabelle watchlists) */
export const AUTO_LIST_ID = 'auto-zucht'
export const autoListName = (species: Species) => (species === 'sheep' ? 'Zuchtlämmer' : 'Zuchtkälber')
/** Jungtier bleibt bis zu diesem Alter auf der automatischen Liste (sofern es nicht selbst geboren hat) */
export const AUTO_LIST_MAX_DAYS = 730

export interface ChoiceRow {
  id: string
  animal_key: string | null
  offspring_id: string | null
  purpose: 'zucht' | 'mast' | null
  leaning: 'eher_ja' | 'eher_nein' | 'spaeter' | null
  notes: string | null
  updated_at?: unknown
}

export const choiceOfRow = (s: Pick<ChoiceRow, 'purpose' | 'leaning'> | null | undefined): Preselection | null => s?.purpose ?? s?.leaning ?? null

/** Zucht oder Mast ist entschieden; alles andere (nichts, eher ja, später, eher nein) ist noch offen. */
export const isOpenChoice = (p: Preselection | null | undefined) => p !== 'zucht' && p !== 'mast'

export interface ChoiceIndex {
  byOffspring: Map<string, ChoiceRow>
  byKey: Map<string, ChoiceRow>
}

/** Zeilen aufsteigend nach updated_at: die neueste gewinnt. */
export function indexChoices(rows: ChoiceRow[]): ChoiceIndex {
  const byOffspring = new Map<string, ChoiceRow>()
  const byKey = new Map<string, ChoiceRow>()
  for (const s of rows) {
    if (s.offspring_id) byOffspring.set(s.offspring_id, s)
    if (s.animal_key) byKey.set(s.animal_key, s)
  }
  return { byOffspring, byKey }
}

/** Wahl eines Nachkommen: zuerst über die Geburt, sonst über die Ohrmarke (Entscheid aus der Jungtier-Selektion). */
export function rowFor(index: ChoiceIndex, offspringId: string | null, key: string | null): ChoiceRow | null {
  return (offspringId ? index.byOffspring.get(offspringId) : undefined) ?? (key ? index.byKey.get(key) : undefined) ?? null
}

export async function loadChoiceIndex(pg: PGlite): Promise<ChoiceIndex> {
  const { rows } = await pg.query<ChoiceRow>('select * from lamb_selection where deleted_at is null order by updated_at')
  return indexChoices(rows)
}

/** Wahl je Tierschlüssel (Ohrmarke), für Karten und Listen. */
export async function loadChoicesByKey(pg: PGlite): Promise<Map<string, Preselection>> {
  const [index, offspring] = await Promise.all([
    loadChoiceIndex(pg),
    pg.query<{ id: string; animal_key: string | null; ear_tag: string | null }>('select id, animal_key, ear_tag from birth_offspring where deleted_at is null and (animal_key is not null or ear_tag is not null)'),
  ])
  const out = new Map<string, Preselection>()
  for (const [key, row] of index.byKey) {
    const c = choiceOfRow(row)
    if (c) out.set(key, c)
  }
  // Vorauswahl nach der Geburt, bevor die Ohrmarke in lamb_selection stand
  for (const o of offspring.rows) {
    const key = o.animal_key ?? animalKey(o.ear_tag)
    const row = index.byOffspring.get(String(o.id))
    if (!key || !row) continue
    const byKey = index.byKey.get(key)
    if (byKey && String(byKey.updated_at ?? '') >= String(row.updated_at ?? '')) continue
    const c = choiceOfRow(row)
    if (c) out.set(key, c)
  }
  return out
}

export interface OpenBirth {
  birthId: string
  offspringIds: string[]
}

/** Lebende Nachkommen ohne endgültige Wahl, nach Geburt gruppiert (für die Rückfrage beim Absetzen). */
export async function openChoices(pg: PGlite, offspringIds: string[]): Promise<OpenBirth[]> {
  if (offspringIds.length === 0) return []
  const [index, res] = await Promise.all([
    loadChoiceIndex(pg),
    pg.query<{ id: string; birth_id: string; animal_key: string | null; ear_tag: string | null; stillborn: unknown; died_24h: unknown; died_on: unknown }>(
      'select id, birth_id, animal_key, ear_tag, stillborn, died_24h, died_on from birth_offspring where deleted_at is null and id = any($1::uuid[]) order by import_key',
      [offspringIds],
    ),
  ])
  const out = new Map<string, string[]>()
  for (const o of res.rows) {
    if (o.stillborn || o.died_24h || o.died_on) continue
    const key = o.animal_key ?? animalKey(o.ear_tag)
    if (!isOpenChoice(choiceOfRow(rowFor(index, String(o.id), key)))) continue
    out.set(String(o.birth_id), [...(out.get(String(o.birth_id)) ?? []), String(o.id)])
  }
  return [...out].map(([birthId, ids]) => ({ birthId, offspringIds: ids }))
}

/** Wahl speichern (null nimmt sie zurück). Zucht und Mast gelten als Entscheid wie in der Jungtier-Selektion,
 * der Rest bleibt vorläufig. Schreibt in die bestehende Zeile des Tiers, sonst eine neue. */
export async function saveChoice(pg: PGlite, offspringId: string, next: Preselection | null, today: string): Promise<void> {
  const { rows } = await pg.query<{ animal_key: string | null; ear_tag: string | null }>('select animal_key, ear_tag from birth_offspring where id = $1', [offspringId])
  if (!rows[0]) throw new Error('Nachkomme nicht gefunden.')
  const key = rows[0].animal_key ?? animalKey(rows[0].ear_tag)
  const existing = rowFor(await loadChoiceIndex(pg), offspringId, key)
  const purpose = next === 'zucht' || next === 'mast' ? next : null
  await upsertRow(pg, 'lamb_selection', {
    id: existing?.id ?? crypto.randomUUID(),
    animal_key: key,
    offspring_id: offspringId,
    purpose,
    leaning: next && !purpose ? next : null,
    decided_on: purpose ? today : null,
    notes: existing?.notes ?? null,
  })
}

/** Geburt, aus der ein Tier stammt (in FMIS erfasst oder aus dem Herdebuch importiert); null ohne. */
export async function birthOfAnimal(pg: PGlite, earTag: string): Promise<{ birthId: string; offspringId: string; birthDate: string | null } | null> {
  const key = animalKey(earTag)
  if (!key) return null
  const { rows } = await pg.query<{ id: string; birth_id: string; animal_key: string | null; ear_tag: string | null; birth_date: unknown }>(
    `select o.id, o.birth_id, o.animal_key, o.ear_tag, b.birth_date from birth_offspring o join births b on b.id = o.birth_id and b.deleted_at is null
     where o.deleted_at is null and (o.animal_key = $1 or (o.animal_key is null and o.ear_tag is not null))
     order by b.birth_date desc`,
    [key],
  )
  const hit = rows.find((r) => (r.animal_key ?? animalKey(r.ear_tag)) === key)
  return hit ? { birthId: String(hit.birth_id), offspringId: String(hit.id), birthDate: isoDate(hit.birth_date) } : null
}

export interface AutoListAnimal {
  id: string
  choice: Preselection
}

/** Tiere der automatischen Liste: zur Zucht gewählt, im Bestand, jünger als zwei Jahre, selbst noch nicht geboren. */
export function autoListAnimals(
  animals: { id: string; ear_tag: string; status: string | null; birth_date: unknown }[],
  choices: Map<string, Preselection>,
  mothers: Set<string>,
  today: string,
): AutoListAnimal[] {
  const t = Date.parse(`${today}T00:00:00Z`)
  const out: AutoListAnimal[] = []
  for (const a of animals) {
    if (a.status !== 'aktiv' || mothers.has(a.id)) continue
    const choice = choices.get(animalKey(a.ear_tag) ?? '')
    if (choice !== 'zucht') continue
    const born = isoDate(a.birth_date)
    if (born && (t - Date.parse(`${born}T00:00:00Z`)) / 86_400_000 > AUTO_LIST_MAX_DAYS) continue
    out.push({ id: a.id, choice })
  }
  return out
}

export async function loadAutoList(pg: PGlite, today: string): Promise<AutoListAnimal[]> {
  const [animals, choices, mothers] = await Promise.all([
    pg.query<{ id: string; ear_tag: string; status: string | null; birth_date: unknown }>('select id, ear_tag, status, birth_date from animals where deleted_at is null'),
    loadChoicesByKey(pg),
    pg.query<{ dam_id: string }>('select distinct dam_id from births where deleted_at is null'),
  ])
  return autoListAnimals(animals.rows, choices, new Set(mothers.rows.map((m) => String(m.dam_id))), today)
}
