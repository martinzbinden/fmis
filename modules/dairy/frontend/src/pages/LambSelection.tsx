import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { animalLabel, shortEarTag } from '@fmis/core/earTag'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import { fmtCells } from '../lib/culling'
import { todayIso } from '../lib/format'
import { DEFAULT_SELECTION_SETTINGS, rankLambs, type LambRow, type Purpose, type SelectionSettings } from '../lib/lambSelection'
import { loadLambSelection, saveDecision, SIRE_TRAIT } from '../lib/lambSelectionData'
import { speciesOf } from '../lib/species'
import { InbreedingBadge } from './AnimalDetail'

function settingsKey(moduleKey: string) {
  return `${moduleKey}_lamb_selection`
}

function loadSettings(moduleKey: string): SelectionSettings {
  try {
    const raw = localStorage.getItem(settingsKey(moduleKey))
    if (raw) return { ...DEFAULT_SELECTION_SETTINGS, ...(JSON.parse(raw) as Partial<SelectionSettings>) }
  } catch {
    // ohne localStorage gelten die Vorgaben
  }
  return DEFAULT_SELECTION_SETTINGS
}

type SexFilter = 'w' | 'alle' | 'm'
type DecisionFilter = 'alle' | 'offen' | 'zucht' | 'mast'

const BASIS_LABEL: Record<string, string> = { gut: 'gut', mittel: 'mittel', duenn: 'dünn' }

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function ageText(days: number): string {
  return days < 60 ? `${days} T.` : `${(days / 30.4375).toLocaleString('de-CH', { maximumFractionDigits: 1 })} Mt.`
}

