import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { importFieldsZips, type ImportSummary } from '../lib/importFields'
import { copyToPlan, createPlanParcel, saveNewVersion, deletePlanParcel } from '../lib/planLayer'
import FieldMap from '../components/FieldMap'
import PlanningMap from '../components/PlanningMap'
import Modal from '../components/Modal'
import PlanParcelDetails from '../components/PlanParcelDetails'
import { fmtArea, num } from '../lib/format'
import { colorForKultur } from '../lib/kulturColor'
import type { Farm, FieldDeclaration, PlanParcel } from '../types'

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

async function loadPlanParcels(pg: PGlite): Promise<PlanParcel[]> {
  const { rows } = await pg.query<PlanParcel>(`select * from v_plan_parcels_current order by flurname nulls last`)
  return rows.map((r) => ({ ...r, area_a: num(r.area_a) }))
}

export default function Fields() {
  const location = useLocation()
  const { data: farms } = useQuery(loadFarms)
  const { data: declarations, refresh } = useQuery(loadDeclarations)
  const { data: planParcels } = useQuery(loadPlanParcels)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importing, setImporting] = useState(false)
  const [year, setYear] = useState<number | null>(null)
  const [focusLineageId, setFocusLineageId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)
  const [layerMode, setLayerMode] = useState<'import' | 'planung'>('import')
  const [detailsPlanId, setDetailsPlanId] = useState<string | null>(null)

  // Kultur-Auswahl für den Planungs-Layer — wächst organisch mit jedem
  // Import, gleiches Muster wie pages/Rotation.tsx.
  const cropOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of declarations ?? []) {
      if (!map.has(d.kultur_code)) map.set(d.kultur_code, d.kultur_name_de ?? d.kultur_code)
    }
    return [...map.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [declarations])

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

  function toggleSelectionMode() {
    setSelectionMode((v) => !v)
    setSelectedIds(new Set())
  }

  function toggleSelect(declarationId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(declarationId)) next.delete(declarationId)
      else next.add(declarationId)
      return next
    })
  }

  async function copySelectedToPlan() {
    const selected = filtered.filter((d) => selectedIds.has(d.id))
    if (selected.length === 0) return
    setCopying(true)
    try {
      for (const decl of selected) {
        await copyToPlan(decl)
      }
      setSelectedIds(new Set())
      setSelectionMode(false)
    } finally {
      setCopying(false)
    }
  }

  async function handlePlanCreated(geometry: string) {
    const farmId = farms?.[0]?.id
    if (!farmId) return
    const planId = await createPlanParcel({
      farm_id: farmId,
      jahr: year ?? new Date().getFullYear(),
      kultur_code: null,
      kultur_name_de: null,
      kultur_name_fr: null,
      sorte: null,
      flurname: null,
      area_a: null,
      geometry,
      notes: null,
    })
    setDetailsPlanId(planId)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Karte</h1>

      <div className="flex gap-2">
        {(['import', 'planung'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setLayerMode(m)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              layerMode === m ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            {m === 'import' ? 'Import (schreibgeschützt)' : 'Planung'}
          </button>
        ))}
      </div>

      {layerMode === 'import' && (
      <>
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
          <button
            type="button"
            onClick={toggleSelectionMode}
            className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-medium ${
              selectionMode ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-600'
            }`}
          >
            {selectionMode ? 'Auswahl beenden' : 'Parzellen auswählen'}
          </button>
        </div>
      )}

      {selectionMode && (
        <div className="flex items-center justify-between rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
          <span>{selectedIds.size} ausgewählt</span>
          <button
            type="button"
            onClick={copySelectedToPlan}
            disabled={selectedIds.size === 0 || copying}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {copying ? 'Kopiere…' : 'In Planungs-Layer kopieren'}
          </button>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <FieldMap
            declarations={filtered}
            farmNameById={farmNameById}
            focusLineageId={focusLineageId}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
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
      </>
      )}

      {layerMode === 'planung' && (
        <>
          <p className="text-xs text-gray-500">
            Zeichnen (Polygon-Symbol rechts oben), Stützpunkte verschieben oder löschen — jede Änderung
            legt automatisch eine neue Version an, siehe Versionsverlauf in den Details einer Parzelle.
          </p>
          <PlanningMap
            planParcels={planParcels ?? []}
            onCreated={handlePlanCreated}
            onEdited={(planId, geometry) => void saveNewVersion(planId, { geometry })}
            onDeleted={(planId) => void deletePlanParcel(planId)}
            onSelect={(planId) => setDetailsPlanId(planId)}
          />
        </>
      )}

      {detailsPlanId && (
        <Modal title="Planungsparzelle" onClose={() => setDetailsPlanId(null)}>
          <PlanParcelDetails
            planId={detailsPlanId}
            farms={farms ?? []}
            cropOptions={cropOptions}
            onClose={() => setDetailsPlanId(null)}
            onChanged={() => {}}
          />
        </Modal>
      )}
    </div>
  )
}
