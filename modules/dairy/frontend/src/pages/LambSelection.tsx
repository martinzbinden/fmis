import TrendBadge from '../components/TrendBadge'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { animalLabel, shortEarTag } from '@fmis/core/earTag'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import { useJumpTarget, useJumpTo } from '../hooks/useJumpTo'
import { fmtCells } from '../lib/culling'
import { todayIso } from '../lib/format'
import { DEFAULT_SELECTION_SETTINGS, rankLambs, type LambRow, type SelectionSettings } from '../lib/lambSelection'
import { choiceOfKey, loadLambSelection, recommendationsFor, saveDecision, SIRE_TRAIT } from '../lib/lambSelectionData'
import { PRESELECTIONS, preselectionLabel, type Preselection, type Recommendation } from '../lib/lambRecommendation'
import ChoiceScale from '../components/ChoiceScale'
import TapInfo from '../components/TapInfo'
import { speciesOf } from '../lib/species'
import { InbreedingBadge } from './AnimalDetail'
import NumberInput from '@fmis/core/NumberInput'
import { useMilkFeedSettings } from '../lib/milkFeed'
import { DEFAULT_LAMB_VALUE, LAMB_VALUE_FIELDS, lambValue, lambValueTip, loadLambValueSettings, saveLambValueSettings, type LambValue, type LambValueSettings } from '../lib/lambValue'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'

function settingsKey(moduleKey: string) {
  return `${moduleKey}_lamb_selection`
}

export function loadSettings(moduleKey: string): SelectionSettings {
  try {
    const raw = localStorage.getItem(settingsKey(moduleKey))
    if (raw) return { ...DEFAULT_SELECTION_SETTINGS, ...(JSON.parse(raw) as Partial<SelectionSettings>) }
  } catch {
    // ohne localStorage gelten die Vorgaben
  }
  return DEFAULT_SELECTION_SETTINGS
}

type SexFilter = 'w' | 'alle' | 'm'
type DecisionFilter = 'alle' | 'offen' | Preselection

const BASIS_LABEL: Record<string, string> = { gut: 'gut', mittel: 'mittel', duenn: 'dünn' }

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function ageText(days: number): string {
  return days < 91 ? `${days} T.` : `${(days / 30.4375).toLocaleString('de-CH', { maximumFractionDigits: 1 })} Mt.`
}

/** Jungtier-Selektion: Rangliste der weiblichen Jungtiere nach dem Index
 * ihrer Mutter (lib/lambSelection.ts), Zuchtauswahl je Tier mit Skala und Empfehlung wie nach der Geburt. Die
 * Mast-Tiere übernimmt der Mastplaner ("Eigene Lämmer übernehmen"). */
