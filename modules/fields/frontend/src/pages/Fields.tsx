import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { importFieldsZips, type ImportSummary } from '../lib/importFields'
import FieldMap from '../components/FieldMap'
import { fmtArea, num } from '../lib/format'
import { colorForKultur } from '../lib/kulturColor'
import type { Farm, FieldDeclaration } from '../types'

async function loadFarms(pg: PGlite): Promise<Farm[]> {
  const { rows } = await pg.query<Farm>('select * from farms where deleted_at is null order by name')
  return rows
}

async function loadDeclarations(pg: PGlite): Promise<FieldDeclaration[]> {
  const { rows } = await pg.query<FieldDeclaration>(
    `select * from field_declarations where deleted_at is null order by jahr desc, flurname`,
  )
  return rows.map((r) => ({ ...r, area_a: num(r.area_a) }))
}

export default function Fields() {
  const location = useLocation()
  const { data: farms } = useQuery(loadFarms)
  const { data: declarations, refresh } = useQuery(loadDeclarations)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importing, setImporting] = useState(false)
  const [year, setYear] = useState<number | null>(null)
  const [focusLineageId, setFocusLineageId] = useState<string | null>(null)

  const farmNameById = useMemo(() => new Map((farms ?? []).map((f) => [f.id, f.name])), [farms])

  const years = useMemo(() => {
    const set = new Set((declarations ?? []).map((d) => d.jahr))
    return [...set].sort((a, b) => b - a)
  }, [declarations])

  useEffect(() => {
    if (year == null && years.length > 0) setYear(years[0])
  }, [years, year])

  // Von der Fruchtfolge-Ansicht per Weltkarte-Icon hierher gesprungen
  // (siehe pages/Rotation.tsx) — einmalig übernehmen, damit ein späterer
  // erneuter Besuch der Seite (z.B. über die Nav) nicht wieder fokussiert.
  const consumedFocusRef = useRef(false)
  useEffect(() => {
    if (consumedFocusRef.current) return
    const state = location.state as { focusLineageId?: string; focusJahr?: number } | null
    if (state?.focusLineageId) {
      consumedFocusRef.current = true
      setFocusLineageId(state.focusLineageId)
      if (state.focusJahr != null) setYear(state.focusJahr)
    }
  }, [location.state])

  const filtered = useMemo(
    () => (declarations ?? []).filter((d) => year == null || d.jahr === year),
    [declarations, year],
  )

  const legend = useMemo(() => {
    const seen = new Map<string, string>()
    for (const d of filtered) {
      if (!seen.has(d.kultur_code)) seen.set(d.kultur_code, d.kultur_name_de ?? d.kultur_code)
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [filtered])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setImporting(true)
    try {
      const summary = await importFieldsZips([...fileList])
      setImportSummary(summary)
      refresh()
    } catch (err) {
      setImportSummary({
        farmsImported: 0,
        managementUnitsImported: 0,
        fieldDeclarationsImported: 0,
        warnings: [err instanceof Error ? err.message : 'Import fehlgeschlagen'],
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Karte</h1>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">Raumdaten importieren</h2>
        <p className="mt-1 text-xs text-gray-500">
          Ein oder mehrere "Raumdatenexport Bewirtschafter"-ZIPs auswählen (ein ZIP pro Betrieb, beide
          Betriebe können gleichzeitig ausgewählt werden).
        </p>
        <input
          type="file"
          accept=".zip"
          multiple
          disabled={importing}
          onChange={(e) => handleFiles(e.target.files)}
          className="mt-2 block w-full text-sm"
        />
        {importing && <p className="mt-2 text-sm text-gray-400">Importiere…</p>}
        {importSummary && (
          <div className="mt-3 rounded bg-brand-50 p-3 text-sm text-brand-900">
            <p>
              {importSummary.farmsImported} Betriebe, {importSummary.managementUnitsImported}{' '}
              Bewirtschaftungseinheiten, {importSummary.fieldDeclarationsImported} Kulturflächen importiert.
            </p>
            {importSummary.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-amber-800">
                {importSummary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {farms && farms.length === 0 && (
        <p className="text-center text-gray-500">Noch keine Betriebe — zuerst Raumdaten importieren.</p>
      )}

      {years.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600" htmlFor="year">
            Jahr
          </label>
          <select
            id="year"
            value={year ?? ''}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400">
            {filtered.length} Parzellen · {fmtArea(filtered.reduce((sum, d) => sum + (d.area_a ?? 0), 0))}
          </span>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <FieldMap declarations={filtered} farmNameById={farmNameById} focusLineageId={focusLineageId} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white p-3 text-xs shadow-sm">
            {legend.map(([code, name]) => (
              <span key={code} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: colorForKultur(code) }}
                />
                {name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
