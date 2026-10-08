// Arbeitsplan "umgekehrt": im Arbeitsplan planen → Entwürfe im Wiesenjournal
// (is_planned), nach der Arbeit bestätigen (lib/workPlan.ts completePlan).

import type { PGlite } from '@electric-sql/pglite'
import { softDeleteRow, upsertRow } from '../db/write'
import { deleteFertilizationEntry, saveFertilizationEntry } from './fertilization'
import type { PlanTask } from './workPlan'
import type { DuengungCode, FertilizerType, Parcel } from '../types'

export type PlanWork = { kind: 'fert'; type: FertilizerType } | { kind: 'usage'; usageType: string; label: string | null }

/** Menge je Parzelle aus Menge je ha und Fläche (Aren), auf 0.1 gerundet. */
export const amountFor = (ratePerHa: number, areaA: number | null) => (areaA ? Math.round(((ratePerHa * areaA) / 100) * 10) / 10 : null)

export interface PlanInput {
  date: string
  seasonYear: number
  work: PlanWork
  parcels: Parcel[]
  /** Menge je Parzelle (Düngung), sonst null */
  amounts: Map<string, number | null>
  /** Verdünnung "1:1" (Gülle) */
  dilution: string | null
  notes: string | null
}

/** Je Parzelle einen geplanten Eintrag (Entwurf) im Wiesenjournal. */
export async function createPlanEntries(pg: PGlite, input: PlanInput): Promise<number> {
  let n = 0
  for (const parcel of input.parcels) {
    if (input.work.kind === 'fert') {
      const t = input.work.type
      await saveFertilizationEntry(pg, {
        id: null,
        anchorParcel: parcel,
        entry_date: input.date,
        season_year: input.seasonYear,
        type: t,
        duengung_code: (t.legacy_code ?? 'V') as DuengungCode,
        amount: input.amounts.get(parcel.id) ?? null,
        unit: t.unit,
        container_count: null,
        dilution: t.unit === 'm3' ? input.dilution : null,
        gabe_number: null,
        notes: input.notes,
        extent_type: 'parcel',
        extra_parcels: [],
        geometry: null,
        track_id: null,
        track_width_m: null,
        import_key: null,
        is_planned: true,
      })
    } else {
      await upsertRow('usage_entries', {
        id: crypto.randomUUID(),
        parcel_id: parcel.id,
        entry_date: input.date,
        usage_type: input.work.usageType,
        animal_category: null,
        day_only: false,
        animal_count: null,
        animal_group: null,
        label: input.work.label,
        value_num: null,
        yield_amount: null,
        yield_unit: null,
        paddock_version_id: null,
        notes: input.notes,
        import_key: null,
        is_planned: true,
      } as never)
    }
    n++
  }
  return n
}

/** Geplante (noch nicht ausgeführte) Einträge einer Aufgabe löschen —
 * ausgeführte bleiben unangetastet. */
export async function deletePlanTask(pg: PGlite, task: PlanTask, parcelIds?: Set<string>): Promise<number> {
  let n = 0
  for (const it of task.items) {
    if (parcelIds && !parcelIds.has(it.parcel_id)) continue
    for (const id of it.fertilization_ids) {
      const { rows } = await pg.query<{ is_planned: boolean }>('select is_planned from fertilization_entries where id = $1 and deleted_at is null', [id])
      if (rows[0]?.is_planned) {
        await deleteFertilizationEntry(pg, id)
        n++
      }
    }
    for (const id of it.usage_ids) {
      const { rows } = await pg.query<{ is_planned: boolean }>('select is_planned from usage_entries where id = $1 and deleted_at is null', [id])
      if (rows[0]?.is_planned) {
        await softDeleteRow('usage_entries', id)
        n++
      }
    }
  }
  return n
}
