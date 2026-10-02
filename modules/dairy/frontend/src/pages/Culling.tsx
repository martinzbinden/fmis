import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '../hooks/useQuery'
import { loadHerdContext, latestValues } from '../lib/herdContext'
import { cullingReasons, fmtCells, reasonScore, type CullingReason, type CullingThresholds } from '../lib/culling'
import { useCullingThresholds } from '../lib/cullingSettings'
import { todayIso } from '../lib/format'
import { speciesOf, speciesTerms } from '../lib/species'
import { ReasonChips } from './AnimalDetail'
import { animalLabel } from '@fmis/core/earTag'

const THRESHOLD_FIELDS: { key: keyof CullingThresholds; label: string; step?: number }[] = [
  { key: 'intervalDays', label: 'Zwischengeburtszeit über (Tage)' },
  { key: 'services', label: 'Belegungen bis Trächtigkeit ab' },
  { key: 'daysWithoutService', label: 'Tage ohne Belegung über (0 = aus)' },
  { key: 'sccGeo12m', label: "Zellzahl Ø 12 Mt. über ('000)" },
  { key: 'sccHighTest', label: "Hohe Einzelprobe über ('000)" },
  { key: 'sccHighCount', label: 'Anzahl hohe Proben je Laktation' },
  { key: 'performanceRel', label: 'Leistung ggü. Gleichaltrigen unter', step: 0.01 },
  { key: 'totalBreedingValue', label: 'Gesamtzuchtwert unter' },
  { key: 'udderBreedingValue', label: 'ZW Zellzahl/Mastitis unter (0 = aus)' },
  { key: 'lactationNumber', label: 'Hinweis ab Laktation' },
  { key: 'offspringLossShare', label: 'Anteil tote Nachkommen ab (0 = aus)', step: 0.05 },
  { key: 'healthEvents12m', label: 'Krankheits-/Behandlungstage in 12 Mt. ab (0 = aus)' },
]

interface Row {
  id: string
  label: string
  laufNr: string | null
  earTag: string
  lactation: number | null
  reasons: CullingReason[]
  score: number
  sccGeo12m: number | null
  performanceRel: number | null
  totalBv: number | null
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function Culling({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const terms = speciesTerms(moduleKey)
  const { thresholds, update, reset } = useCullingThresholds(moduleKey, species)
  const [showAll, setShowAll] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const { data, loading } = useQuery((pg) => loadHerdContext(pg, species, todayIso()), [species])

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    return [...data.values()]
      .filter((c) => c.animal.status === 'aktiv' && c.animal.sex !== 'm' && (c.lactationNumber ?? 0) > 0)
      .map((c) => {
        const bv = latestValues(c.breedingValues)
        const reasons = cullingReasons(
          {
            species,
            fertility: c.fertility,
            performance: c.performance,
            currentLactationScc: c.currentLactationScc,
            breedingValues: bv,
            lactationNumber: c.lactationNumber,
            recentOffspring: c.births.slice(-2).flatMap((b) => b.offspring),
            healthEvents12m: c.healthEvents12m,
          },
          thresholds,
        )
        return {
          id: c.animal.id,
          label: animalLabel(c.animal),
          laufNr: c.animal.lauf_nr,
          earTag: c.animal.ear_tag,
          lactation: c.lactationNumber,
          reasons,
          score: reasonScore(reasons),
          sccGeo12m: c.performance?.scc_geo_12m ?? null,
          performanceRel: c.performance?.performance_rel ?? null,
          totalBv: species === 'sheep' ? (bv.gzw ?? null) : (bv.iset ?? null),
        }
      })
      .sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length || a.label.localeCompare(b.label))
  }, [data, thresholds, species])

  const flagged = rows.filter((r) => r.reasons.some((x) => x.weight > 0))
  const visible = showAll ? rows : flagged

  function exportCsv() {
    const header = ['Nr', 'Name/Ohrmarke', 'Ohrmarke', 'Laktation', 'Punkte', 'Zellzahl 12Mt', 'Leistung rel', 'Gesamtzuchtwert', 'Gründe']
    const lines = visible.map((r) =>
      [r.laufNr, r.label, r.earTag, r.lactation, r.score, r.sccGeo12m, r.performanceRel, r.totalBv, r.reasons.map((x) => x.text).join(' | ')]
        .map(csvEscape)
        .join(';'),
    )
    const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ausmerzliste-${moduleKey}-${todayIso()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Ausmerzliste</h1>
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            ⚙️ Schwellen
          </button>
          <button type="button" onClick={exportCsv} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            CSV
          </button>
          <button type="button" onClick={() => window.print()} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            Drucken
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {terms.plural} mit Hinweisen auf Fruchtbarkeit, Eutergesundheit, Leistung oder Zuchtwert — nach Gewicht der
        Gründe sortiert. Leistung im Vergleich mit Gleichaltrigen (gleiche Laktationszahl), Zellzahl als geometrisches
        Mittel. Die Liste entscheidet nichts; sie zeigt, wo sich ein genauer Blick lohnt.
      </p>

      {showSettings && (
        <div className="rounded-lg bg-white p-4 shadow-sm print:hidden">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {THRESHOLD_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                {f.label}
                <input
                  type="number"
                  step={f.step ?? 1}
                  value={thresholds[f.key]}
                  onChange={(e) => update({ ...thresholds, [f.key]: Number(e.target.value) })}
                  className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                />
              </label>
            ))}
          </div>
          <button type="button" onClick={reset} className="mt-3 text-xs text-brand-700">
            Vorgaben wiederherstellen
          </button>
        </div>
      )}

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}

      {data && (
        <label className="flex items-center gap-2 text-xs text-gray-600 print:hidden">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Auch {terms.plural} ohne Hinweis zeigen ({flagged.length} von {rows.length} mit Hinweis)
        </label>
      )}

      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <Link to={`../kuehe/${r.id}`} relative="path" className="font-semibold text-gray-800">
                {r.laufNr && <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-sm font-bold">{r.laufNr}</span>}
                {r.label}
              </Link>
              {r.score > 0 && (
                <span className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">{r.score}</span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {r.lactation ? `${r.lactation}. Laktation` : ''}
              {r.sccGeo12m != null ? ` · Zellzahl Ø ${fmtCells(r.sccGeo12m)}` : ''}
              {r.performanceRel != null ? ` · Leistung ${Math.round(r.performanceRel * 100)} %` : ''}
              {r.totalBv != null ? ` · ${species === 'sheep' ? 'GZW' : 'ISET'} ${r.totalBv}` : ''}
            </div>
            {r.reasons.length > 0 && (
              <div className="mt-2">
                <ReasonChips reasons={r.reasons} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {data && visible.length === 0 && <p className="text-center text-sm text-gray-500">Keine {terms.plural} mit Hinweis.</p>}
    </div>
  )
}
