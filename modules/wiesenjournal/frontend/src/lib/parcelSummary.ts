import type { DayIndex } from '../components/JournalGrid'
import type { FertilizationEntry, Parcel, UsageEntry } from '../types'
import { num } from './format'

export interface ParcelSummary {
  weideTage: number
  ertrag: string | null
  nKg: number
  gaben: number
}

function flatten<T>(idx: DayIndex<T> | undefined, parcelId: string): T[] {
  const byDate = idx?.[parcelId]
  if (!byDate) return []
  return Object.values(byDate).flat()
}

/** Zusammenfassung je Parzelle (Weidetage, Ertrag total, Stickstoff total) —
 * für die anhängbaren Summen-Spalten im Raster (siehe JournalGrid(Classic).tsx). */
export function summarizeParcels(
  parcels: Parcel[],
  usageByDay: DayIndex<UsageEntry>,
  fertByDay: DayIndex<FertilizationEntry>,
): Record<string, ParcelSummary> {
  const out: Record<string, ParcelSummary> = {}
  for (const p of parcels) {
    const usage = flatten(usageByDay, p.id)
    const fert = flatten(fertByDay, p.id)
    const weideTage = usage.filter((e) => e.usage_type === 'weide').length
    const yieldByUnit = new Map<string, number>()
    for (const e of usage) {
      if (e.yield_amount == null) continue
      const unit = e.yield_unit ?? ''
      yieldByUnit.set(unit, (yieldByUnit.get(unit) ?? 0) + (num(e.yield_amount) ?? 0))
    }
    const ertrag = yieldByUnit.size
      ? [...yieldByUnit.entries()].map(([unit, sum]) => `${Math.round(sum * 10) / 10}${unit ? ` ${unit}` : ''}`).join(', ')
      : null
    const nKg = fert.reduce((s, f) => s + (num(f.n_kg) ?? 0), 0)
    out[p.id] = { weideTage, ertrag, nKg: Math.round(nKg * 10) / 10, gaben: fert.length }
  }
  return out
}
