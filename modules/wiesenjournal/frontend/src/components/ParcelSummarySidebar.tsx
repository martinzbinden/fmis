import { useMemo } from 'react'
import type { DayIndex } from './JournalGrid'
import type { FertilizationEntry, Parcel, UsageEntry } from '../types'
import { num } from '../lib/format'

function flatten<T>(idx: DayIndex<T> | undefined, parcelId: string): T[] {
  const byDate = idx?.[parcelId]
  if (!byDate) return []
  return Object.values(byDate).flat()
}

interface ParcelSummary {
  parcelId: string
  weideTage: number
  ertrag: string | null
  nKg: number
  gaben: number
}

function summarize(parcels: Parcel[], usageByDay: DayIndex<UsageEntry>, fertByDay: DayIndex<FertilizationEntry>): ParcelSummary[] {
  return parcels.map((p) => {
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
    return { parcelId: p.id, weideTage, ertrag, nKg: Math.round(nKg * 10) / 10, gaben: fert.length }
  })
}

export default function ParcelSummarySidebar({
  open,
  onToggle,
  parcels,
  usageByDay,
  fertByDay,
}: {
  open: boolean
  onToggle: () => void
  parcels: Parcel[]
  usageByDay: DayIndex<UsageEntry>
  fertByDay: DayIndex<FertilizationEntry>
}) {
  const summaries = useMemo(() => summarize(parcels, usageByDay, fertByDay), [parcels, usageByDay, fertByDay])
  const byId = new Map(summaries.map((s) => [s.parcelId, s]))

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title="Zusammenfassung anzeigen"
        aria-label="Zusammenfassung anzeigen"
        className="fixed right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-lg border border-r-0 border-gray-300 bg-white px-1.5 py-3 text-xs text-gray-500 shadow"
      >
        ◀ Σ
      </button>
    )
  }

  return (
    <div className="w-72 shrink-0 rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b p-2">
        <h2 className="text-sm font-bold text-gray-700">Zusammenfassung</h2>
        <button type="button" onClick={onToggle} title="Schliessen" aria-label="Schliessen" className="text-gray-400">
          ▶
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 text-[10px] text-gray-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Parzelle</th>
              <th className="px-2 py-1 text-right font-medium" title="Weidetage">
                Weide
              </th>
              <th className="px-2 py-1 text-right font-medium" title="Ertrag total">
                Ertrag
              </th>
              <th className="px-2 py-1 text-right font-medium" title="Düngung: Stickstoff total / Anzahl Gaben">
                N kg
              </th>
            </tr>
          </thead>
          <tbody>
            {parcels.map((p) => {
              const s = byId.get(p.id)
              if (!s || (s.weideTage === 0 && !s.ertrag && s.nKg === 0)) return null
              return (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="max-w-[120px] truncate px-2 py-1" title={p.name}>
                    {p.name}
                  </td>
                  <td className="px-2 py-1 text-right">{s.weideTage || ''}</td>
                  <td className="px-2 py-1 text-right">{s.ertrag ?? ''}</td>
                  <td className="px-2 py-1 text-right" title={s.gaben ? `${s.gaben} Gaben` : ''}>
                    {s.nKg || ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
