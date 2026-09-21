import { useEffect, useState } from 'react'
import { fetchParcelOverlapReport, type ParcelOverlapReport } from '../lib/report'
import { fmtArea, fmtDate } from '../lib/format'

const CURRENT_YEAR = new Date().getFullYear()

export default function Report() {
  const [seasonYear, setSeasonYear] = useState(CURRENT_YEAR)
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
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
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

      <p className="text-xs text-gray-500">
        Verschneidet die Weidegänge dieser Saison mit den deklarierten GELAN-Parzellen aus dem
        Kulturen-Modul (echte räumliche Berechnung, kein fester Bezug) — zeigt pro Parzelle, welche
        Weidegänge sie wie stark überlappen. Braucht eine Internetverbindung (server-berechnet, nicht
        aus der lokalen Offline-Kopie).
      </p>

      {loading && <p className="text-center text-gray-400">Lädt…</p>}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {report && report.parcels.length === 0 && !loading && !error && (
        <p className="text-center text-gray-500">
          Keine überlappenden GELAN-Parzellen für {seasonYear} gefunden — entweder wurden im
          Kulturen-Modul noch keine Raumdaten importiert, oder es gibt für dieses Jahr keine
          Weidegänge.
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
