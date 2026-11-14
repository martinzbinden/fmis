import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDb } from '@fmis/core/DbContext'
import { errorText, notifyError } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import HoldButton from '../components/HoldButton'
import { buildPlan, isValuable, valueScores, type Mark, type PlanEntry, type PlanState } from '../lib/cullingPlan'
import { clearCullingMarks, loadCullingMarks, setCullingMark } from '../lib/cullingMarks'
import { useQuery } from '../hooks/useQuery'
import { useJumpTarget, useJumpTo } from '../hooks/useJumpTo'
import { cullingInput, litterSummary, loadHerdContext, latestValues, type LitterSummary } from '../lib/herdContext'
import TrendBadge from '../components/TrendBadge'
import type { LactationTrend } from '../lib/lactationTrend'
import { cullingReasons, DEFAULT_THRESHOLDS, fmtCells, reasonScore, type CullingReason, type CullingThresholds } from '../lib/culling'
import { useCullingThresholds } from '../lib/cullingSettings'
import { fmtDate, todayIso } from '../lib/format'
import { RESULT_LABEL, type PregnancyStatus } from '../lib/pregnancy'
import { speciesOf, speciesTerms } from '../lib/species'
import { ReasonChips } from './AnimalDetail'
import { animalLabel } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'

const THRESHOLD_FIELDS: { key: keyof CullingThresholds; label: string; step?: number }[] = [
  { key: 'intervalDays', label: 'Zwischengeburtszeit über (Tage)' },
  { key: 'services', label: 'Belegungen bis Trächtigkeit ab' },
  { key: 'daysWithoutService', label: 'Tage ohne Belegung über (0 = aus)' },
  { key: 'sccGeo12m', label: "Zellzahl Ø 12 Mt. über ('000)" },
  { key: 'sccHighTest', label: "Hohe Einzelprobe über ('000)" },
  { key: 'sccHighCount', label: 'Anzahl hohe Proben je Laktation' },
  { key: 'sccIgnoreDays', label: 'Proben in den ersten … Laktationstagen nicht zählen (0 = alle)' },
  { key: 'sccLateDay', label: 'Höhere Grenze ab Laktationstag (0 = aus)' },
  { key: 'sccLateFactor', label: 'Faktor auf die Grenze ab diesem Tag', step: 0.1 },
  { key: 'performanceRel', label: 'Leistung ggü. Gleichaltrigen unter', step: 0.01 },
  { key: 'totalBreedingValue', label: 'Gesamtzuchtwert unter' },
  { key: 'udderBreedingValue', label: 'ZW Zellzahl/Mastitis unter (0 = aus)' },
  { key: 'lactationNumber', label: 'Hinweis ab Laktation' },
  { key: 'offspringLossShare', label: 'Anteil tote Nachkommen ab (0 = aus)', step: 0.05 },
  { key: 'healthEvents12m', label: 'Krankheits-/Behandlungstage in 12 Mt. ab (0 = aus)' },
  { key: 'trendFalling', label: 'Leistung fällt seit … Laktationen in Folge (0 = aus)' },
  { key: 'runningBelowOwn', label: 'Laufende Laktation Punkte unter eigenem Mittel ab (0 = aus)' },
  { key: 'emptyAgeMonths', label: 'Leer, noch nie geboren, älter als … Monate (0 = aus)' },
  { key: 'emptyOldLactation', label: 'Leer und Leistung abnehmend ab Laktation (0 = aus)' },
  { key: 'emptyFirstPerfRel', label: 'Leer in 1. Laktation, Leistung unter (0 = aus)', step: 0.05 },
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
  trend: LactationTrend | undefined
  pregnancy: PregnancyStatus | null
  litter: LitterSummary
  /** Wert des Tiers (Mittel 100) für den Schutz wertvoller Tiere */
  value: number | null
}