export default function LambSelection({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const sheep = species === 'sheep'
  const youngWord = sheep ? 'Lamm' : 'Kalb'
  const sireTrait = SIRE_TRAIT[species]
  const db = useDb()
  const today = todayIso()
  const { data, loading } = useQuery((pg) => loadLambSelection(pg, species, today), [species, today])
  const [settings, setSettings] = useState(() => loadSettings(moduleKey))
  const [sexFilter, setSexFilter] = useState<SexFilter>('w')
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('alle')
  const [showSettings, setShowSettings] = useState(false)
  // Geldwert als Zuchttier (lib/lambValue.ts): Milchpreis aus «Milch gegen Futter»
  const milkPrice = useMilkFeedSettings(moduleKey, species).milkPrice
  const [valueSettings, setValueSettings] = useState<LambValueSettings>(() => loadLambValueSettings(moduleKey, species))
  const [saving, setSaving] = useState<string | null>(null)

  function updateSettings(next: SelectionSettings) {
    setSettings(next)
    try {
      localStorage.setItem(settingsKey(moduleKey), JSON.stringify(next))
    } catch {
      // nur bis zum Reload
    }
  }

  const rows = useMemo<LambRow[]>(() => {
    if (!data) return []
    return rankLambs({
      candidates: data.candidates,
      dams: data.dams,
      sireValues: data.sireValues,
      inbreeding: (dam, sire) => data.inbreeding.offspring(dam, sire),
      decisions: new Map([...data.decisions].map(([k, d]) => [k, d.purpose])),
      settings,
      today,
    })
  }, [data, settings, today])

  const values = useMemo(() => {
    const m = new Map<string, LambValue>()
    for (const r of rows) {
      const p = r.dam?.performance
      const v = lambValue({ damRel: p?.performance_rel ?? null, damLactations: p?.n_lactations ?? 0, sireValue: r.sire_value }, valueSettings, data?.herdLactationKg ?? null, milkPrice)
      if (v) m.set(r.key, v)
    }
    return m
  }, [rows, valueSettings, data, milkPrice])
  const choiceOf = (r: LambRow): Preselection | null => (data ? choiceOfKey(data, r.key) : null)
  const recommendations = useMemo(() => (data ? recommendationsFor(rows, data, settings, species) : new Map<string, Recommendation>()), [data, rows, settings, species])
  const fr = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toLocaleString('de-CH')} Fr.`

  const jumpTo = useJumpTarget()
  const visible = rows.filter(
    (r) =>
      r.animal_id === jumpTo ||
      (sexFilter === 'alle' || r.sex === sexFilter || (sexFilter === 'w' && r.sex == null)) &&
      (decisionFilter === 'alle' || (decisionFilter === 'offen' ? r.purpose == null : choiceOf(r) === decisionFilter)),
  )
  useJumpTo(!!data, jumpTo ? `tier-${jumpTo}` : null)
  const count = (f: DecisionFilter) => rows.filter((r) => (f === 'offen' ? r.purpose == null : choiceOf(r) === f)).length

  async function decide(r: LambRow, next: Preselection | null) {
    if (!data) return
    setSaving(r.key)
    try {
      await saveDecision(db, r.key, next, data.decisions.get(r.key), today)
    } finally {
      setSaving(null)
    }
  }

  function exportCsv() {
    const header = ['Rang', youngWord, 'Geburt', 'Geschlecht', 'Wurf', 'Mutter', 'Leistung rel.', 'Basis', 'Tendenz Mutter je Lakt.', `Zellzahl ('000)`, 'Datenbasis', 'Vater', sireTrait.label, 'Inzucht %', 'Index', 'Zucht-Mehrwert Fr.', 'Milch erwartet %', 'Empfehlung', 'Zuchtauswahl']
    const lines = visible.map((r) =>
      [
        r.rank,
        animalLabel(r),
        r.birth_date,
        r.sex,
        r.litter_size,
        r.dam ? `${r.dam.lauf_nr ?? ''} ${animalLabel(r.dam)}`.trim() : shortEarTag(r.dam_key),
        r.dam?.performance?.performance_rel,
        r.dam?.performance?.performance_basis,
        r.dam?.trend?.slope != null ? Math.round(r.dam.trend.slope * 100) : null,
        settings.scc12m ? r.dam?.performance?.scc_geo_12m : r.dam?.performance?.scc_geo,
        r.dam?.performance?.data_basis,
        shortEarTag(r.sire_key),
        r.sire_value,
        (r.inbreeding * 100).toFixed(1),
        r.index,
        values.get(r.key)?.francs,
        values.get(r.key)?.pct,
        preselectionLabel(recommendations.get(r.key)?.choice),
        preselectionLabel(choiceOf(r)),
      ]
        .map(csvEscape)
        .join(';'),
    )
    const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `selektion-${moduleKey}-${today}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  type WeightKey = 'weightPerformance' | 'weightScc' | 'weightSire' | 'weightTrend'
  const weightField = (v: SelectionSettings, set: (n: SelectionSettings) => void, editing: boolean, key: WeightKey, label: string) => (
    <label className="flex items-center justify-between gap-2 text-sm text-gray-700">
      {label}
      {editing ? (
        <NumberInput min={0} max={1} step={0.05} value={v[key]} onChange={(e) => set({ ...v, [key]: Math.max(0, Number(e.target.value) || 0) })} className="w-20 rounded border border-gray-300 px-2 py-1 text-right" />
      ) : (
        <ReadValue>{v[key]}</ReadValue>
      )}
    </label>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-24">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Selektion {sheep ? 'Lämmer' : 'Kälber'}</h1>
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={exportCsv} className="link-btn rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            CSV
          </button>
          <button type="button" onClick={() => window.print()} className="link-btn rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            Drucken
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Bewertet wird die Mutter: Leistung im Vergleich mit Gleichaltrigen (Lebenstagleistung, bei Erstlingen die Standardlaktation)
        und Zellzahl, dazu die Tendenz ihrer Leistung über die Laktationen (fallend = schlechter; Mütter mit nur einer
        bewerteten Laktation zählen neutral), je auf Mittel 100 / Streuung 10 gebracht. Optional zählt der {sireTrait.label} des Vaters mit — aus dem
        Herdebuch-Export oder einem importierten Leistungsausweis (PDF); fehlt sein eigener Wert, das Mittel seiner Eltern. Geschwister eines Wurfs sind gleich eingestuft; dort entscheiden Exterieur,
        Euteranlage und Entwicklung am Tier.
      </p>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select value={sexFilter} onChange={(e) => setSexFilter(e.target.value as SexFilter)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="w">weiblich</option>
          <option value="m">männlich</option>
          <option value="alle">alle</option>
        </select>
        <select
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value as DecisionFilter)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="alle">alle Entscheide</option>
          <option value="offen">offen, ohne Zucht/Mast ({count('offen')})</option>
          {PRESELECTIONS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label} ({count(c.key)})
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setShowSettings((v) => !v)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
          ⚙ Gewichtung und Geldwert
        </button>
      </div>

      {showSettings && (
        <SettingsEditor value={settings} onSave={updateSettings} onReset={() => DEFAULT_SELECTION_SETTINGS} label="Gewichtung" className="rounded-lg bg-white p-4 shadow-sm print:hidden" title="Gewichtung des Index">
          {({ value, set, editing }) => (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {weightField(value, set, editing, 'weightPerformance', 'Gewicht Leistung Mutter')}
              {weightField(value, set, editing, 'weightScc', 'Gewicht Zellzahl Mutter')}
              {weightField(value, set, editing, 'weightSire', `Gewicht ${sireTrait.label} Vater`)}
              {weightField(value, set, editing, 'weightTrend', 'Gewicht Tendenz Mutter über die Laktationen')}
              <label className="flex items-center justify-between gap-2 text-sm text-gray-700">
                Höchstalter (Monate)
                {editing ? (
                  <NumberInput min={1} max={36} value={value.maxAgeMonths} onChange={(e) => set({ ...value, maxAgeMonths: Math.max(1, Number(e.target.value) || 1) })} className="w-20 rounded border border-gray-300 px-2 py-1 text-right" />
                ) : (
                  <ReadValue>{value.maxAgeMonths}</ReadValue>
                )}
              </label>
              <label className="flex items-center justify-between gap-2 text-sm text-gray-700">
                Zellzahl nur letzte 12 Monate
                {editing ? <input type="checkbox" checked={value.scc12m} onChange={(e) => set({ ...value, scc12m: e.target.checked })} className="h-5 w-5" /> : <ReadValue>{value.scc12m ? 'Ja' : 'Nein'}</ReadValue>}
              </label>
              <p className="text-xs text-gray-500 sm:col-span-2">Die Gewichte werden auf 100 % umgerechnet. Fehlt ein Teilwert, zählt er als Herdenmittel 100. Vorgaben: 60 / 40 / 0, 8 Monate.</p>
            </div>
          )}
        </SettingsEditor>
      )}

      {showSettings && (
        <SettingsEditor
          value={valueSettings}
          onSave={(v) => {
            setValueSettings(v)
            saveLambValueSettings(moduleKey, v)
          }}
          onReset={() => DEFAULT_LAMB_VALUE[species]}
          label="Zucht-Mehrwert"
          className="rounded-lg bg-white p-4 shadow-sm print:hidden"
          title="Zucht-Mehrwert in Franken"
        >
          {({ value, set, editing }) => (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {LAMB_VALUE_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-2 text-sm text-gray-700">
                  {f.label}
                  {editing ? (
                    <NumberInput min={0} step={f.step} value={value[f.key]} onChange={(e) => set({ ...value, [f.key]: Math.max(0, Number(e.target.value) || 0) })} className="w-20 rounded border border-gray-300 px-2 py-1 text-right" />
                  ) : (
                    <ReadValue>{value[f.key]}</ReadValue>
                  )}
                </label>
              ))}
              <p className="text-xs text-gray-500 sm:col-span-2">
                Erwartete Milch des Jungtiers = ½ × Erbanteil der Mutterleistung + ½ × Vater. Erbanteil der Mutter = n·h² / (1 + (n−1)·Wiederholbarkeit) bei n
                Laktationen. In Franken: × Herdenmittel {data?.herdLactationKg ? `${data.herdLactationKg.toLocaleString('de-CH')} kg` : '(zu wenig Laktationen)'} je Laktation × Milchpreis{' '}
                {milkPrice.toFixed(2)} Fr./kg (Einstellung «Milch gegen Futter») × Laktationen. Nur Milchmenge, ohne Zellzahl und Gehalte; Vergleich mit einem Durchschnittstier.
              </p>
            </div>
          )}
        </SettingsEditor>
      )}

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}
      {data && visible.length === 0 && (
        <p className="text-center text-sm text-gray-500">
          Keine Jungtiere bis {settings.maxAgeMonths} Monate. Jungtiere kommen aus der Geburtserfassung, dem Herdebuch-Export oder dem
          TVD-Tierbestand.
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="px-2 py-2 text-right">Rang</th>
                <th className="px-2 py-2">{youngWord}</th>
                <th className="px-2 py-2">Alter</th>
                <th className="px-2 py-2">Mutter</th>
                <th className="px-2 py-2 text-right">Leistung</th>
                <th className="px-2 py-2 text-right">Zellzahl</th>
                <th className="px-2 py-2">Vater</th>
                <th className="px-2 py-2 text-center">Inzucht</th>
                <th className="bg-brand-50 px-2 py-2 text-right text-brand-800">Index</th>
                <th className="px-2 py-2 text-right" title="Mehr- oder Minderwert als Zuchttier gegenüber einem Durchschnittstier, nur aus der Milchmenge der Eltern">
                  Zucht-Mehrwert
                </th>
                <th className="px-2 py-2">Zuchtauswahl</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const p = r.dam?.performance
                const scc = settings.scc12m ? p?.scc_geo_12m : p?.scc_geo
                return (
                  <tr key={r.key} id={r.animal_id ? `tier-${r.animal_id}` : undefined} className={`scroll-mt-20 border-b align-top last:border-0 ${choiceOf(r) === 'mast' ? 'text-gray-500' : ''} ${r.animal_id && r.animal_id === jumpTo ? 'bg-brand-50 outline outline-2 outline-brand-700' : ''}`}>
                    <td className="px-2 py-2 text-right font-bold">{r.rank ?? ''}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {r.animal_id ? (
                        <Link to={`../tiere/${r.animal_id}`} relative="path" className="-my-2 inline-flex min-h-10 items-center font-semibold">
                          {animalLabel(r)}
                        </Link>
                      ) : (
                        <span className="font-semibold">{animalLabel(r)}</span>
                      )}
                      <div className="text-xs text-gray-500">
                        {r.sex === 'w' ? '♀' : r.sex === 'm' ? '♂' : ''}
                        {r.litter_size ? ` · ${r.litter_size === 1 ? 'Einling' : `${r.litter_size}er-Wurf`}` : ''}
                        {r.birth_weight_kg ? ` · ${r.birth_weight_kg} kg` : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-gray-600">{ageText(r.age_days)}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {r.dam ? (
                        <Link to={`../tiere/${r.dam.id}`} relative="path" className="-my-2 inline-flex min-h-10 items-center">
                          {r.dam.lauf_nr && <span className="mr-1 font-bold">{r.dam.lauf_nr}</span>}
                          {animalLabel(r.dam)}
                        </Link>
                      ) : (
                        <span className="text-gray-500">{r.dam_key ? shortEarTag(r.dam_key) : 'unbekannt'}</span>
                      )}
                      <div className="text-xs text-gray-500">
                        {p ? `${p.lactation_group}. Lakt. · Daten ${BASIS_LABEL[p.data_basis]}` : r.dam ? 'nicht mehr im Bestand' : ''}
                        {r.dam_daughters > 1 ? ` · ${r.dam_daughters} Töchter` : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {p?.performance_rel != null ? `${Math.round(p.performance_rel * 100)} %` : '–'}
                      <div className="text-xs text-gray-500">{p?.performance_basis === 'Standardlaktation' ? 'Std.-Lakt.' : p?.performance_basis ? 'LTL' : ''}</div>
                      {r.dam?.trend && (
                        <div className="mt-0.5">
                          <TrendBadge trend={r.dam.trend} compact />
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{scc != null ? fmtCells(scc) : '–'}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {r.sire_key ? (
                        <Link to={`/${moduleKey}/stammbaum/${encodeURIComponent(r.sire_key)}`} className="-my-2 inline-flex min-h-10 items-center">
                          {shortEarTag(r.sire_key)}
                        </Link>
                      ) : (
                        '–'
                      )}
                      {r.sire_value != null && (
                        <div className="text-xs text-gray-500">
                          {sireTrait.label} {r.sire_value}
                          {data?.sireValueBasis.get(r.sire_key ?? '') === 'eltern' ? ' (Elternmittel)' : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <InbreedingBadge f={r.inbreeding} />
                    </td>
                    <td className="bg-brand-50 px-2 py-2 text-right text-base font-bold text-brand-900">
                      {r.index != null ? r.index.toLocaleString('de-CH', { minimumFractionDigits: 1 }) : '–'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {values.get(r.key) ? (
                        (() => {
                          const v = values.get(r.key)!
                          const inner = (
                            <>
                              <span className={`block whitespace-nowrap font-semibold ${v.francs < 0 ? 'text-red-800' : 'text-gray-900'}`}>{fr(v.francs)}</span>
                              <span className="block whitespace-nowrap text-xs text-gray-500">
                                Milch {v.pct > 0 ? '+' : v.pct < 0 ? '−' : '±'}
                                {Math.abs(v.pct).toLocaleString('de-CH')} %
                              </span>
                            </>
                          )
                          if (!data?.herdLactationKg) return inner
                          // Rechenweg nach Antippen (am Handy gibt es kein title)
                          const tip = lambValueTip(v, valueSettings, data.herdLactationKg, milkPrice)
                          return (
                            <TapInfo info={<span className="block max-w-[14rem] whitespace-normal text-left">{tip}</span>} title={tip} className="ml-auto block min-h-10 text-right">
                              {inner}
                            </TapInfo>
                          )
                        })()
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="print:hidden">
                        <ChoiceScale compact value={choiceOf(r)} recommended={recommendations.get(r.key)?.choice} onChoose={(next) => void decide(r, next)} disabled={saving === r.key} label={`Zuchtauswahl ${animalLabel(r)}`} />
                      </div>
                      <div className="hidden print:block">{preselectionLabel(choiceOf(r)) ?? '–'}</div>
                      {recommendations.get(r.key) && (
                        <div className="mt-0.5 max-w-[17rem] text-xs text-gray-600" title={recommendations.get(r.key)!.reasons.join(', ')}>
                          Empfehlung <b>{preselectionLabel(recommendations.get(r.key)!.choice)}</b>
                          {recommendations.get(r.key)!.reasons.length > 0 && <span> · {recommendations.get(r.key)!.reasons.join(', ')}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {sheep && count('mast') > 0 && (
        <p className="text-xs text-gray-500 print:hidden">
          Mast-Lämmer übernimmt der Mastplaner unter Tiere → «Eigene Lämmer übernehmen» — auf einem Gerät, auf dem die Milchschafe schon geöffnet wurden.
        </p>
      )}
    </div>
  )
}
