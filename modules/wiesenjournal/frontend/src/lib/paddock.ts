import { getDb } from '../db/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { todayIso } from './format'
import type { Paddock } from '../types'

type PaddockInput = Pick<Paddock, 'parcel_id' | 'season_year' | 'valid_from' | 'animal_group' | 'geometry' | 'notes'>

/**
 * Legt einen neuen Weidegang (Version 1) an — dieselbe "jede Änderung ist
 * eine neue Version"-Logik wie modules/fields/frontend/src/lib/planLayer.ts
 * (plan_parcels), hier angewendet auf Zaun-/Weidegang-Geometrie: nichts wird
 * je in-place überschrieben, der aktuelle Zustand ist immer die Zeile mit
 * is_current=true zur höchsten version_number.
 */
export async function createPaddock(input: PaddockInput): Promise<string> {
  const paddockId = crypto.randomUUID()
  await upsertRow('paddocks', {
    id: crypto.randomUUID(),
    paddock_id: paddockId,
    version_number: 1,
    is_current: true,
    valid_to: null,
    created_by: getCurrentUserEmail(),
    ...input,
  })
  return paddockId
}

async function loadCurrentVersion(paddockId: string): Promise<Paddock> {
  const pg = await getDb()
  const { rows } = await pg.query<Paddock>(
    `select * from paddocks where paddock_id = $1 and is_current = true limit 1`,
    [paddockId],
  )
  if (rows.length === 0) throw new Error(`Keine aktuelle Version für Weidegang ${paddockId} gefunden`)
  return rows[0]
}

/**
 * Speichert eine neue Version eines Weidegangs (Zaun verschoben, Tiergruppe
 * geändert, o.ä.): die bisherige aktuelle Zeile wird auf is_current=false
 * gesetzt, danach eine neue Zeile mit den gemergten Feldern eingefügt — so
 * ist "jeder geänderte Zaun sofort erfasst" (Ist-Zustand = aktuellste
 * Version) und die volle Historie bleibt erhalten.
 */
export async function saveNewVersion(
  paddockId: string,
  changes: Partial<PaddockInput> & { deleted_at?: string | null; valid_to?: string | null },
): Promise<void> {
  const current = await loadCurrentVersion(paddockId)
  await upsertRow('paddocks', { ...current, is_current: false })
  await upsertRow('paddocks', {
    ...current,
    ...changes,
    id: crypto.randomUUID(),
    version_number: current.version_number + 1,
    is_current: true,
    deleted_at: changes.deleted_at ?? null,
    created_by: getCurrentUserEmail(),
  })
}

/** Weidegang beendet: neue Version mit valid_to=heute + deleted_at gesetzt, verschwindet aus der aktuellen Ansicht. */
export async function deletePaddock(paddockId: string): Promise<void> {
  const today = todayIso()
  await saveNewVersion(paddockId, { valid_to: today, deleted_at: new Date().toISOString() })
}

export async function loadVersionHistory(paddockId: string): Promise<Paddock[]> {
  const pg = await getDb()
  const { rows } = await pg.query<Paddock>(
    `select * from paddocks where paddock_id = $1 order by version_number desc`,
    [paddockId],
  )
  return rows
}

/** Aktuelle Weidegänge (Ist-Zustand) einer Saison. */
export async function loadCurrentPaddocks(seasonYear: number) {
  const pg = await getDb()
  const { rows } = await pg.query<Paddock>(
    `select * from paddocks where season_year = $1 and is_current and deleted_at is null`,
    [seasonYear],
  )
  return rows
}

/**
 * Weidegänge, die zu einem bestimmten Datum aktiv waren — is_current allein
 * markiert nur die jeweils JÜNGSTE Version je Zaun-Faden, nicht "war an
 * diesem Tag aktiv"; für einen Blick in die Vergangenheit muss deshalb der
 * Gültigkeitszeitraum jeder Version selbst geprüft werden.
 */
export async function loadPaddocksAsOf(seasonYear: number, date: string) {
  const pg = await getDb()
  const { rows } = await pg.query<Paddock>(
    `select * from paddocks
     where season_year = $1 and deleted_at is null
       and valid_from <= $2 and (valid_to is null or valid_to >= $2)`,
    [seasonYear, date],
  )
  return rows
}
