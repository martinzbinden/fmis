import { useEffect, useState } from 'react'
import { getDb } from '../db/pglite'
import { loadParcelNutrientTotals } from '../lib/fertilization'
import { INTENSITAET_LABEL, fmtArea, fmtDate, usageDescription } from '../lib/format'
import type { FertilizationEntry, Parcel, UsageEntry } from '../types'
import Modal from './Modal'

type NutrientTotals = { n_kg: number; n_avail_kg: number; p2o5_kg: number; k2o_kg: number; applications: number }

interface AmountAgg {
  code: string
  unit: string
  soll: number
  ist: number
}

function flattenByDate<T>(byDate: Record<string, T[] | undefined>): { date: string; entry: T }[] {
  return Object.entries(byDate)
    .flatMap(([date, entries]) => (entries ?? []).map((entry) => ({ date, entry })))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function fertAmountText(e: FertilizationEntry): string {
  return `${e.duengung_code}${e.amount != null ? ` ${e.amount} ${e.unit === 'm3' ? 'm³' : e.unit}` : ''}`
}

/** Alle Nutzungen/Düngungen einer Parzelle über die Saison — das
 * "Parzellenblatt", von einem Klick auf die erste Spalte im Raster
 * geöffnet. Zeigt zusätzlich die Düngungsplanung Soll/Ist: geplante
 * (noch nicht ausgebrachte) gegen definitive Ausbringmengen, je
 * Düngerart/Einheit und als Nährstoff-Summe. */
export default function ParcelSheetModal({
  parcel,
  seasonYear,
  usageByDate,
  fertByDate,
  onOpenDay,
  onOpenGaben,
  onClose,
}: {
  parcel: Parcel
  seasonYear: number
  usageByDate: Record<string, UsageEntry[] | undefined> | undefined
  fertByDate: Record<string, FertilizationEntry[] | undefined> | undefined
  onOpenDay: (date: string) => void
  onOpenGaben: () => void
  onClose: () => void
}) {
  const [usageOpen, setUsageOpen] = useState(true)
  const [fertOpen, setFertOpen] = useState(true)
  const [totals, setTotals] = useState<{ ist: NutrientTotals; soll: NutrientTotals } | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      const pg = await getDb()
      const [ist, soll] = await Promise.all([
        loadParcelNutrientTotals(pg, parcel.id, seasonYear, false),
        loadParcelNutrientTotals(pg, parcel.id, seasonYear, true),
      ])
      if (active) setTotals({ ist, soll })
    }
    void load()
    return () => {
      active = false
    }
  }, [parcel.id, seasonYear])

  const usageRows = flattenByDate(usageByDate ?? {})
  const fertRows = flattenByDate(fertByDate ?? {})

  // Düngungsplanung: geplante gegen definitive Ausbringmenge je Düngerart +
  // Einheit — dieselbe Düngerart kann mit unterschiedlicher Einheit
  // auftreten (z.B. m3 geplant, dann doch als Fuder/t ausgebracht), darum
  // beides im Schlüssel.
  const amountByKey = new Map<string, AmountAgg>()
  for (const { entry } of fertRows) {
    const key = `${entry.duengung_code}__${entry.unit}`
    const agg = amountByKey.get(key) ?? { code: entry.duengung_code, unit: entry.unit, soll: 0, ist: 0 }
    if (entry.is_planned) agg.soll += entry.amount ?? 0
    else agg.ist += entry.amount ?? 0
    amountByKey.set(key, agg)
  }
  const amountRows = [...amountByKey.values()].sort((a, b) => a.code.localeCompare(b.code))

  function openDay(date: string) {
    onClose()
    onOpenDay(date)
  }

  return (
    <Modal title={`${parcel.name} · ${seasonYear}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <div>Fläche <b>{fmtArea(parcel.area_a)}</b></div>
            {parcel.kultur_name_de && (
              <div>
                Kultur <b>{parcel.kultur_name_de}{parcel.kultur_code ? ` (${parcel.kultur_code})` : ''}</b>
              </div>
            )}
            {parcel.intensitaet && <div>Intensität <b>{INTENSITAET_LABEL[parcel.intensitaet] ?? parcel.intensitaet}</b></div>}
            {parcel.farm_name && <div>Betrieb <b>{parcel.farm_name}</b></div>}
          </div>
          {parcel.notes && <div className="mt-1 italic text-gray-500">{parcel.notes}</div>}
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Düngungsplanung — Soll/Ist</div>
          {amountRows.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">Keine Düngung erfasst.</p>
          ) : (
            <table className="mt-1 w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-1 pr-2">Düngerart</th>
                  <th className="pb-1 pr-2">Soll</th>
                  <th className="pb-1 pr-2">Ist</th>
                  <th className="pb-1">Differenz</th>
                </tr>
              </thead>
              <tbody>
                {amountRows.map((r) => {
                  const diff = Math.round((r.ist - r.soll) * 100) / 100
                  return (
                    <tr key={`${r.code}-${r.unit}`} className="border-t">
                      <td className="py-1 pr-2 font-medium text-gray-700">{r.code}</td>
                      <td className="py-1 pr-2">{r.soll} {r.unit === 'm3' ? 'm³' : r.unit}</td>
                      <td className="py-1 pr-2">{r.ist} {r.unit === 'm3' ? 'm³' : r.unit}</td>
                      <td className={`py-1 ${diff < 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                        {diff > 0 ? '+' : ''}
                        {diff} {r.unit === 'm3' ? 'm³' : r.unit}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {totals && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-amber-50 p-2 text-amber-900">
                <div className="font-semibold">Geplant (Soll)</div>
                <div>N {totals.soll.n_kg.toFixed(1)} kg · P₂O₅ {totals.soll.p2o5_kg.toFixed(1)} · K₂O {totals.soll.k2o_kg.toFixed(1)}</div>
              </div>
              <div className="rounded bg-brand-50 p-2 text-brand-900">
                <div className="font-semibold">Definitiv (Ist)</div>
                <div>N {totals.ist.n_kg.toFixed(1)} kg · P₂O₅ {totals.ist.p2o5_kg.toFixed(1)} · K₂O {totals.ist.k2o_kg.toFixed(1)}</div>
              </div>
            </div>
          )}
          <button type="button" onClick={onOpenGaben} className="mt-2 text-xs font-medium text-brand-700">
            Gaben (N-Planung) bearbeiten →
          </button>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setUsageOpen((v) => !v)}
            className="flex w-full items-center justify-between border-t pt-2 text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            <span>Nutzungen ({usageRows.length})</span>
            <span>{usageOpen ? '▲' : '▼'}</span>
          </button>
          {usageOpen && (
            <ul className="mt-1 divide-y text-xs">
              {usageRows.length === 0 && <li className="py-1.5 text-gray-400">Keine Nutzung erfasst.</li>}
              {usageRows.map(({ date, entry }) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => openDay(date)} className="flex w-full items-center justify-between gap-2 py-1.5 text-left active:bg-gray-50">
                    <span className="text-gray-500">{fmtDate(date)}</span>
                    <span className="flex-1 truncate text-gray-700">{usageDescription(entry)}</span>
                    {entry.is_planned && <span className="shrink-0 rounded border border-dashed border-gray-400 px-1 text-[10px] text-gray-500">geplant</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setFertOpen((v) => !v)}
            className="flex w-full items-center justify-between border-t pt-2 text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            <span>Düngungen ({fertRows.length})</span>
            <span>{fertOpen ? '▲' : '▼'}</span>
          </button>
          {fertOpen && (
            <ul className="mt-1 divide-y text-xs">
              {fertRows.length === 0 && <li className="py-1.5 text-gray-400">Keine Düngung erfasst.</li>}
              {fertRows.map(({ date, entry }) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => openDay(date)} className="flex w-full items-center justify-between gap-2 py-1.5 text-left active:bg-gray-50">
                    <span className="text-gray-500">{fmtDate(date)}</span>
                    <span className="flex-1 truncate text-gray-700">{fertAmountText(entry)}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                    {entry.is_planned && <span className="shrink-0 rounded border border-dashed border-gray-400 px-1 text-[10px] text-gray-500">geplant</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
            Schliessen
          </button>
        </div>
      </div>
    </Modal>
  )
}
