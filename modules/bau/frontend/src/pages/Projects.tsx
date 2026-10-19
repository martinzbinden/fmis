import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import ProjectForm from '../components/ProjectForm'
import { useQuery } from '../hooks/useQuery'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_ORDER } from '../lib/categories'
import { loadProjects } from '../lib/data'
import { fmtDate } from '../lib/format'
import { fmtLength } from '../lib/geometry'
import type { ProjectStatus } from '../types'

const STATUS_STYLE: Record<ProjectStatus, string> = {
  idee: 'bg-gray-100 text-gray-700',
  geplant: 'bg-blue-100 text-blue-800',
  bewilligt: 'bg-indigo-100 text-indigo-800',
  im_bau: 'bg-amber-100 text-amber-900',
  abgeschlossen: 'bg-green-100 text-green-800',
}

/** Projektliste: Leitungen, Schächte und Gebäude planen, einzeichnen und einmessen. */
export default function Projects() {
  const { data, loading } = useQuery(loadProjects, [])
  const canWrite = useHasPermission('bau:projekte:write')
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<ProjectStatus | ''>('')
  const list = (data ?? []).filter((p) => !filter || p.status === filter)

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Bauprojekte</h1>
        {canWrite && (
          <button type="button" onClick={() => setCreating(true)} className="min-h-12 rounded-lg bg-brand-600 px-4 text-base font-medium text-white">
            + Projekt
          </button>
        )}
      </div>

      {(data?.length ?? 0) > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" onClick={() => setFilter('')} className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${filter === '' ? 'border-brand-600 bg-brand-100 font-semibold' : 'border-gray-300'}`}>
            Alle
          </button>
          {PROJECT_STATUS_ORDER.filter((s) => data?.some((p) => p.status === s)).map((s) => (
            <button key={s} type="button" onClick={() => setFilter(filter === s ? '' : s)} className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${filter === s ? 'border-brand-600 bg-brand-100 font-semibold' : 'border-gray-300'}`}>
              {PROJECT_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}

      {loading && !data && <p className="text-center text-gray-600">Lädt …</p>}
      {data && data.length === 0 && (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">
          <p className="mb-2 font-semibold text-gray-900">Noch kein Projekt.</p>
          <p>Lege ein Projekt an (z.B. «Gülleleitung Riedacker»), importiere eine KML-Datei oder zeichne Leitungen, Schächte und Gebäude auf der swisstopo-Karte ein. Vor Ort misst du sie per GPS ein und exportierst alles als KML, DXF, GeoJSON, GPX oder CSV.</p>
        </div>
      )}

      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id}>
            <Link to={`projekt/${p.id}`} className="block rounded-xl bg-white p-4 shadow-sm active:bg-gray-100">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold text-gray-900">{p.name}</div>
                  <div className="truncate text-xs text-gray-600">
                    {[p.location, p.contractor].filter(Boolean).join(' · ') || 'ohne Ort/Firma'}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[p.status]}`}>{PROJECT_STATUS_LABEL[p.status]}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
                <span>{p.objectCount} Objekt{p.objectCount === 1 ? '' : 'e'}</span>
                {p.lengthM > 0 && <span>{fmtLength(p.lengthM)} Leitung</span>}
                {p.objectCount > 0 && <span>{p.surveyed} eingemessen</span>}
                {p.start_date && <span>ab {fmtDate(p.start_date)}</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {creating && (
        <ProjectForm
          project={null}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            navigate(`projekt/${id}`)
          }}
        />
      )}
    </div>
  )
}
