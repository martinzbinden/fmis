import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { lineLengthM, type LngLat } from '@fmis/core/lv95'
import { BACKGROUND_LAYERS, type BackgroundKey } from '@fmis/core/swisstopo'
import { notifyError, notifySuccess } from '@fmis/core/toast'
import BauMap, { type MapLayers, type MapMode } from '../components/BauMap'
import ExportPanel from '../components/ExportPanel'
import ImportDialog from '../components/ImportDialog'
import NewObjectDialog, { type NewObjectSpec } from '../components/NewObjectDialog'
import ObjectsPanel from '../components/ObjectsPanel'
import ProjectForm from '../components/ProjectForm'
import SurveyPanel from '../components/SurveyPanel'
import { useQuery } from '../hooks/useQuery'
import { CATEGORIES, FEATURE_STATUS_LABEL, PROJECT_STATUS_LABEL } from '../lib/categories'
import { deleteProject, loadProject, saveFeature, updateGeometry } from '../lib/data'
import { boundsOf, fmtLength, lengthM, parseGeometry, type Geom } from '../lib/geometry'
import { groupOverlays, loadOverlays, removeOverlayGroup, uploadOverlayZip } from '../lib/overlays'
import { useGeolocation } from '../lib/useGeolocation'

type Tab = 'karte' | 'objekte' | 'einmessen' | 'export'

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'karte', icon: '🗺️', label: 'Karte' },
  { key: 'objekte', icon: '📋', label: 'Objekte' },
  { key: 'einmessen', icon: '📍', label: 'Einmessen' },
  { key: 'export', icon: '📤', label: 'Export' },
]

const LAYERS_KEY = 'bau_map_layers_v1'
// ein-/ausgeblendete Grundlagen je Ebene (sonst gilt die Vorgabe der Ebene)
const OVERLAYS_KEY = 'bau_overlays_v1'
const DEFAULT_LAYERS: MapLayers = { cadastre: false, cultures: false, labels: true, points: true, discarded: false, emphasize: true }

function loadLayers(): { background: BackgroundKey; layers: MapLayers } {
  try {
    const v = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') as { background?: BackgroundKey; layers?: Partial<MapLayers> } | null
    return {
      background: v?.background && v.background in BACKGROUND_LAYERS ? v.background : 'swissimage',
      layers: { ...DEFAULT_LAYERS, ...(v?.layers ?? {}) },
    }
  } catch {
    return { background: 'swissimage', layers: DEFAULT_LAYERS }
  }
}

const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches

const btn = 'grid min-h-12 min-w-12 place-items-center rounded-full bg-white text-xl shadow-md active:bg-gray-100'

