import { useEffect, useState } from 'react'
import NumberInput from '@fmis/core/NumberInput'
import { notifyError, notifySuccess } from '@fmis/core/toast'
import { loadFieldsBackground } from '@fmis/wiesenjournal/lib/fieldsBackground'
import { useQuery } from '../hooks/useQuery'
import { culturesInArea, DEFAULT_BUFFER_M, exportArea, WMS_LAYERS, type Area, type WmsKey } from '../lib/basemapExport'
import { BASEMAP_KINDS, buildExport, downloadFile, EXPORT_LABEL, selectForExport, type ExportKind } from '../lib/exports'
import { todayIso } from '../lib/format'
import { groupOverlays, loadOverlays } from '../lib/overlays'
import type { BauFeature, Project, SurveyPoint } from '../types'

const KINDS: ExportKind[] = ['kmz', 'dxf', 'geojson', 'gpx', 'csv', 'kml']

/** Export eines Projekts: alle Objekte oder nur die ausgewählten, in mehreren Formaten. */
export default function ExportPanel({
  project,
  features,
  points,
  exportSel,
  onArea,
}: {
  project: Project
  features: BauFeature[]
  points: SurveyPoint[]
  exportSel: Set<string>
  /** Gebiet der Grundlagen (für die Anzeige auf der Karte); null = keine Grundlagen gewählt */
  onArea?: (a: Area | null) => void
}) {
  const [scope, setScope] = useState<'alle' | 'auswahl'>(exportSel.size ? 'auswahl' : 'alle')
  const [discarded, setDiscarded] = useState(false)
  const [statusLayers, setStatusLayers] = useState(false)
  const [busy, setBusy] = useState<ExportKind | null>(null)

  const input = {
    projectName: project.name,
    features,
    points,
    selectedIds: scope === 'auswahl' ? exportSel : null,
    date: todayIso(),
    dxfStatusLayers: statusLayers,
    includeDiscarded: discarded,
  }
  const sel = selectForExport(input)

  // Grundlagen: Leitungskataster, Parzellen, Luftbild, Kulturflächen im Gebiet Perimeter + Puffer
  const { data: overlays } = useQuery(loadOverlays, [])
  const groups = groupOverlays(overlays ?? [])
  const [ovSel, setOvSel] = useState<Set<string>>(new Set())
  const [wmsSel, setWmsSel] = useState<Set<WmsKey>>(new Set())
  const [cultures, setCultures] = useState(false)
  const [buffer, setBuffer] = useState(String(DEFAULT_BUFFER_M))
  const rasters = ovSel.size + wmsSel.size > 0
  const anyBasemap = rasters || cultures
  const area = anyBasemap ? exportArea(sel.features, sel.points, Number(buffer.replace(',', '.')) || 0) : null
  const areaKey = area ? `${area.e0},${area.n0},${area.e1},${area.n1}` : ''
  useEffect(() => {
    onArea?.(area)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey])
  useEffect(() => () => onArea?.(null), [onArea])
  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const n = new Set(set)
    if (on) n.add(v)
    else n.delete(v)
    return n
  }

  async function run(kind: ExportKind) {
    setBusy(kind)
    try {
      const basemaps =
        area && anyBasemap && BASEMAP_KINDS.has(kind)
          ? {
              area,
              choice: { overlays: (overlays ?? []).filter((o) => ovSel.has(o.id)), wms: [...wmsSel] },
              cultures: cultures ? culturesInArea(await loadFieldsBackground(), area) : [],
            }
          : undefined
      const file = await buildExport(kind, { ...input, basemaps })
      downloadFile(file)
      notifySuccess(`${file.name} erstellt`)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const chip = (on: boolean) => `min-h-12 flex-1 rounded-lg border px-3 text-sm ${on ? 'border-brand-600 bg-brand-100 font-semibold text-brand-800' : 'border-gray-300 text-gray-700'}`
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" className={chip(scope === 'alle')} onClick={() => setScope('alle')}>
          Alle Objekte
        </button>
        <button type="button" className={`${chip(scope === 'auswahl')} disabled:opacity-40`} disabled={exportSel.size === 0} onClick={() => setScope('auswahl')}>
          Nur ausgewählte ({exportSel.size})
        </button>
      </div>
      <p className="text-xs text-gray-600">
        {sel.features.length} Objekt{sel.features.length === 1 ? '' : 'e'}, {sel.points.length} Messpunkt{sel.points.length === 1 ? '' : 'e'}.
        {exportSel.size === 0 && ' Objekte für einen Teil-Export in der Liste «Objekte» ankreuzen.'}
      </p>
      <label className="flex min-h-12 items-center gap-3 text-sm text-gray-800">
        <input type="checkbox" className="h-5 w-5" checked={discarded} onChange={(e) => setDiscarded(e.target.checked)} />
        Verworfene Objekte einbeziehen
      </label>
      <label className="flex min-h-12 items-center gap-3 text-sm text-gray-800">
        <input type="checkbox" className="h-5 w-5" checked={statusLayers} onChange={(e) => setStatusLayers(e.target.checked)} />
        DXF: zusätzlich ein Layer je Status (z.B. GUELLE_EINGEMESSEN)
      </label>
      <details className="rounded-lg border p-2 text-sm" open={anyBasemap}>
        <summary className="min-h-10 cursor-pointer font-semibold text-gray-800">Grundlagen mitexportieren{anyBasemap ? ` (${ovSel.size + wmsSel.size + (cultures ? 1 : 0)})` : ''}</summary>
        <div className="mt-1 space-y-1">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="text-xs font-medium text-gray-600">{g.name}</div>
              {g.layers.map((o) => (
                <label key={o.id} className="flex min-h-10 items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={ovSel.has(o.id)} onChange={(e) => setOvSel(toggle(ovSel, o.id, e.target.checked))} />
                  <span className="h-1.5 w-5 rounded-full" style={{ background: o.color ?? '#6b7280' }} aria-hidden />
                  {o.name}
                </label>
              ))}
            </div>
          ))}
          <div className="text-xs font-medium text-gray-600">swisstopo (braucht Internet)</div>
          {(Object.keys(WMS_LAYERS) as WmsKey[]).map((k) => (
            <label key={k} className="flex min-h-10 items-center gap-3">
              <input type="checkbox" className="h-5 w-5" checked={wmsSel.has(k)} onChange={(e) => setWmsSel(toggle(wmsSel, k, e.target.checked))} />
              {WMS_LAYERS[k].name}
            </label>
          ))}
          <label className="flex min-h-10 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={cultures} onChange={(e) => setCultures(e.target.checked)} />
            Kulturflächen (Modul Kulturen, als Linien)
          </label>
          <label className="flex flex-wrap items-center gap-2 pt-1">
            Gebiet: Objekte + Puffer
            <NumberInput className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-base" value={buffer} onChange={(e) => setBuffer(e.target.value)} aria-label="Puffer in Metern" />
            m
          </label>
          {area && (
            <p className="text-xs text-gray-600">
              {area.e1 - area.e0} × {area.n1 - area.n0} m, auf der Karte gestrichelt. Bilder: KMZ als Overlay, DXF/GeoJSON als ZIP mit LV95-Bildern (Worldfile). KML nur Kulturflächen, GPX/CSV ohne
              Grundlagen.
            </p>
          )}
        </div>
      </details>
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy != null || (sel.features.length === 0 && k !== 'csv') || (k === 'csv' && sel.points.length === 0)}
            onClick={() => void run(k)}
            className="min-h-14 rounded-xl border border-gray-300 bg-white px-3 text-left shadow-sm active:bg-gray-100 disabled:opacity-40"
          >
            <div className="text-base font-bold text-gray-900">{busy === k ? 'Erstellt …' : EXPORT_LABEL[k].label}</div>
            <div className="text-[11px] leading-tight text-gray-600">{EXPORT_LABEL[k].hint}</div>
            {anyBasemap && (
              <div className="text-[11px] font-medium leading-tight text-brand-700">
                {k === 'kmz' ? '+ Grundlagen' : k === 'kml' ? (cultures ? '+ Kulturflächen (ohne Bilder)' : 'ohne Bilder') : k === 'dxf' || k === 'geojson' ? (rasters ? '+ Grundlagen, als ZIP' : '+ Kulturflächen') : 'ohne Grundlagen'}
              </div>
            )}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-600">
        Koordinaten: KML/GPX/GeoJSON in WGS84, DXF und CSV in LV95 (EPSG:2056, Meter). Umrechnung mit etwa ±1 m Genauigkeit — für die amtliche Vermessung ist das Verfahren der swisstopo (REFRAME) nötig.
      </p>
    </div>
  )
}
