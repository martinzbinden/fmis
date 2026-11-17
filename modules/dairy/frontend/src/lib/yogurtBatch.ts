// Joghurt-Milch als Vorgang (schema/0035): vorschlagen → am Melkstand mit langem Druck «gemolken» markieren →
// «Vorgang beenden» speichert, welche Kühe tatsächlich in die Joghurt-Milch kamen. Der laufende Vorgang liegt bis
// zum Beenden nur auf dem Gerät (localStorage), damit Neuladen oder ein Anruf am Melkstand nichts verliert.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow } from '../db/write'
import { isoDate, num } from './format'
import { yogurtMix, type YogurtCow, type YogurtMix, type YogurtOptions } from './yogurtPlan'

export interface YogurtRun {
  /** Tag, an dem der Vorgang begonnen wurde */
  date: string
  picked: string[]
  suggested: string[]
  milked: string[]
}

const RUN_KEY = 'dairy_yogurt_run_v1'

export function loadRun(): YogurtRun | null {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as YogurtRun | null
    return r && Array.isArray(r.picked) ? { ...r, milked: r.milked ?? [], suggested: r.suggested ?? [] } : null
  } catch {
    return null
  }
}

export function saveRun(run: YogurtRun | null): void {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run))
    else localStorage.removeItem(RUN_KEY)
  } catch {
    // nur im Speicher
  }
}

/** Langer Druck auf eine Kuh: gemolken an/aus. Wer gemolken ist, gehört auch zur Auswahl (dazugemolkene Kuh). */
export function toggleMilked(run: Pick<YogurtRun, 'picked' | 'milked'>, id: string): { picked: string[]; milked: string[] } {
  if (run.milked.includes(id)) return { picked: run.picked, milked: run.milked.filter((m) => m !== id) }
  return { picked: run.picked.includes(id) ? run.picked : [...run.picked, id], milked: [...run.milked, id] }
}

export interface BatchPreview {
  cows: YogurtCow[]
  mix: YogurtMix
  /** gemolken, aber nicht vorgeschlagen */
  extra: YogurtCow[]
  /** ausgewählt, aber nicht als gemolken markiert (kommen nicht in den Vorgang) */
  notMilked: YogurtCow[]
  /** ohne eine einzige Markierung: alle ausgewählten gelten als gemolken */
  assumedAll: boolean
}

/** Was «Vorgang beenden» speichert: die gemolkenen Kühe; ist keine markiert, die ganze Auswahl. */
export function batchPreview(cows: YogurtCow[], run: Pick<YogurtRun, 'picked' | 'suggested' | 'milked'>, factor: number): BatchPreview {
  const byId = new Map(cows.map((c) => [c.animal_id, c]))
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((c): c is YogurtCow => !!c)
  const assumedAll = run.milked.length === 0
  const inBatch = pick(assumedAll ? run.picked : run.milked)
  const suggested = new Set(run.suggested)
  const milked = new Set(run.milked)
  return {
    cows: inBatch,
    mix: yogurtMix(inBatch, factor),
    extra: inBatch.filter((c) => !suggested.has(c.animal_id)),
    notMilked: assumedAll ? [] : pick(run.picked).filter((c) => !milked.has(c.animal_id)),
    assumedAll,
  }
}

export interface YogurtBatchCow {
  animal_id: string
  label: string
  kg: number
  fat_pct: number | null
  protein_pct: number | null
  cell_count: number | null
  suggested: boolean
}

export interface YogurtBatch {
  id: string
  batch_date: string
  milk_kg: number | null
  fat_pct: number | null
  protein_pct: number | null
  cell_count: number | null
  cows: YogurtBatchCow[]
  created_by: string | null
}

const round = (v: number | null, d: number) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

export async function saveYogurtBatch(pg: PGlite, preview: BatchPreview, run: YogurtRun, opts: YogurtOptions, date: string): Promise<void> {
  const suggested = new Set(run.suggested)
  const cows: YogurtBatchCow[] = preview.cows.map((c) => ({
    animal_id: c.animal_id,
    label: c.label,
    kg: round(c.milk_kg * opts.factor, 1)!,
    fat_pct: c.fat_pct,
    protein_pct: c.protein_pct,
    cell_count: c.cell_count,
    suggested: suggested.has(c.animal_id),
  }))
  await upsertRow(pg, 'yogurt_batches', {
    id: crypto.randomUUID(),
    batch_date: date,
    target_kg: opts.targetKg,
    factor: opts.factor,
    criterion: opts.criterion,
    milk_kg: round(preview.mix.milkKg, 1),
    fat_pct: round(preview.mix.fatPct, 2),
    protein_pct: round(preview.mix.proteinPct, 2),
    cell_count: preview.mix.cellCount == null ? null : Math.round(preview.mix.cellCount),
    cows: JSON.stringify(cows),
    created_by: getCurrentUserEmail(),
  })
}

export async function loadYogurtBatches(pg: PGlite, limit = 10): Promise<YogurtBatch[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    'select id, batch_date, milk_kg, fat_pct, protein_pct, cell_count, cows, created_by from yogurt_batches where deleted_at is null order by batch_date desc, updated_at desc limit $1',
    [limit],
  )
  return rows.map((r) => {
    let cows: YogurtBatchCow[] = []
    try {
      cows = JSON.parse(String(r.cows ?? '[]')) as YogurtBatchCow[]
    } catch {
      // kaputter Eintrag: ohne Kuhliste anzeigen
    }
    return {
      id: String(r.id),
      batch_date: isoDate(r.batch_date)!,
      milk_kg: num(r.milk_kg),
      fat_pct: num(r.fat_pct),
      protein_pct: num(r.protein_pct),
      cell_count: num(r.cell_count),
      cows,
      created_by: r.created_by ? String(r.created_by) : null,
    }
  })
}
