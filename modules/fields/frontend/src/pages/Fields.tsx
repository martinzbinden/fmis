import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { importFieldsZips, type ImportSummary } from '../lib/importFields'
import {
  copyToPlan,
  createPlanParcel,
  saveNewVersion,
  deletePlanParcel,
  createLayer,
  deleteLayer,
  copyYearAsLayer,
} from '../lib/planLayer'
import FieldMap from '../components/FieldMap'
import PlanningMap from '../components/PlanningMap'
import PlanAttributeTable from '../components/PlanAttributeTable'
import Modal from '../components/Modal'
import PlanParcelDetails from '../components/PlanParcelDetails'
import { fmtArea, num } from '../lib/format'
import { colorForKultur } from '../lib/kulturColor'
import type { Farm, FieldDeclaration, PlanLayer, PlanParcel } from '../types'

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

async function loadPlanLayers(pg: PGlite): Promise<PlanLayer[]> {
  const { rows } = await pg.query<PlanLayer>(
    `select * from plan_layers where deleted_at is null order by updated_at desc`,
  )
  return rows
}

async function loadPlanParcels(pg: PGlite, layerId: string | null): Promise<PlanParcel[]> {
  if (!layerId) return []
  const { rows } = await pg.query<PlanParcel>(
    `select * from v_plan_parcels_current where layer_id = $1 order by flurname nulls last`,
    [layerId],
  )
  return rows.map((r) => ({ ...r, area_a: num(r.area_a) }))
}