/** Projektansicht in Vollbild: Karte, Objekte, Einmessen, Export — das Menü unten gehört nur dieser Aufgabe. */
export default function ProjectView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canWrite = useHasPermission('bau:projekte:write')
  const { data, loading } = useQuery((pg) => loadProject(pg, id!), [id])
  const project = data?.project ?? null
  const features = useMemo(() => data?.features ?? [], [data])
  const points = useMemo(() => data?.points ?? [], [data])

  const tab = (TABS.find((t) => t.key === params.get('t'))?.key ?? 'karte') as Tab
  const setTab = (t: Tab) => setParams({ t }, { replace: true })

  const initial = useMemo(loadLayers, [])
  const [background, setBackground] = useState<BackgroundKey>(initial.background)
  const [layers, setLayers] = useState<MapLayers>(initial.layers)
  const [layersOpen, setLayersOpen] = useState(false)
  const { data: overlayRows } = useQuery(loadOverlays, [])
  const overlayGroups = useMemo(() => groupOverlays(overlayRows ?? []), [overlayRows])
  const [overlayOn, setOverlayOn] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(OVERLAYS_KEY) ?? '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(OVERLAYS_KEY, JSON.stringify(overlayOn))
    } catch {
      // nur eine Bequemlichkeit
    }
  }, [overlayOn])
  const shownOverlays = useMemo(() => (overlayRows ?? []).filter((o) => overlayOn[o.id] ?? o.visible), [overlayRows, overlayOn])
  const [overlayBusy, setOverlayBusy] = useState(false)
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null)
  async function addOverlay(file: File) {
    setOverlayBusy(true)
    try {
      const n = await uploadOverlayZip(file)
      notifySuccess(`Grundlage mit ${n} ${n === 1 ? 'Ebene' : 'Ebenen'} hinzugefügt.`)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setOverlayBusy(false)
    }
  }
  useEffect(() => {
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify({ background, layers }))
    } catch {
      // nur eine Bequemlichkeit
    }
  }, [background, layers])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [surveyTarget, setSurveyTarget] = useState<string | null>(null)
  const [exportSel, setExportSel] = useState<Set<string>>(new Set())
  const selected = features.find((f) => f.id === selectedId) ?? null

  // Zeichnen / Bearbeiten
  const [mode, setMode] = useState<MapMode>('view')
  const [draft, setDraft] = useState<LngLat[]>([])
  const [draftType, setDraftType] = useState<Geom['type']>('LineString')
  // frühere Stände des Entwurfs für «Rückgängig» (Zeichnen und Bearbeiten)
  const [undo, setUndo] = useState<LngLat[][]>([])
  const [draftTarget, setDraftTarget] = useState<{ kind: 'new'; spec: NewObjectSpec } | { kind: 'edit'; id: string } | null>(null)
  const [measure, setMeasure] = useState<LngLat[]>([])
  const cursor = useRef<LngLat | null>(null)
  const touch = isTouch()

  const [dialog, setDialog] = useState<null | 'project' | 'new' | 'import'>(null)
  const [locating, setLocating] = useState(false)
  const { fix, error: gpsError } = useGeolocation(tab === 'einmessen' || locating)
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; n: number } | null>(null)
  const flyN = useRef(0)
  const fly = (lat: number, lng: number, zoom?: number) => setFlyTo({ lat, lng, zoom, n: ++flyN.current })

  const flownToFix = useRef(false)
  useEffect(() => {
    if (fix && locating && !flownToFix.current) {
      flownToFix.current = true
      fly(fix.lat, fix.lng, 19)
    }
    if (!locating) flownToFix.current = false
  }, [fix, locating])

  useEffect(() => {
    if (!surveyTarget && selectedId) setSurveyTarget(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  function select(fid: string | null, flyThere = false) {
    setSelectedId(fid)
    if (fid) setSurveyTarget(fid)
    const f = features.find((x) => x.id === fid)
    const g = f && parseGeometry(f.geometry)
    if (flyThere && g) {
      const b = boundsOf([g])!
      fly((b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, g.type === 'Point' ? 19 : 18)
    }
  }

  function startDraw(spec: NewObjectSpec) {
    setDialog(null)
    setDraftTarget({ kind: 'new', spec })
    setDraftType(spec.type)
    setDraft([])
    setUndo([])
    setSelectedId(null)
    setMode('draw')
    setTab('karte')
  }

  function startEdit() {
    if (!selected) return
    const g = parseGeometry(selected.geometry)
    if (!g) return notifyError('Dieses Objekt hat noch keine Geometrie — mit «+ Zeichnen» neu zeichnen.')
    setDraftTarget({ kind: 'edit', id: selected.id })
    setDraftType(g.type)
    setDraft(g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0].slice(0, -1))
    setUndo([])
    setMode('edit')
    setTab('karte')
  }

  function cancelDraft() {
    setMode('view')
    setDraft([])
    setUndo([])
    setDraftTarget(null)
  }

  function changeDraft(next: LngLat[]) {
    setUndo((u) => [...u, draft])
    setDraft(next)
  }

  function undoDraft() {
    if (!undo.length) return
    setDraft(undo[undo.length - 1])
    setUndo((u) => u.slice(0, -1))
  }

  const minPts = draftType === 'Point' ? 1 : draftType === 'LineString' ? 2 : 3
  const draftGeom = (): Geom => (draftType === 'Point' ? { type: 'Point', coordinates: draft[0] } : draftType === 'LineString' ? { type: 'LineString', coordinates: draft } : { type: 'Polygon', coordinates: [[...draft, draft[0]]] })

  async function finishDraft() {
    if (!project || !draftTarget || draft.length < minPts) return
    const g = draftGeom()
    try {
      if (draftTarget.kind === 'new') {
        const sort = features.reduce((m, f) => Math.max(m, f.sort_order), 0) + 1
        const newId = await saveFeature(project.id, { category: draftTarget.spec.category, status: 'geplant', label: draftTarget.spec.label, geometry: g }, undefined, sort)
        notifySuccess('Objekt gespeichert.')
        setSelectedId(newId)
        setSurveyTarget(newId) // das frisch gezeichnete Objekt ist das Ziel beim Einmessen
      } else {
        const f = features.find((x) => x.id === draftTarget.id)
        if (f) await updateGeometry(f, g)
        notifySuccess('Geometrie gespeichert.')
      }
      cancelDraft()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  function placeHere() {
    const c = cursor.current
    if (!c) return
    if (mode === 'measure') setMeasure((m) => [...m, c])
    else if (mode === 'draw') changeDraft(draftType === 'Point' ? [c] : [...draft, c])
  }

  // Ändert sich der Schlüssel, zoomt die Karte auf das ganze Projekt (beim Laden und per Knopf)
  const [fitN, setFitN] = useState(0)
  const hasGeometry = features.some((f) => parseGeometry(f.geometry)) || points.length > 0
  const fitKey = `${project?.id ?? ''}:${features.length === 0 ? 0 : 1}:${fitN}`

  if (loading && !data) return <div className="fixed inset-0 z-[1900] grid place-items-center bg-gray-100 text-gray-600">Lädt …</div>
  if (!project)
    return (
      <div className="fixed inset-0 z-[1900] grid place-items-center bg-gray-100 p-6 text-center">
        <div>
          <p className="mb-3 text-gray-700">Dieses Projekt gibt es nicht (mehr).</p>
          <button type="button" onClick={() => navigate('/bau')} className="min-h-12 rounded-lg bg-brand-600 px-5 text-white">
            Zur Projektliste
          </button>
        </div>
      </div>
    )

  const sheet = tab !== 'karte' && mode === 'view'
  const drawing = mode === 'draw' || mode === 'edit'
  const measuring = mode === 'measure'

  return (
    <div data-module="bau" className="fixed inset-0 z-[1900] flex flex-col overflow-hidden bg-gray-100 text-gray-900">
      <header className="flex items-center gap-1 border-b bg-white px-1 pt-[env(safe-area-inset-top,0px)]">
        <button type="button" onClick={() => navigate('/bau')} className="grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100" aria-label="Zur Projektliste">
          ←
        </button>
        <div className="min-w-0 flex-1 py-1">
          <div className="truncate text-sm font-bold text-gray-900">{project.name}</div>
          <div className="truncate text-xs text-gray-600">
            {PROJECT_STATUS_LABEL[project.status]}
            {project.contractor ? ` · ${project.contractor}` : ''}
            {features.length ? ` · ${features.length} Objekte` : ''}
          </div>
        </div>
        {canWrite && (
          <button type="button" onClick={() => setDialog('project')} className="grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100" aria-label="Projekt bearbeiten">
            ⚙️
          </button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <BauMap
          features={features}
          points={points}
          selectedId={selectedId}
          onSelect={(fid) => select(fid)}
          mode={mode}
          draft={draft}
          onDraftChange={changeDraft}
          draftType={draftType}
          background={background}
          layers={layers}
          overlays={shownOverlays}
          emphasizeOverlays={layers.emphasize}
          position={fix}
          fitKey={fitKey}
          flyTo={flyTo}
          measure={measure}
          onMeasure={setMeasure}
          onCursor={(c) => (cursor.current = c)}
        />

        {/* schwebende Werkzeuge */}
        <div className="absolute right-2 top-2 z-[700] flex flex-col gap-2">
          {mode === 'view' && (
            <>
              <button type="button" className={btn} onClick={() => setLayersOpen((o) => !o)} aria-label="Kartenebenen" aria-expanded={layersOpen}>
                🗂️
              </button>
              <button
                type="button"
                className={`${btn} ${locating ? 'ring-2 ring-blue-500' : ''}`}
                onClick={() => setLocating((l) => !l)}
                aria-label="Mein Standort"
                aria-pressed={locating}
              >
                🎯
              </button>
            </>
          )}
          {/* in jedem Modus erreichbar, auch beim Zeichnen und Messen */}
          <button type="button" className={`${btn} disabled:opacity-40`} onClick={() => setFitN((n) => n + 1)} disabled={!hasGeometry} aria-label="Zoom auf Projekt" title="Zoom auf Projekt">
            🔍
          </button>
          {mode === 'view' && (
            <>
              <button type="button" className={btn} onClick={() => { setMeasure([]); setMode('measure') }} aria-label="Distanz messen">
                📏
              </button>
              {canWrite && (
                <button type="button" className={`${btn} bg-brand-600 text-white`} onClick={() => setDialog('new')} aria-label="Objekt zeichnen">
                  ✏️
                </button>
              )}
            </>
          )}
        </div>

        {layersOpen && mode === 'view' && (
          <div className="absolute right-16 top-2 z-[700] max-h-[calc(100%-1rem)] w-64 space-y-2 overflow-y-auto rounded-xl bg-white p-3 text-sm shadow-lg">
            <div className="grid grid-cols-3 gap-1">
              {(Object.keys(BACKGROUND_LAYERS) as BackgroundKey[]).map((k) => (
                <button key={k} type="button" onClick={() => setBackground(k)} className={`min-h-12 rounded-lg border px-1 text-[12px] leading-tight ${background === k ? 'border-brand-600 bg-brand-100 font-semibold' : 'border-gray-300'}`}>
                  {BACKGROUND_LAYERS[k].label}
                </button>
              ))}
            </div>
            {(
              [
                ['cadastre', 'Parzellen (amtliche Vermessung)'],
                ['cultures', 'Kulturflächen (Modul Kulturen)'],
                ['labels', 'Beschriftungen'],
                ['points', 'Messpunkte'],
                ['discarded', 'Verworfene Objekte'],
              ] as [keyof MapLayers, string][]
            ).map(([k, label]) => (
              <label key={k} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" className="h-5 w-5" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
            {overlayGroups.map((g) => (
              <div key={g.id} className="space-y-1 border-t pt-2">
                <div className="text-xs font-semibold text-gray-700">{g.name}</div>
                {g.layers.map((o) => (
                  <label key={o.id} className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" className="h-5 w-5" checked={overlayOn[o.id] ?? o.visible} onChange={(e) => setOverlayOn((v) => ({ ...v, [o.id]: e.target.checked }))} />
                    <span className="h-1.5 w-5 rounded-full" style={{ background: o.color ?? '#6b7280' }} aria-hidden />
                    {o.name}
                  </label>
                ))}
                <label className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={layers.emphasize} onChange={(e) => setLayers((l) => ({ ...l, emphasize: e.target.checked }))} />
                  Linien hervorheben
                </label>
                <p className="text-[11px] leading-snug text-gray-500">{g.source ?? 'Nur Anzeige.'} Nicht bearbeitbar, Lage nicht verbindlich: vor dem Graben beim Werk nachfragen.</p>
                {canWrite &&
                  (confirmGroup === g.id ? (
                    <button type="button" className="rounded bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void removeOverlayGroup(g.layers).then(() => setConfirmGroup(null))}>
                      Wirklich entfernen?
                    </button>
                  ) : (
                    <button type="button" className="text-xs text-red-700 underline" onClick={() => setConfirmGroup(g.id)}>
                      Grundlage entfernen
                    </button>
                  ))}
              </div>
            ))}
            {canWrite && (
              <label className={`flex min-h-11 cursor-pointer items-center gap-2 border-t pt-2 text-sm text-brand-700 ${overlayBusy ? 'opacity-50' : ''}`}>
                ＋ Grundlage hinzufügen (ZIP)
                <input type="file" accept=".zip,application/zip" className="sr-only" disabled={overlayBusy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addOverlay(f) }} />
              </label>
            )}
          </div>
        )}

        {/* Ausgewähltes Objekt (Karte) */}
        {mode === 'view' && tab === 'karte' && selected && (
          <div className="absolute inset-x-2 bottom-2 z-[700] rounded-xl bg-white p-3 shadow-lg">
            <div className="flex items-start gap-2">
              <span className="text-xl" aria-hidden>
                {CATEGORIES[selected.category].icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{selected.label ?? CATEGORIES[selected.category].label}</div>
                <div className="text-xs text-gray-600">
                  {CATEGORIES[selected.category].label} · {FEATURE_STATUS_LABEL[selected.status]}
                  {lengthM(parseGeometry(selected.geometry)) != null ? ` · ${fmtLength(lengthM(parseGeometry(selected.geometry)))}` : ''}
                  {selected.diameter_mm ? ` · Ø ${selected.diameter_mm} mm` : ''}
                </div>
              </div>
              <button type="button" className="grid min-h-12 min-w-12 place-items-center text-xl text-gray-500" onClick={() => select(null)} aria-label="Auswahl aufheben">
                ×
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm" onClick={() => setTab('objekte')}>
                Details
              </button>
              {canWrite && (
                <>
                  <button type="button" className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm" onClick={startEdit}>
                    ✏️ Stützpunkte
                  </button>
                  <button type="button" className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm" onClick={() => setTab('einmessen')}>
                    📍 Einmessen
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Zeichnen / Bearbeiten */}
        {drawing && (
          <div className="absolute inset-x-2 bottom-2 z-[700] space-y-2 rounded-xl bg-white p-3 shadow-lg">
            <div className="text-sm text-gray-800">
              {mode === 'edit'
                ? draftType === 'Point'
                  ? 'Punkt an den richtigen Ort ziehen.'
                  : touch
                    ? 'Punkt ziehen = verschieben · Punkt antippen = löschen · kleinen Kreis ziehen oder antippen = neuer Punkt.'
                    : 'Punkt ziehen = verschieben · Punkt anklicken = löschen · auf der Linie ziehen = neuer Punkt.'
                : touch ? 'Karte verschieben, bis das Fadenkreuz am richtigen Ort steht, dann «Hier setzen».' : 'In die Karte klicken, um Punkte zu setzen.'}{' '}
              <b>
                {draftType === 'Point' ? (draft.length ? '1 Punkt' : 'noch kein Punkt') : `${draft.length} Punkte`}
                {draftType !== 'Point' && draft.length > 1 ? ` · ${fmtLength(lineLengthM(draftType === 'Polygon' ? [...draft, draft[0]] : draft))}` : ''}
              </b>
            </div>
            <div className="flex flex-wrap gap-2">
              {mode === 'draw' && touch && (
                <button type="button" className="min-h-12 flex-1 rounded-lg bg-brand-600 px-3 text-base font-bold text-white" onClick={placeHere}>
                  ＋ Hier setzen
                </button>
              )}
              {(mode === 'draw' || draftType !== 'Point') && (
                <button type="button" className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-40" disabled={undo.length === 0} onClick={undoDraft}>
                  ↶ Rückgängig
                </button>
              )}
              <button type="button" className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm" onClick={cancelDraft}>
                Abbrechen
              </button>
              <button type="button" className="min-h-12 rounded-lg bg-green-700 px-4 text-sm font-bold text-white disabled:opacity-40" disabled={draft.length < minPts} onClick={() => void finishDraft()}>
                ✓ Fertig
              </button>
            </div>
          </div>
        )}

        {/* Distanz messen */}
        {measuring && (
          <div className="absolute inset-x-2 bottom-2 z-[700] space-y-2 rounded-xl bg-white p-3 shadow-lg">
            <div className="text-sm text-gray-800">
              {touch ? 'Fadenkreuz platzieren, dann «Hier messen».' : 'In die Karte klicken, um Punkte zu setzen.'}{' '}
              <b>{measure.length > 1 ? fmtLength(lineLengthM(measure)) : 'mindestens 2 Punkte'}</b>
            </div>
            <div className="flex flex-wrap gap-2">
              {touch && (
                <button type="button" className="min-h-12 flex-1 rounded-lg bg-brand-600 px-3 text-base font-bold text-white" onClick={placeHere}>
                  ＋ Hier messen
                </button>
              )}
              <button type="button" className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm" onClick={() => setMeasure((m) => m.slice(0, -1))} disabled={!measure.length}>
                ↶ Rückgängig
              </button>
              <button type="button" className="min-h-12 rounded-lg bg-gray-800 px-4 text-sm font-bold text-white" onClick={() => { setMode('view'); setMeasure([]) }}>
                Fertig
              </button>
            </div>
          </div>
        )}

        {/* Aufgaben-Blatt (Objekte, Einmessen, Export) */}
        {sheet && (
          <div className="absolute inset-x-0 bottom-0 z-[700] max-h-[58%] overflow-y-auto rounded-t-2xl bg-white p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.25)]">
            {tab === 'objekte' && (
              <ObjectsPanel
                features={features}
                points={points}
                selectedId={selectedId}
                onSelect={(fid) => select(fid, true)}
                exportSel={exportSel}
                onExportSel={setExportSel}
                canWrite={canWrite}
                onNew={() => setDialog('new')}
                onImport={() => setDialog('import')}
                onEditGeometry={startEdit}
                onSurvey={() => setTab('einmessen')}
              />
            )}
            {tab === 'einmessen' && (
              <SurveyPanel projectId={project.id} features={features} points={points} targetId={surveyTarget} onTarget={setSurveyTarget} fix={fix} gpsError={gpsError} canWrite={canWrite} />
            )}
            {tab === 'export' && <ExportPanel project={project} features={features} points={points} exportSel={exportSel} />}
          </div>
        )}
      </div>

      <nav className="grid grid-cols-4 border-t bg-white pb-[env(safe-area-inset-bottom,0px)]" aria-label="Projektaufgaben">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={drawing || measuring}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs disabled:opacity-40 ${tab === t.key ? 'font-semibold text-brand-700' : 'text-gray-600'}`}
          >
            <span className="text-xl leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {dialog === 'project' && (
        <ProjectForm
          project={project}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
          onDelete={async () => {
            if (!confirm(`Projekt «${project.name}» mit ${features.length} Objekt(en) und ${points.length} Messpunkt(en) löschen?`)) return
            await deleteProject(project, features, points)
            navigate('/bau')
          }}
        />
      )}
      {dialog === 'new' && <NewObjectDialog onClose={() => setDialog(null)} onStart={startDraw} />}
      {dialog === 'import' && <ImportDialog projectId={project.id} existing={features} onClose={() => setDialog(null)} />}
    </div>
  )
}