/** «2·1·3 (Ø 2.0)» – die letzten vier Würfe, Mittel über alle. */
function fmtLitters(l: LitterSummary): string | null {
  if (l.sizes.length === 0) return null
  const last = l.sizes.slice(-4).join('·')
  return `Würfe ${l.sizes.length > 4 ? '…' : ''}${last}${l.sizes.length > 1 ? ` (Ø ${l.mean!.toFixed(1)})` : ''}`
}

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100)

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function Culling({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const terms = speciesTerms(moduleKey)
  const { thresholds, update } = useCullingThresholds(moduleKey, species)
  const jumpTo = useJumpTarget()
  // Sprung aus der Tier-Info: auch ein Tier ohne Hinweis muss sichtbar sein
  const [showAll, setShowAll] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [params, setParams] = useSearchParams()
  // Vorschlag für die nächste Schlachtung ist die Startansicht; der Sprung aus der Tier-Info zeigt die ganze Liste
  const view: 'vorschlag' | 'alle' = params.get('ansicht') === 'alle' || jumpTo ? 'alle' : 'vorschlag'
  const marks = useQuery(loadCullingMarks).data
  const [planN, setPlanN] = useStoredNumber(`${moduleKey}_culling_n`, 5)
  const [valueThreshold, setValueThreshold] = useStoredNumber(`${moduleKey}_culling_value`, 110)
  const { data, loading } = useQuery((pg) => loadHerdContext(pg, species, todayIso()), [species])

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    const contexts = [...data.values()].filter((c) => c.animal.status === 'aktiv' && c.animal.sex !== 'm' && ((c.lactationNumber ?? 0) > 0 || c.pregnancy != null))
    const totalBvOf = (c: (typeof contexts)[number]) => {
      const bv = latestValues(c.breedingValues)
      return species === 'sheep' ? (bv.gzw ?? null) : (bv.iset ?? null)
    }
    // Wert je Tier: Leistungs-/Zellzahlindex, Gesamtzuchtwert, (Schafe) Wurfgrösse — alle herdenweit auf Mittel 100
    const values = valueScores(
      contexts.map((c) => {
        const lit = litterSummary(c.births)
        return {
          id: c.animal.id,
          idxPerformance: c.performance?.idx_performance ?? null,
          idxScc: c.performance?.idx_scc ?? null,
          totalBv: totalBvOf(c),
          litterMean: species === 'sheep' && lit.sizes.length >= 2 ? lit.mean : null,
        }
      }),
    )
    return contexts
      .map((c) => {
        const reasons = cullingReasons(cullingInput(c, species), thresholds)
        return {
          id: c.animal.id,
          label: animalLabel(c.animal),
          laufNr: c.animal.lauf_nr,
          earTag: c.animal.ear_tag,
          lactation: c.lactationNumber,
          reasons,
          score: reasonScore(reasons),
          sccGeo12m: c.performance?.scc_geo_12m ?? null,
          performanceRel: c.performance?.performance_rel_stage ?? c.performance?.performance_rel ?? null,
          totalBv: totalBvOf(c),
          trend: c.trend,
          pregnancy: c.pregnancy,
          litter: litterSummary(c.births),
          value: values.get(c.animal.id) ?? null,
        }
      })
      .sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length || a.label.localeCompare(b.label))
  }, [data, thresholds, species])

  const flagged = rows.filter((r) => r.reasons.some((x) => x.weight > 0))
  const visible = showAll || (jumpTo && !flagged.some((r) => r.id === jumpTo)) ? rows : flagged
  useJumpTo(!!data, jumpTo ? `tier-${jumpTo}` : null)

  function exportCsv() {
    const header = ['Nr', 'Name/Ohrmarke', 'Ohrmarke', 'Laktation', 'Punkte', 'Zellzahl 12Mt', 'Leistung rel', 'Gesamtzuchtwert', 'Tendenz je Lakt.', 'Trächtigkeit', ...(species === 'sheep' ? ['Würfe', 'Wurfgrösse Ø', 'lebend geboren Ø'] : []), 'Gründe']
    const lines = visible.map((r) =>
      [
        r.laufNr,
        r.label,
        r.earTag,
        r.lactation,
        r.score,
        r.sccGeo12m,
        r.performanceRel,
        r.totalBv,
        r.trend?.slope != null ? Math.round(r.trend.slope * 100) : null,
        r.pregnancy ? `${RESULT_LABEL[r.pregnancy.result]} ${r.pregnancy.date}` : null,
        ...(species === 'sheep'
          ? [r.litter.sizes.join('-') || null, round2(r.litter.mean), round2(r.litter.aliveMean)]
          : []),
        r.reasons.map((x) => x.text).join(' | '),
      ]
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
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link to="../gruppen" relative="path" className="link-btn rounded border border-brand-700 px-2 py-1 text-xs font-medium text-brand-700">
            📊 Gruppen vergleichen
          </Link>
          {species === 'sheep' && (
            <Link to="laemmer" className="link-btn rounded border border-brand-700 px-2 py-1 text-xs font-medium text-brand-700">
              🐑 Lämmer zum Schlachttermin
            </Link>
          )}
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="link-btn rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            ⚙️ Schwellen
          </button>
          <button type="button" onClick={exportCsv} className="link-btn hidden rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 sm:inline-flex">
            CSV
          </button>
          <button type="button" onClick={() => window.print()} className="link-btn hidden rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 sm:inline-flex">
            Drucken
          </button>
        </div>
      </div>
      <details className="text-xs text-gray-600">
        <summary className="link-btn cursor-pointer font-medium text-gray-700">ⓘ Wie wird gerechnet?</summary>
        <p className="mt-1">
          {terms.plural} mit Hinweisen auf Fruchtbarkeit, Eutergesundheit, Leistung oder Zuchtwert — nach Gewicht der
          Gründe sortiert. Leistung im Vergleich mit Gleichaltrigen (gleiche Laktationszahl; bei laufender Laktation
          stadienunabhängig: abgeschlossene Laktationen geteilt durch die Lebenstage bis zur letzten {terms.calving}),
          Zellzahl als geometrisches Mittel; hohe Einzelproben zählen stadienabhängig (die ersten Tage nach der Geburt
          nicht, ab dem eingestellten Tag gilt eine höhere Grenze, ⚙️ Schwellen). Tendenz: Niveau je Laktation im Vergleich mit den Herdengenossinnen am gleichen Wägungstag (wie unter
          Leistung → Laktationsleistung), ↘ = fällt über die letzten Laktationen. Die Liste entscheidet nichts; sie zeigt,
          wo sich ein genauer Blick lohnt.
        </p>
      </details>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200 p-1 print:hidden" role="tablist">
        {(['vorschlag', 'alle'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setParams(v === 'alle' ? { ansicht: 'alle' } : {}, { replace: true })}
            className={`min-h-11 rounded-lg font-semibold ${view === v ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-700'}`}
          >
            {v === 'vorschlag' ? 'Vorschlag Schlachtung' : 'Alle mit Hinweis'}
          </button>
        ))}
      </div>

      {showSettings && (
        <SettingsEditor value={thresholds} onSave={update} onReset={() => DEFAULT_THRESHOLDS[species]} label="Schwellen" className="rounded-lg bg-white p-4 shadow-sm print:hidden" title="Schwellen für die Gründe der Ausmerzliste">
          {({ value, set, editing }) => (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {THRESHOLD_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                  {f.label}
                  {editing ? (
                    <NumberInput step={f.step ?? 1} value={value[f.key]} onChange={(e) => set({ ...value, [f.key]: Number(e.target.value) })} className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm" />
                  ) : (
                    <ReadValue>{value[f.key]}</ReadValue>
                  )}
                </label>
              ))}
            </div>
          )}
        </SettingsEditor>
      )}

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}

      {view === 'vorschlag' && data && marks && (
        <CullingPlanView rows={rows} marks={marks} n={planN} onN={setPlanN} valueThreshold={valueThreshold} onValueThreshold={setValueThreshold} species={species} />
      )}

      {view === 'alle' && data && (
        <label className="flex items-center gap-2 text-xs text-gray-600 print:hidden">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Auch {terms.plural} ohne Hinweis zeigen ({flagged.length} von {rows.length} mit Hinweis)
        </label>
      )}

      {view === 'alle' && (
      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id} id={`tier-${r.id}`} className={`scroll-mt-20 rounded-lg bg-white p-3 shadow-sm ${r.id === jumpTo ? 'ring-2 ring-brand-700' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <Link to={`../tiere/${r.id}`} relative="path" className="font-semibold text-gray-800">
                {r.laufNr && <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-sm font-bold">{r.laufNr}</span>}
                {r.label}
              </Link>
              {r.score > 0 && (
                <span className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">{r.score}</span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {r.lactation ? `${r.lactation}. Laktation` : 'noch nicht gemolken'}
              {r.pregnancy ? ` · ${RESULT_LABEL[r.pregnancy.result]}${r.pregnancy.weeks != null && r.pregnancy.result === 'ja' ? ` (${Math.round(r.pregnancy.weeks)} Wo.)` : ''} am ${fmtDate(r.pregnancy.date)}` : ''}
              {species === 'sheep' && fmtLitters(r.litter) ? ` · ${fmtLitters(r.litter)}` : ''}
              {r.sccGeo12m != null ? ` · Zellzahl Ø ${fmtCells(r.sccGeo12m)}` : ''}
              {r.performanceRel != null ? ` · Leistung ${Math.round(r.performanceRel * 100)} %` : ''}
              {r.totalBv != null ? ` · ${species === 'sheep' ? 'GZW' : 'ISET'} ${r.totalBv}` : ''}{' '}
              <TrendBadge trend={r.trend} />
            </div>
            {r.reasons.length > 0 && (
              <div className="mt-2">
                <ReasonChips reasons={r.reasons} />
              </div>
            )}
          </li>
        ))}
      </ul>
      )}
      {view === 'alle' && data && visible.length === 0 && <p className="text-center text-sm text-gray-500">Keine {terms.plural} mit Hinweis.</p>}
    </div>
  )
}

/** Zahl, die auf diesem Gerät gemerkt wird (localStorage). */
function useStoredNumber(key: string, fallback: number): [number, (n: number) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key))
      return localStorage.getItem(key) != null && Number.isFinite(v) ? v : fallback
    } catch {
      return fallback
    }
  })
  return [
    value,
    (n) => {
      setValue(n)
      try {
        localStorage.setItem(key, String(n))
      } catch {
        // nur bis zum Neuladen
      }
    },
  ]
}

const STATE_TEXT: Record<PlanState, { label: string; chip: string }> = {
  vorschlag: { label: 'Vorschlag', chip: 'bg-rose-600 text-white' },
  fix: { label: 'Fest zum Schlachten', chip: 'bg-red-800 text-white' },
  leben: { label: 'Bleibt', chip: 'bg-green-700 text-white' },
  chance: { label: 'Wertvoll: noch eine Chance', chip: 'bg-sky-700 text-white' },
}

function pregnancyChip(p: PregnancyStatus | null): { text: string; cls: string } {
  if (!p) return { text: 'Trächtigkeit: keine Untersuchung', cls: 'bg-gray-100 text-gray-700' }
  const days = Math.round((Date.parse(todayIso()) - Date.parse(p.date)) / 86_400_000)
  const when = `${fmtDate(p.date)}${days >= 0 ? `, vor ${days} T.` : ''}`
  if (p.result === 'nein') return { text: `leer (${when})`, cls: 'bg-red-100 font-semibold text-red-900' }
  if (p.result === 'ja') return { text: `trächtig (${when})`, cls: 'bg-green-100 text-green-900' }
  return { text: `unsicher (${when})`, cls: 'bg-amber-100 text-amber-900' }
}

/** Vorschlag für die nächste Schlachtung: N Tiere nach Dringlichkeit (Gründe, aktuelles Trächtigkeitsergebnis,
 * Wert). Daumen hoch = bleibt (ausgegraut, das nächste rückt nach), Daumen runter = fest auf der Liste. */
function CullingPlanView({
  rows,
  marks,
  n,
  onN,
  valueThreshold,
  onValueThreshold,
  species,
}: {
  rows: Row[]
  marks: Map<string, Mark>
  n: number
  onN: (n: number) => void
  valueThreshold: number
  onValueThreshold: (n: number) => void
  species: 'cattle' | 'sheep'
}) {
  const db = useDb()
  const today = todayIso()
  const plan = useMemo(() => buildPlan(rows, marks, { n, today, valueThreshold }), [rows, marks, n, today, valueThreshold])
  const protectedCount = plan.shown.filter((e) => e.state === 'chance').length
  const kept = plan.shown.filter((e) => e.state === 'leben').length
  const fixed = plan.shown.filter((e) => e.state === 'fix').length

  const mark = (e: PlanEntry<Row>, next: Mark) => {
    // nochmals derselbe Daumen nimmt die Markierung wieder weg
    const current = marks.get(e.row.id) ?? null
    const target = current === next ? null : next
    void undoAction(`${e.row.label}: ${target === 'leben' ? 'bleibt' : target === 'schlachten' ? 'zum Schlachten' : 'Markierung weg'}`, () => setCullingMark(db, e.row.id, target, today)).catch((err) => notifyError(errorText(err)))
  }

  return (
    <div className="space-y-3">
      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold text-gray-800">Wie viele {species === 'sheep' ? 'Schafe' : 'Kühe'} sollen als Nächstes geschlachtet werden?</span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => onN(Math.max(0, n - 1))} aria-label="Eines weniger" className="grid h-12 w-12 place-items-center rounded-lg border-2 border-gray-400 text-xl font-bold active:bg-gray-100">
              −
            </button>
            <NumberInput value={n} step={1} onChange={(e) => onN(Math.max(0, Math.round(Number(e.target.value))))} aria-label="Anzahl zum Schlachten" className="h-12 w-16 rounded-lg border-2 border-gray-400 text-center text-xl font-bold" />
            <button type="button" onClick={() => onN(n + 1)} aria-label="Eines mehr" className="grid h-12 w-12 place-items-center rounded-lg border-2 border-gray-400 text-xl font-bold active:bg-gray-100">
              +
            </button>
          </span>
        </div>
        <label className="flex items-center justify-between gap-2 text-sm text-gray-700">
          <span>Wertvolle Tiere schonen ab Wert (Herdenmittel 100, 0 = nicht schonen)</span>
          <NumberInput value={valueThreshold} step={1} onChange={(e) => onValueThreshold(Math.max(0, Number(e.target.value)))} className="h-11 w-20 rounded-lg border-2 border-gray-300 px-2 text-right" />
        </label>
        <p className="text-sm text-gray-700">
          <b>{plan.active}</b> zum Schlachten
          {fixed > 0 ? ` (${fixed} fest)` : ''}
          {kept > 0 ? ` · ${kept} bleiben (👍)` : ''}
          {protectedCount > 0 ? ` · ${protectedCount} wertvoll geschont` : ''}
          {plan.waiting > 0 ? ` · ${plan.waiting} weitere würden nachrücken` : ''}
        </p>
        {marks.size > 0 && (
          <HoldButton
            label="Gedrückt halten: neue Runde (alle Markierungen weg)"
            onDone={() => void undoAction('Neue Runde: Markierungen gelöscht', () => clearCullingMarks(db)).catch((err) => notifyError(errorText(err)))}
          />
        )}
      </section>

      {plan.shown.length === 0 && <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Keine Tiere mit Hinweis. 👍</p>}

      <ul className="space-y-2">
        {plan.shown.map((e) => {
          const r = e.row
          const grey = e.state === 'leben' || e.state === 'chance'
          const pc = pregnancyChip(r.pregnancy)
          const m = marks.get(r.id) ?? null
          return (
            <li key={r.id} className={`rounded-lg bg-white shadow-sm ${e.state === 'fix' ? 'ring-2 ring-red-700' : ''}`}>
              <div className={`flex items-stretch gap-2 p-3 ${grey ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link to={`../tiere/${r.id}`} relative="path" className="font-semibold text-gray-800">
                      {r.laufNr && <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-sm font-bold">{r.laufNr}</span>}
                      {r.label}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_TEXT[e.state].chip}`}>{STATE_TEXT[e.state].label}</span>
                    {r.value != null && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isValuable(r.value, valueThreshold) ? 'bg-sky-100 text-sky-900' : 'bg-gray-100 text-gray-700'}`} title="Wert: Leistung, Zuchtwert, Wurfgrösse (Herdenmittel 100)">
                        💎 {Math.round(r.value)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${pc.cls}`}>{pc.text}</span>
                    <span className="text-gray-500">
                      {r.lactation ? `${r.lactation}. Laktation` : 'noch nicht gemolken'}
                      {r.performanceRel != null ? ` · Leistung ${Math.round(r.performanceRel * 100)} %` : ''}
                      {r.totalBv != null ? ` · ${species === 'sheep' ? 'GZW' : 'ISET'} ${r.totalBv}` : ''}
                    </span>
                  </div>
                  {r.reasons.length > 0 && (
                    <div className="mt-2">
                      <ReasonChips reasons={r.reasons} />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 border-t px-3 py-2 print:hidden">
                <button
                  type="button"
                  aria-pressed={m === 'leben'}
                  onClick={() => mark(e, 'leben')}
                  className={`min-h-12 flex-1 rounded-lg border-2 text-xl ${m === 'leben' ? 'border-green-700 bg-green-700 text-white' : 'border-gray-300 bg-white'}`}
                  aria-label={`${r.label} leben lassen`}
                >
                  👍 <span className="text-sm font-semibold">bleibt</span>
                </button>
                <button
                  type="button"
                  aria-pressed={m === 'schlachten'}
                  onClick={() => mark(e, 'schlachten')}
                  className={`min-h-12 flex-1 rounded-lg border-2 text-xl ${m === 'schlachten' ? 'border-red-800 bg-red-800 text-white' : 'border-gray-300 bg-white'}`}
                  aria-label={`${r.label} zum Schlachten`}
                >
                  👎 <span className="text-sm font-semibold">schlachten</span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