export default function Fields() {
  const location = useLocation()
  const { data: farms } = useQuery(loadFarms)
  const { data: declarations, refresh } = useQuery(loadDeclarations)
  const { data: planLayers, refresh: refreshPlanLayers } = useQuery(loadPlanLayers)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importing, setImporting] = useState(false)
  const [year, setYear] = useState<number | null>(null)
  const [focusLineageId, setFocusLineageId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)
  const [layerMode, setLayerMode] = useState<'import' | 'planung'>('import')
  const [detailsPlanId, setDetailsPlanId] = useState<string | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [showNewLayerForm, setShowNewLayerForm] = useState(false)
  const [focusPlanId, setFocusPlanId] = useState<string | null>(null)
  const [planSelectionMode, setPlanSelectionMode] = useState(false)
  const [planSelectedIds, setPlanSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkEditForm, setShowBulkEditForm] = useState(false)

  const { data: planParcels, refresh: refreshPlanParcels } = useQuery(
    (pg) => loadPlanParcels(pg, selectedLayerId),
    [selectedLayerId],
  )

  // Ersten verfügbaren Layer automatisch wählen (Muster wie beim Jahr
  // unten) — verwaist die Auswahl, falls der aktuelle Layer gelöscht wurde.
  useEffect(() => {
    if (!planLayers) return
    if (selectedLayerId != null && planLayers.some((l) => l.id === selectedLayerId)) return
    setSelectedLayerId(planLayers[0]?.id ?? null)
  }, [planLayers, selectedLayerId])

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
    if (selected.length === 0 || !selectedLayerId) return
    setCopying(true)
    try {
      for (const decl of selected) {
        await copyToPlan(decl, selectedLayerId)
      }
      setSelectedIds(new Set())
      setSelectionMode(false)
    } finally {
      setCopying(false)
    }
  }

  async function handlePlanCreated(geometry: string) {
    const farmId = farms?.[0]?.id
    if (!farmId || !selectedLayerId) return
    const planId = await createPlanParcel(
      {
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
      },
      selectedLayerId,
    )
    setDetailsPlanId(planId)
  }

  function togglePlanSelectionMode() {
    setPlanSelectionMode((v) => !v)
    setPlanSelectedIds(new Set())
  }

  function togglePlanSelect(planId: string) {
    setPlanSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(planId)) next.delete(planId)
      else next.add(planId)
      return next
    })
  }

  async function bulkDeleteSelectedPlan() {
    for (const planId of planSelectedIds) {
      await deletePlanParcel(planId)
    }
    setPlanSelectedIds(new Set())
    setPlanSelectionMode(false)
  }

  async function handleLayerDeleted() {
    if (!selectedLayerId) return
    if (!window.confirm('Diesen Planungslayer löschen? Die Parzellen bleiben in der Historie erhalten.')) return
    await deleteLayer(selectedLayerId)
    setSelectedLayerId(null)
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-gray-600" htmlFor="layer">
              Layer
            </label>
            <select
              id="layer"
              value={selectedLayerId ?? ''}
              onChange={(e) => setSelectedLayerId(e.target.value || null)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {(planLayers ?? []).length === 0 && <option value="">Kein Layer</option>}
              {(planLayers ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewLayerForm((v) => !v)}
              className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
            >
              + Neuer Layer
            </button>
            {selectedLayerId && (
              <button
                type="button"
                onClick={handleLayerDeleted}
                title="Layer löschen"
                className="rounded-lg border border-red-300 px-2 py-1.5 text-sm text-red-700"
              >
                🗑
              </button>
            )}
            {selectedLayerId && (planParcels?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={togglePlanSelectionMode}
                className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-medium ${
                  planSelectionMode ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-600'
                }`}
              >
                {planSelectionMode ? 'Auswahl beenden' : 'Parzellen auswählen'}
              </button>
            )}
          </div>

          {showNewLayerForm && (
            <NewLayerForm
              years={years}
              declarations={declarations ?? []}
              onCancel={() => setShowNewLayerForm(false)}
              onCreated={(layerId) => {
                setSelectedLayerId(layerId)
                setShowNewLayerForm(false)
                refreshPlanLayers()
              }}
            />
          )}

          {planSelectedIds.size > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
              <span>{planSelectedIds.size} ausgewählt</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowBulkEditForm(true)}
                  className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
                >
                  Bearbeiten
                </button>
                <button
                  type="button"
                  onClick={bulkDeleteSelectedPlan}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
                >
                  Löschen
                </button>
              </div>
            </div>
          )}

          {selectedLayerId ? (
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
                selectionMode={planSelectionMode}
                selectedIds={planSelectedIds}
                onToggleSelect={togglePlanSelect}
                focusPlanId={focusPlanId}
              />
              <PlanAttributeTable
                planParcels={planParcels ?? []}
                cropOptions={cropOptions}
                selectedIds={planSelectedIds}
                onToggleSelect={togglePlanSelect}
                onFocusMap={setFocusPlanId}
                onOpenDetails={setDetailsPlanId}
                onChanged={refreshPlanParcels}
              />
            </>
          ) : (
            <p className="text-center text-gray-500">Noch kein Planungslayer — "+ Neuer Layer" anlegen.</p>
          )}
        </>
      )}

      {detailsPlanId && (
        <Modal title="Planungsparzelle" onClose={() => setDetailsPlanId(null)}>
          <PlanParcelDetails
            planId={detailsPlanId}
            farms={farms ?? []}
            cropOptions={cropOptions}
            onClose={() => setDetailsPlanId(null)}
            onChanged={refreshPlanParcels}
          />
        </Modal>
      )}

      {showBulkEditForm && (
        <Modal title={`${planSelectedIds.size} Parzellen bearbeiten`} onClose={() => setShowBulkEditForm(false)}>
          <PlanBulkEditForm
            planIds={[...planSelectedIds]}
            cropOptions={cropOptions}
            onClose={() => setShowBulkEditForm(false)}
            onApplied={() => {
              setPlanSelectedIds(new Set())
              setPlanSelectionMode(false)
              setShowBulkEditForm(false)
              refreshPlanParcels()
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function NewLayerForm({
  years,
  declarations,
  onCreated,
  onCancel,
}: {
  years: number[]
  declarations: FieldDeclaration[]
  onCreated: (layerId: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'empty' | 'copyYear'>('empty')
  const [copyYear, setCopyYear] = useState(years[0] ?? new Date().getFullYear())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Bitte einen Namen angeben.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const layerId =
        mode === 'copyYear'
          ? await copyYearAsLayer(
              trimmed,
              declarations.filter((d) => d.jahr === copyYear),
            )
          : await createLayer(trimmed)
      onCreated(layerId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <label className="block text-sm">
        Name
        <input
          type="text"
          placeholder="z.B. Szenario Biodiversität 2027"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 p-2"
        />
      </label>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === 'empty'} onChange={() => setMode('empty')} />
          Leer beginnen
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={mode === 'copyYear'}
            onChange={() => setMode('copyYear')}
            disabled={years.length === 0}
          />
          Jahr als Ausgangslage kopieren
          {mode === 'copyYear' && (
            <select
              value={copyYear}
              onChange={(e) => setCopyYear(Number(e.target.value))}
              className="ml-1 rounded border border-gray-300 px-2 py-1"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Lege an…' : 'Anlegen'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-500">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

interface BulkChanges {
  kultur_code?: string | null
  kultur_name_de?: string | null
  jahr?: number
  sorte?: string | null
}

function PlanBulkEditForm({
  planIds,
  cropOptions,
  onClose,
  onApplied,
}: {
  planIds: string[]
  cropOptions: { code: string; name: string }[]
  onClose: () => void
  onApplied: () => void
}) {
  const [applyKultur, setApplyKultur] = useState(false)
  const [kulturCode, setKulturCode] = useState('')
  const [customName, setCustomName] = useState('')
  const [applyJahr, setApplyJahr] = useState(false)
  const [jahr, setJahr] = useState(String(new Date().getFullYear()))
  const [applySorte, setApplySorte] = useState(false)
  const [sorte, setSorte] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const changes: BulkChanges = {}
    if (applyKultur) {
      const isCustom = kulturCode === '__custom__'
      const code = isCustom ? customName.trim() : kulturCode
      const name = isCustom ? customName.trim() : cropOptions.find((o) => o.code === kulturCode)?.name
      if (!code) {
        setError('Bitte eine Kultur wählen oder eingeben.')
        return
      }
      changes.kultur_code = code
      changes.kultur_name_de = name ?? code
    }
    if (applyJahr) {
      const yearNum = Number(jahr)
      if (!Number.isInteger(yearNum)) {
        setError('Bitte ein gültiges Jahr angeben.')
        return
      }
      changes.jahr = yearNum
    }
    if (applySorte) {
      changes.sorte = sorte.trim() || null
    }
    if (Object.keys(changes).length === 0) {
      setError('Bitte mindestens ein Feld zum Ändern aktivieren.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const planId of planIds) {
        await saveNewVersion(planId, changes)
      }
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anwenden fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-gray-500">Wird auf {planIds.length} ausgewählte Parzellen angewendet.</p>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={applyKultur}
          onChange={(e) => setApplyKultur(e.target.checked)}
          className="mt-3"
        />
        <label className="flex-1 text-sm">
          Kultur
          <select
            value={kulturCode}
            onChange={(e) => setKulturCode(e.target.value)}
            disabled={!applyKultur}
            className="mt-1 w-full rounded border border-gray-300 p-2 disabled:bg-gray-100"
          >
            <option value="" disabled>
              Kultur wählen…
            </option>
            {cropOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
            <option value="__custom__">— eigene Eingabe —</option>
          </select>
          {applyKultur && kulturCode === '__custom__' && (
            <input
              type="text"
              placeholder="Kulturname"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
            />
          )}
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={applyJahr} onChange={(e) => setApplyJahr(e.target.checked)} />
        <label className="flex-1 text-sm">
          Jahr
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(e.target.value)}
            disabled={!applyJahr}
            className="mt-1 w-full rounded border border-gray-300 p-2 disabled:bg-gray-100"
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={applySorte} onChange={(e) => setApplySorte(e.target.checked)} />
        <label className="flex-1 text-sm">
          Sorte
          <input
            type="text"
            value={sorte}
            onChange={(e) => setSorte(e.target.value)}
            disabled={!applySorte}
            className="mt-1 w-full rounded border border-gray-300 p-2 disabled:bg-gray-100"
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Wende an…' : 'Übernehmen'}
        </button>
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500">
          Abbrechen
        </button>
      </div>
    </form>
  )
}
