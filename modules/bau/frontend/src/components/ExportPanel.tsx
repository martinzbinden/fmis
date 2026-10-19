import { useState } from 'react'
import { notifyError, notifySuccess } from '@fmis/core/toast'
import { buildExport, downloadFile, EXPORT_LABEL, selectForExport, type ExportKind } from '../lib/exports'
import { todayIso } from '../lib/format'
import type { BauFeature, Project, SurveyPoint } from '../types'

const KINDS: ExportKind[] = ['kmz', 'dxf', 'geojson', 'gpx', 'csv', 'kml']

/** Export eines Projekts: alle Objekte oder nur die ausgewählten, in mehreren Formaten. */
export default function ExportPanel({
  project,
  features,
  points,
  exportSel,
}: {
  project: Project
  features: BauFeature[]
  points: SurveyPoint[]
  exportSel: Set<string>
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

  async function run(kind: ExportKind) {
    setBusy(kind)
    try {
      const file = await buildExport(kind, input)
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
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-600">
        Koordinaten: KML/GPX/GeoJSON in WGS84, DXF und CSV in LV95 (EPSG:2056, Meter). Umrechnung mit etwa ±1 m Genauigkeit — für die amtliche Vermessung ist das Verfahren der swisstopo (REFRAME) nötig.
      </p>
    </div>
  )
}
