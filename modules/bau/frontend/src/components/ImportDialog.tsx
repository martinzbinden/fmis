import { useState } from 'react'
import JSZip from 'jszip'
import AsyncButton from '@fmis/core/AsyncButton'
import { notifyError, notifySuccess } from '@fmis/core/toast'
import Modal from './Modal'
import { CATEGORIES, CATEGORY_ORDER } from '../lib/categories'
import { importFeatures } from '../lib/data'
import { parseGeoJson } from '../lib/geojson'
import { fmtLength, lengthM } from '../lib/geometry'
import { planImport } from '../lib/importPlan'
import { parseKml, type ImportedFeature } from '../lib/kml'
import type { BauFeature, FeatureCategory } from '../types'

const TYPE_LABEL = { LineString: 'Linie', Point: 'Punkt', Polygon: 'Fläche' } as const

/** KML/KMZ/GeoJSON einlesen: zeigt vorher, was neu ist und was schon im Projekt liegt (nichts wird ersetzt oder gelöscht). */
export default function ImportDialog({ projectId, existing, onClose }: { projectId: string; existing: BauFeature[]; onClose: () => void }) {
  const [items, setItems] = useState<ImportedFeature[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [cats, setCats] = useState<Record<number, FeatureCategory>>({})

  async function pick(file: File) {
    setFileName(file.name)
    try {
      let text: string
      if (/\.kmz$/i.test(file.name)) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer())
        const kml = Object.values(zip.files).find((f) => /\.kml$/i.test(f.name))
        if (!kml) throw new Error('Die KMZ-Datei enthält keine KML.')
        text = await kml.async('string')
      } else text = await file.text()
      const parsed = /\.(geo)?json$/i.test(file.name) ? parseGeoJson(text) : parseKml(text)
      if (!parsed.length) throw new Error('In der Datei wurden keine Linien, Punkte oder Flächen gefunden.')
      setItems(parsed)
      setCats({})
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  const plan = items ? planImport(existing, items) : null
  const catOf = (f: ImportedFeature) => cats[items!.indexOf(f)] ?? f.category

  async function run() {
    if (!plan) return
    const withCats = plan.toAdd.map((f) => ({ ...f, category: catOf(f) }))
    const r = await importFeatures(projectId, existing, withCats)
    notifySuccess(`${r.added} Objekt${r.added === 1 ? '' : 'e'} importiert${r.skipped ? `, ${r.skipped} schon vorhanden` : ''}.`)
    onClose()
  }

  return (
    <Modal title="KML / GeoJSON importieren" onClose={onClose}>
      <div className="space-y-3">
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-3 text-center text-sm text-gray-700">
          {fileName || 'Datei wählen (.kml, .kmz, .geojson)'}
          <input type="file" accept=".kml,.kmz,.geojson,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
        </label>
        {plan && (
          <>
            <p className="text-sm text-gray-700">
              <b>{plan.toAdd.length}</b> neu{plan.skipped.length > 0 && <>, <b>{plan.skipped.length}</b> schon vorhanden (werden übersprungen)</>}. Bestehendes wird nie ersetzt oder gelöscht.
            </p>
            <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-lg border text-sm">
              {plan.toAdd.map((f) => (
                <li key={items!.indexOf(f)} className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-800">{f.label}</div>
                    <div className="text-xs text-gray-600">
                      {TYPE_LABEL[f.geometry.type]}
                      {f.geometry.type !== 'Point' && lengthM(f.geometry) != null ? ` · ${fmtLength(lengthM(f.geometry))}` : ''}
                    </div>
                  </div>
                  <select
                    className="min-h-11 rounded border border-gray-300 px-2 text-sm"
                    value={catOf(f)}
                    onChange={(e) => setCats((c) => ({ ...c, [items!.indexOf(f)]: e.target.value as FeatureCategory }))}
                  >
                    {CATEGORY_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORIES[c].label}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <AsyncButton
              onClick={run}
              disabled={plan.toAdd.length === 0}
              busyLabel="Importiert…"
              doneLabel="✓ importiert"
              className="min-h-12 w-full rounded-lg bg-brand-600 text-base font-medium text-white disabled:opacity-50"
            >
              {plan.toAdd.length} Objekt{plan.toAdd.length === 1 ? '' : 'e'} importieren
            </AsyncButton>
          </>
        )}
      </div>
    </Modal>
  )
}
