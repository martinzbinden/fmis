import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import {
  downloadCsv,
  fetchNutrientReport,
  fetchParcelOverlapReport,
  recomputeShares,
  type NutrientReport,
  type ParcelOverlapReport,
} from '../lib/report'
import { fmtArea, fmtDate, PARCEL_CATEGORY_LABEL } from '../lib/format'
import { useShowAcker } from '../hooks/useShowAcker'
import AckerToggle from '../components/AckerToggle'

const CURRENT_YEAR = new Date().getFullYear()
type Tab = 'naehrstoffe' | 'weidegaenge'

export default function Report() {
  const [seasonYear, setSeasonYear] = useState(CURRENT_YEAR)
  const [tab, setTab] = useState<Tab>('naehrstoffe')

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Jahresauswertung {seasonYear}</h1>
        <select
          value={seasonYear}
          onChange={(e) => setSeasonYear(Number(e.target.value))}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-1 border-b">
        {(
          [
            ['naehrstoffe', 'Nährstoffe'],
            ['weidegaenge', 'Weidegänge'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key ? 'border-brand-600 text-brand-800' : 'border-transparent text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'naehrstoffe' ? <NutrientsTab seasonYear={seasonYear} /> : <OverlapTab seasonYear={seasonYear} />}
    </div>
  )
}

function NutrientsTab({ seasonYear }: { seasonYear: number }) {
  const [report, setReport] = useState<NutrientReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [farm, setFarm] = useState('')
  const [showAcker] = useShowAcker()
  const [onlyFertilized, setOnlyFertilized] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null)
  const canWrite = useHasPermission('wiesenjournal:duengung:write')

  function load() {
    setLoading(true)
    setError(null)
    fetchNutrientReport(seasonYear)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [seasonYear])

  const farms = useMemo(() => [...new Set((report?.parcels ?? []).map((p) => p.farm_name ?? '–'))], [report])
  const rows = useMemo(
    () =>
      (report?.parcels ?? []).filter(
        (p) =>
          (!farm || (p.farm_name ?? '–') === farm) &&
          (showAcker || p.category !== 'acker') &&
          (!onlyFertilized || p.applications > 0),
      ),
    [report, farm, showAcker, onlyFertilized],
  )
  const sum = (key: 'area_a' | 'n_kg' | 'n_avail_kg' | 'p2o5_kg' | 'k2o_kg') =>
    rows.reduce((s, p) => s + (p[key] ?? 0), 0)

  async function runRecompute() {
    setRecomputing(true)
    setRecomputeMsg(null)
    try {
      const r = await recomputeShares(seasonYear)
      setRecomputeMsg(
        `${r.entries} Massnahmen, ${r.shares} Anteile neu berechnet${r.without_type ? ` · ${r.without_type} ohne Düngerart` : ''}`,
      )
      load()
    } catch (err) {
      setRecomputeMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setRecomputing(false)
    }
  }

  function exportCsv() {
    downloadCsv(
      `naehrstoffe_${seasonYear}.csv`,
      ['Betrieb', 'Parzelle', 'Kategorie', 'Kultur', 'Fläche a', 'Massnahmen', 'N kg', 'N verfügbar kg', 'P2O5 kg', 'K2O kg', 'kg N/ha', 'kg N verf./ha'],
      rows.map((p) => [
        p.farm_name, p.name, PARCEL_CATEGORY_LABEL[p.category] ?? p.category, p.kultur_name_de, p.area_a,
        p.applications, p.n_kg, p.n_avail_kg, p.p2o5_kg, p.k2o_kg, p.n_kg_per_ha, p.n_avail_kg_per_ha,
      ]),
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Nährstoffe aus allen Düngungsmassnahmen der Saison, räumlich auf die GELAN-Parzellen verteilt (Teilflächen
        und GPS-Tracks anteilig). Werte gemäss{' '}
        <Link to="../duengerarten" className="text-brand-700 underline">
          Düngerarten
        </Link>
        . Server-berechnet, braucht Internet.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={farm} onChange={(e) => setFarm(e.target.value)} className="rounded border border-gray-300 px-2 py-1">
          <option value="">Alle Betriebe</option>
          {farms.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <AckerToggle />
        <label className="flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={onlyFertilized} onChange={(e) => setOnlyFertilized(e.target.checked)} className="h-3.5 w-3.5" />
          nur gedüngte
        </label>
        <span className="flex-1" />
        {canWrite && (
          <button
            type="button"
            onClick={runRecompute}
            disabled={recomputing}
            title="Nährstoffe und Anteile aller Massnahmen des Jahres neu berechnen (nach GELAN-Übernahme oder geänderten Düngerarten)"
            className="rounded border border-gray-300 px-2 py-1 text-gray-700 disabled:opacity-50"
          >
            {recomputing ? 'Rechnet…' : 'Neu berechnen'}
          </button>
        )}
        <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="rounded border border-gray-300 px-2 py-1 text-gray-700 disabled:opacity-50">
          CSV
        </button>
      </div>
      {recomputeMsg && <p className="rounded bg-brand-50 p-2 text-xs text-brand-900">{recomputeMsg}</p>}
      {loading && <p className="text-center text-gray-400">Lädt…</p>}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="px-2 py-2">Parzelle</th>
                <th className="px-2 py-2">Kultur</th>
                <th className="px-2 py-2 text-right">Fläche</th>
                <th className="px-2 py-2 text-right">Gaben</th>
                <th className="px-2 py-2 text-right">N kg</th>
                <th className="px-2 py-2 text-right">N verf.</th>
                <th className="px-2 py-2 text-right">P₂O₅</th>
                <th className="px-2 py-2 text-right">K₂O</th>
                <th className="px-2 py-2 text-right font-semibold">kg N/ha</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.parcel_id} className="border-b last:border-0">
                  <td className="px-2 py-1.5">
                    <span className="text-gray-400">{p.farm_name ? p.farm_name.slice(0, 1) + ' · ' : ''}</span>
                    {p.name}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-500">{p.kultur_name_de ?? PARCEL_CATEGORY_LABEL[p.category]}</td>
                  <td className="px-2 py-1.5 text-right">{p.area_a != null ? fmtArea(p.area_a) : '–'}</td>
                  <td className="px-2 py-1.5 text-right">{p.applications}</td>
                  <td className="px-2 py-1.5 text-right">{p.n_kg.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right">{p.n_avail_kg.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right">{p.p2o5_kg.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right">{p.k2o_kg.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{p.n_kg_per_ha ?? '–'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-gray-50 text-xs font-semibold text-gray-700">
                <td className="px-2 py-2" colSpan={2}>
                  Total ({rows.length} Parzellen)
                </td>
                <td className="px-2 py-2 text-right">{fmtArea(sum('area_a'))}</td>
                <td className="px-2 py-2 text-right">{rows.reduce((s, p) => s + p.applications, 0)}</td>
                <td className="px-2 py-2 text-right">{sum('n_kg').toFixed(1)}</td>
                <td className="px-2 py-2 text-right">{sum('n_avail_kg').toFixed(1)}</td>
                <td className="px-2 py-2 text-right">{sum('p2o5_kg').toFixed(1)}</td>
                <td className="px-2 py-2 text-right">{sum('k2o_kg').toFixed(1)}</td>
                <td className="px-2 py-2 text-right">{sum('area_a') > 0 ? ((sum('n_kg') / sum('area_a')) * 100).toFixed(1) : '–'}</td>
              </tr>
              {report.totals_by_farm.map((t) => (
                <tr key={t.key} className="text-xs text-gray-500">
                  <td className="px-2 py-1" colSpan={2}>
                    {t.key} (alle Parzellen)
                  </td>
                  <td className="px-2 py-1 text-right">{fmtArea(t.area_a)}</td>
                  <td />
                  <td className="px-2 py-1 text-right">{t.n_kg.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{t.n_avail_kg.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{t.p2o5_kg.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{t.k2o_kg.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{t.n_kg_per_ha ?? '–'}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400">
        Die Düngungskarte (Verschnitt aller Massnahmen, unabhängig von Parzellengrenzen) ist unter{' '}
        <Link to="../karte" className="text-brand-700 underline">
          Karte
        </Link>{' '}
        einblendbar.
      </p>
    </div>
  )
}

function OverlapTab({ seasonYear }: { seasonYear: number }) {
  const [report, setReport] = useState<ParcelOverlapReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchParcelOverlapReport(seasonYear)
      .then((r) => {
        if (!cancelled) setReport(r)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seasonYear])

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Verschneidet die Weidegänge dieser Saison mit den deklarierten GELAN-Parzellen aus dem Kulturen-Modul
        (echte räumliche Berechnung, kein fester Bezug) — zeigt pro Parzelle, welche Weidegänge sie wie stark
        überlappen. Braucht eine Internetverbindung.
      </p>

      {loading && <p className="text-center text-gray-400">Lädt…</p>}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {report && report.parcels.length === 0 && !loading && !error && (
        <p className="text-center text-gray-500">
          Keine überlappenden GELAN-Parzellen für {seasonYear} gefunden — entweder wurden im Kulturen-Modul noch
          keine Raumdaten importiert, oder es gibt für dieses Jahr keine Weidegänge.
        </p>
      )}

      <ul className="space-y-3">
        {report?.parcels.map((p) => (
          <li key={p.field_declaration_id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="font-semibold text-gray-800">
              {p.flurname ?? p.kultur_name_de ?? 'Parzelle'}
              {p.area_a != null && <span className="ml-2 text-xs text-gray-400">({fmtArea(p.area_a)})</span>}
            </div>
            <ul className="mt-2 space-y-1">
              {p.overlaps.map((o) => (
                <li key={o.paddock_id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    {o.animal_group ?? 'Weidegang'} · seit {fmtDate(o.valid_from)}
                    {o.valid_to ? ` bis ${fmtDate(o.valid_to)}` : ''}
                  </span>
                  <span className="font-medium text-brand-700">
                    {fmtArea(o.overlap_a)}
                    {o.overlap_pct != null ? ` (${o.overlap_pct}%)` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
