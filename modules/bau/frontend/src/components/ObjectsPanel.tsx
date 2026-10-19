import { useMemo, useState } from 'react'
import { CATEGORIES, CATEGORY_ORDER, FEATURE_STATUS_LABEL } from '../lib/categories'
import { fmtArea, fmtLength, areaM2, lengthM, parseGeometry } from '../lib/geometry'
import type { BauFeature, FeatureCategory, SurveyPoint } from '../types'
import FeatureForm from './FeatureForm'

const STATUS_DOT: Record<BauFeature['status'], string> = {
  geplant: 'bg-gray-400',
  gebaut: 'bg-amber-500',
  eingemessen: 'bg-green-600',
  verworfen: 'bg-red-300',
}

/** Liste der Bauobjekte mit Filter, Auswahl für den Export und Eigenschaften. */
export default function ObjectsPanel({
  features,
  points,
  selectedId,
  onSelect,
  exportSel,
  onExportSel,
  canWrite,
  onNew,
  onImport,
  onEditGeometry,
  onSurvey,
}: {
  features: BauFeature[]
  points: SurveyPoint[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  exportSel: Set<string>
  onExportSel: (s: Set<string>) => void
  canWrite: boolean
  onNew: () => void
  onImport: () => void
  onEditGeometry: () => void
  onSurvey: () => void
}) {
  const [cat, setCat] = useState<FeatureCategory | ''>('')
  const [q, setQ] = useState('')
  const selected = features.find((f) => f.id === selectedId) ?? null

  const list = useMemo(
    () => features.filter((f) => (!cat || f.category === cat) && (!q || (f.label ?? '').toLowerCase().includes(q.toLowerCase()))),
    [features, cat, q],
  )
  const used = CATEGORY_ORDER.filter((c) => features.some((f) => f.category === c))

  if (selected) {
    return (
      <FeatureForm
        key={selected.id}
        feature={selected}
        points={points}
        canWrite={canWrite}
        onEditGeometry={onEditGeometry}
        onBack={() => onSelect(null)}
        onSurvey={onSurvey}
        onDeleted={() => onSelect(null)}
      />
    )
  }

  const toggle = (id: string) => {
    const s = new Set(exportSel)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    onExportSel(s)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-base"
          placeholder="Suchen …"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {canWrite && (
          <>
            <button type="button" onClick={onNew} className="min-h-12 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white">
              + Zeichnen
            </button>
            <button type="button" onClick={onImport} className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm">
              Import
            </button>
          </>
        )}
      </div>
      {used.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" onClick={() => setCat('')} className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${cat === '' ? 'border-brand-600 bg-brand-100 font-semibold' : 'border-gray-300'}`}>
            Alle {features.length}
          </button>
          {used.map((c) => (
            <button key={c} type="button" onClick={() => setCat(cat === c ? '' : c)} className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${cat === c ? 'border-brand-600 bg-brand-100 font-semibold' : 'border-gray-300'}`}>
              {CATEGORIES[c].icon} {CATEGORIES[c].label}
            </button>
          ))}
        </div>
      )}
      {features.length === 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">Noch keine Objekte. Mit «+ Zeichnen» auf der Karte einzeichnen oder eine KML/GeoJSON-Datei importieren.</p>}
      <ul className="divide-y rounded-lg border bg-white">
        {list.map((f) => {
          const g = parseGeometry(f.geometry)
          const meta = CATEGORIES[f.category]
          return (
            <li key={f.id} className="flex items-center">
              <label className="grid min-h-12 min-w-12 cursor-pointer place-items-center" title="Für den Export auswählen">
                <input type="checkbox" className="h-5 w-5" checked={exportSel.has(f.id)} onChange={() => toggle(f.id)} aria-label={`${f.label ?? meta.label} für den Export auswählen`} />
              </label>
              <button type="button" onClick={() => onSelect(f.id)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-1 pr-3 text-left">
                <span className="text-lg" style={{ color: meta.color }} aria-hidden>
                  {meta.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-medium ${f.status === 'verworfen' ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{f.label ?? meta.label}</span>
                  <span className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[f.status]}`} />
                    {FEATURE_STATUS_LABEL[f.status]} · {meta.label}
                    {g?.type === 'Polygon' ? ` · ${fmtArea(areaM2(g))}` : g?.type === 'LineString' ? ` · ${fmtLength(lengthM(g))}` : ''}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {exportSel.size > 0 && (
        <p className="text-xs text-gray-600">
          {exportSel.size} für den Export gewählt{' '}
          <button type="button" className="text-brand-700 underline" onClick={() => onExportSel(new Set())}>
            Auswahl aufheben
          </button>
        </p>
      )}
    </div>
  )
}
