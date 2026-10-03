import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { isTractor, loadMachines, MACHINE_KIND_LABEL } from '../lib/machines'
import { loadMachineFiles } from '../lib/machineFiles'
import MachineForm from '../components/MachineForm'
import MachineImage from '../components/MachineImage'
import type { Machine, MachineFile } from '../types'

const UNIT_LABEL = { m3: 'm³', t: 't', kg: 'kg' } as const

async function load(pg: PGlite) {
  const [machines, files] = await Promise.all([loadMachines(pg, false), loadMachineFiles(pg)])
  return { machines, files }
}

export function machineFacts(m: Machine, machines: Machine[]): string[] {
  const facts: string[] = [MACHINE_KIND_LABEL[m.kind] ?? m.kind]
  if (m.power_hp != null) facts.push(`${m.power_hp} PS`)
  if (m.front_pto) facts.push('Frontzapfwelle')
  if (m.capacity != null && m.capacity_unit) facts.push(`${m.capacity} ${UNIT_LABEL[m.capacity_unit]}`)
  if (m.width_m != null) facts.push(`Arbeitsbreite ${m.width_m} m`)
  if (m.year_built != null) facts.push(`Baujahr ${m.year_built}`)
  const tractor = m.tractor_id ? machines.find((t) => t.id === m.tractor_id) : null
  if (tractor) facts.push(`mit ${tractor.name}`)
  if (!m.active) facts.push('nicht aktiv')
  return facts
}

function MachineRow({ m, machines, files }: { m: Machine; machines: Machine[]; files: MachineFile[] }) {
  const image = files.find((f) => f.machine_id === m.id && f.kind === 'bild')
  const docs = files.filter((f) => f.machine_id === m.id && f.kind !== 'bild').length
  return (
    <li>
      <Link to={m.id} className={`flex items-center gap-3 rounded-lg bg-white p-2 shadow-sm active:bg-gray-50 ${m.active ? '' : 'opacity-50'}`}>
        {image ? (
          <MachineImage fileId={image.id} alt={m.name} className="h-16 w-16 shrink-0 rounded" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-gray-100 text-2xl">{isTractor(m) ? '🚜' : '⚙️'}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-800">{m.name}</div>
          <div className="text-xs text-gray-500">{machineFacts(m, machines).join(' · ')}</div>
          {docs > 0 && <div className="text-xs text-brand-700">📄 {docs === 1 ? '1 Anleitung/Dokument' : `${docs} Anleitungen/Dokumente`}</div>}
        </div>
        <span className="text-gray-300">›</span>
      </Link>
    </li>
  )
}

/** Maschinenliste: Traktoren und Anbaugeräte mit Bild; Details, Typenschild
 * und Anleitungen auf der Detailseite (pages/MachineDetail.tsx). */
export default function Machines() {
  const { data, loading, refresh } = useQuery(load, [])
  const canWrite = useHasPermission('wiesenjournal:tracking:write')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const machines = data?.machines ?? []
  const files = data?.files ?? []
  const tractors = machines.filter(isTractor)
  const implements_ = machines.filter((m) => !isTractor(m))

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="../arbeitsplan" className="text-sm text-brand-700">
            ← Arbeitsplan
          </Link>
          <h1 className="text-xl font-bold text-gray-800">Maschinen</h1>
          <p className="text-xs text-gray-500">
            Fassgrösse bzw. Ladevolumen (Anzahl Fässer im Arbeitsplan), Arbeitsbreite (GPS-Spur) und der Traktor, der zum Gerät
            vorgeschlagen wird.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-700"
          >
            + Maschine
          </button>
        )}
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && machines.length === 0 && <p className="text-center text-sm text-gray-500">Noch keine Maschinen erfasst.</p>}

      {tractors.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Traktoren</h2>
          <ul className="space-y-2">
            {tractors.map((m) => (
              <MachineRow key={m.id} m={m} machines={machines} files={files} />
            ))}
          </ul>
        </section>
      )}
      {implements_.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Geräte</h2>
          <ul className="space-y-2">
            {implements_.map((m) => (
              <MachineRow key={m.id} m={m} machines={machines} files={files} />
            ))}
          </ul>
        </section>
      )}

      {adding && (
        <MachineForm
          machine={null}
          machines={machines}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false)
            refresh()
            navigate(id)
          }}
        />
      )}
    </div>
  )
}
