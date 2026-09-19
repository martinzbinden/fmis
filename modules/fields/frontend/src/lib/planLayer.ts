import { getDb } from '../db/pglite'
import { upsertRow } from '../db/write'
import { getCurrentUserEmail } from '../db/auth'
import type { FieldDeclaration, PlanParcel } from '../types'

type PlanParcelInput = Pick<
  PlanParcel,
  | 'farm_id'
  | 'jahr'
  | 'kultur_code'
  | 'kultur_name_de'
  | 'kultur_name_fr'
  | 'sorte'
  | 'flurname'
  | 'area_a'
  | 'geometry'
  | 'notes'
>

/** Legt eine neue Planungsparzelle (Version 1) an, kopiert von einer Import-Deklaration. */
export async function copyToPlan(decl: FieldDeclaration): Promise<string> {
  const planId = crypto.randomUUID()
  await upsertRow('plan_parcels', {
    id: crypto.randomUUID(),
    plan_id: planId,
    version_number: 1,
    is_current: true,
    farm_id: decl.farm_id,
    source_declaration_id: decl.id,
    jahr: decl.jahr,
    kultur_code: decl.kultur_code,
    kultur_name_de: decl.kultur_name_de,
    kultur_name_fr: decl.kultur_name_fr,
    sorte: decl.sorte,
    flurname: decl.flurname,
    area_a: decl.area_a,
    geometry: decl.geometry,
    notes: null,
    created_by: getCurrentUserEmail(),
  })
  return planId
}

/** Legt eine ganz neue Planungsparzelle an — von Grund auf gezeichnet, kein Import-Ursprung. */
export async function createPlanParcel(input: PlanParcelInput): Promise<string> {
  const planId = crypto.randomUUID()
  await upsertRow('plan_parcels', {
    id: crypto.randomUUID(),
    plan_id: planId,
    version_number: 1,
    is_current: true,
    source_declaration_id: null,
    created_by: getCurrentUserEmail(),
    ...input,
  })
  return planId
}

async function loadCurrentVersion(planId: string): Promise<PlanParcel> {
  const pg = await getDb()
  const { rows } = await pg.query<PlanParcel>(
    `select * from plan_parcels where plan_id = $1 and is_current = true limit 1`,
    [planId],
  )
  if (rows.length === 0) throw new Error(`Keine aktuelle Version für Planungsparzelle ${planId} gefunden`)
  return rows[0]
}

/**
 * Speichert eine neue Version einer Planungsparzelle: die bisherige
 * "aktuelle" Zeile wird über upsertRow() (für korrekten Sync/History) auf
 * is_current=false gesetzt, danach eine neue Zeile mit den gemergten
 * Feldern eingefügt. Deckt Geometrie-Edits, Kultur-Zuweisung, Löschen
 * (changes.deleted_at) und Zurückspulen (revertToVersion ruft dies mit
 * dem alten Inhalt auf) einheitlich ab — es wird nie etwas überschrieben,
 * jede Änderung ist eine weitere Zeile in derselben plan_id-Historie.
 */
export async function saveNewVersion(
  planId: string,
  changes: Partial<PlanParcelInput> & { deleted_at?: string | null },
): Promise<void> {
  const current = await loadCurrentVersion(planId)
  await upsertRow('plan_parcels', { ...current, is_current: false })
  await upsertRow('plan_parcels', {
    ...current,
    ...changes,
    id: crypto.randomUUID(),
    version_number: current.version_number + 1,
    is_current: true,
    deleted_at: changes.deleted_at ?? null,
    created_by: getCurrentUserEmail(),
  })
}

/** Zurückspulen: übernimmt den Inhalt einer alten Version als neue Version. */
export async function revertToVersion(planId: string, versionNumber: number): Promise<void> {
  const pg = await getDb()
  const { rows } = await pg.query<PlanParcel>(
    `select * from plan_parcels where plan_id = $1 and version_number = $2 limit 1`,
    [planId, versionNumber],
  )
  if (rows.length === 0) throw new Error(`Version ${versionNumber} nicht gefunden`)
  const old = rows[0]
  await saveNewVersion(planId, {
    farm_id: old.farm_id,
    jahr: old.jahr,
    kultur_code: old.kultur_code,
    kultur_name_de: old.kultur_name_de,
    kultur_name_fr: old.kultur_name_fr,
    sorte: old.sorte,
    flurname: old.flurname,
    area_a: old.area_a,
    geometry: old.geometry,
    notes: old.notes,
    deleted_at: null,
  })
}

export async function deletePlanParcel(planId: string): Promise<void> {
  await saveNewVersion(planId, { deleted_at: new Date().toISOString() })
}

export async function loadVersionHistory(planId: string): Promise<PlanParcel[]> {
  const pg = await getDb()
  const { rows } = await pg.query<PlanParcel>(
    `select * from plan_parcels where plan_id = $1 order by version_number desc`,
    [planId],
  )
  return rows
}