/** Jungtier-Selektion: Rangliste der weiblichen Jungtiere nach dem Index
 * ihrer Mutter (lib/lambSelection.ts), Entscheid Remonte/Mast je Tier. Die
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

  const visible = rows.filter(
    (r) =>
      (sexFilter === 'alle' || r.sex === sexFilter || (sexFilter === 'w' && r.sex == null)) &&
      (decisionFilter === 'alle' || (decisionFilter === 'offen' ? r.purpose == null : r.purpose === decisionFilter)),
  )
  const count = (p: Purpose | null) => rows.filter((r) => r.purpose === p).length

  async function decide(r: LambRow, purpose: Purpose) {
    if (!data) return
    setSaving(r.key)
    try {
      await saveDecision(db, r.key, r.purpose === purpose ? null : purpose, data.decisions.get(r.key), today)
    } finally {
      setSaving(null)
    }
  }

  function exportCsv() {
    const header = ['Rang', youngWord, 'Geburt', 'Geschlecht', 'Wurf', 'Mutter', 'Leistung rel.', 'Basis', `Zellzahl ('000)`, 'Datenbasis', 'Vater', sireTrait.label, 'Inzucht %', 'Index', 'Entscheid']
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
        settings.scc12m ? r.dam?.performance?.scc_geo_12m : r.dam?.performance?.scc_geo,
        r.dam?.performance?.data_basis,
        shortEarTag(r.sire_key),
        r.sire_value,
        (r.inbreeding * 100).toFixed(1),
        r.index,
        r.purpose,
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

  const weightField = (key: 'weightPerformance' | 'weightScc' | 'weightSire', label: string) => (
    <label className="flex items-center justify-between gap-2 text-sm text-gray-700">
      {label}
      <input
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={settings[key]}
        onChange={(e) => updateSettings({ ...settings, [key]: Math.max(0, Number(e.target.value) || 0) })}
        className="w-20 rounded border border-gray-300 px-2 py-1 text-right"
      />
    </label>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-24">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Selektion {sheep ? 'Lämmer' : 'Kälber'}</h1>
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={exportCsv} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            CSV
          </button>
          <button type="button" onClick={() => window.print()} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            Drucken
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Bewertet wird die Mutter: Leistung im Vergleich mit Gleichaltrigen (Lebenstagleistung, bei Erstlingen die Standardlaktation)
        und Zellzahl, je auf Mittel 100 / Streuung 10 gebracht. Optional zählt der {sireTrait.label} des Vaters mit — aus dem
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
          <option value="offen">offen ({count(null)})</option>
          <option value="zucht">Remonte ({count('zucht')})</option>
          <option value="mast">Mast ({count('mast')})</option>
        </select>
        <button type="button" onClick={() => setShowSettings((v) => !v)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
          ⚙ Gewichtung
        </button>
      </div>

      {showSettings && (
        <div className="grid gap-2 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-2 print:hidden">
          {weightField('weightPerformance', 'Gewicht Leistung Mutter')}
          {weightField('weightScc', 'Gewicht Zellzahl Mutter')}
          {weightField('weightSire', `Gewicht ${sireTrait.label} Vater`)}
          <label className="flex items-center justify-between gap-2 text-sm text-gray-700">
            Höchstalter (Monate)
            <input
              type="number"
              min={1}
              max={36}
              value={settings.maxAgeMonths}
              onChange={(e) => updateSettings({ ...settings, maxAgeMonths: Math.max(1, Number(e.target.value) || 1) })}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-right"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={settings.scc12m} onChange={(e) => updateSettings({ ...settings, scc12m: e.target.checked })} />
            Zellzahl nur letzte 12 Monate
          </label>
          <button type="button" onClick={() => updateSettings(DEFAULT_SELECTION_SETTINGS)} className="text-left text-sm text-brand-700 underline">
            Vorgaben (60 / 40 / 0, 8 Monate)
          </button>
          <p className="text-xs text-gray-500 sm:col-span-2">
            Die Gewichte werden auf 100 % umgerechnet. Fehlt ein Teilwert, zählt er als Herdenmittel 100.
          </p>
        </div>
      )}

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
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
                <th className="px-2 py-2 print:hidden">Entscheid</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const p = r.dam?.performance
                const scc = settings.scc12m ? p?.scc_geo_12m : p?.scc_geo
                return (
                  <tr key={r.key} className={`border-b align-top last:border-0 ${r.purpose === 'mast' ? 'text-gray-400' : ''}`}>
                    <td className="px-2 py-2 text-right font-bold">{r.rank ?? ''}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {r.animal_id ? (
                        <Link to={`../kuehe/${r.animal_id}`} relative="path" className="font-semibold">
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
                        <Link to={`../kuehe/${r.dam.id}`} relative="path">
                          {r.dam.lauf_nr && <span className="mr-1 font-bold">{r.dam.lauf_nr}</span>}
                          {animalLabel(r.dam)}
                        </Link>
                      ) : (
                        <span className="text-gray-400">{r.dam_key ? shortEarTag(r.dam_key) : 'unbekannt'}</span>
                      )}
                      <div className="text-xs text-gray-500">
                        {p ? `${p.lactation_group}. Lakt. · Daten ${BASIS_LABEL[p.data_basis]}` : r.dam ? 'nicht mehr im Bestand' : ''}
                        {r.dam_daughters > 1 ? ` · ${r.dam_daughters} Töchter` : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {p?.performance_rel != null ? `${Math.round(p.performance_rel * 100)} %` : '–'}
                      <div className="text-xs text-gray-500">{p?.performance_basis === 'Standardlaktation' ? 'Std.-Lakt.' : p?.performance_basis ? 'LTL' : ''}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{scc != null ? fmtCells(scc) : '–'}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {r.sire_key ? (
                        <Link to={`/${moduleKey}/stammbaum/${encodeURIComponent(r.sire_key)}`}>{shortEarTag(r.sire_key)}</Link>
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
                    <td className="whitespace-nowrap px-2 py-2 print:hidden">
                      <div className="flex gap-1">
                        {(
                          [
                            ['zucht', 'Remonte', 'bg-green-600'],
                            ['mast', 'Mast', 'bg-amber-600'],
                          ] as const
                        ).map(([purpose, label, active]) => (
                          <button
                            key={purpose}
                            type="button"
                            disabled={saving === r.key}
                            onClick={() => void decide(r, purpose)}
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                              r.purpose === purpose ? `${active} text-white` : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
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
