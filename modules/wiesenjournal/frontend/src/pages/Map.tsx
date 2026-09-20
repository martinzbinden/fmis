import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import PaddockMap from '../components/PaddockMap'
import Modal from '../components/Modal'
import { createPaddock, saveNewVersion, deletePaddock, loadCurrentPaddocks } from '../lib/paddock'
import { todayIso } from '../lib/format'
import type { Paddock, Parcel } from '../types'

const CURRENT_YEAR = new Date().getFullYear()

async function loadMapData(pg: PGlite, seasonYear: number) {
  const [paddocks, { rows: parcels }] = await Promise.all([
    loadCurrentPaddocks(seasonYear),
    pg.query<Parcel>('select * from parcels where season_year = $1 and deleted_at is null order by sort_order, name', [seasonYear]),
  ])
  return { paddocks, parcels }
}

export default function Map() {
  const [searchParams] = useSearchParams()
  const focusParcelId = searchParams.get('parcel')
  const [seasonYear] = useState(CURRENT_YEAR)
  const { data, refresh } = useQuery((pg) => loadMapData(pg, seasonYear), [seasonYear])

  const [detailTarget, setDetailTarget] = useState<Paddock | null>(null)
  const [newPaddockId, setNewPaddockId] = useState<string | null>(null)

  const paddocks = data?.paddocks ?? []
  const parcels = data?.parcels ?? []

  async function handleCreated(geometry: string) {
    const paddockId = await createPaddock({
      parcel_id: focusParcelId ?? null,
      season_year: seasonYear,
      valid_from: todayIso(),
      animal_group: null,
      geometry,
      notes: null,
    })
    setNewPaddockId(paddockId)
    refresh()
  }

  async function handleAdopted(geometry: string) {
    const paddockId = await createPaddock({
      parcel_id: focusParcelId ?? null,
      season_year: seasonYear,
      valid_from: todayIso(),
      animal_group: null,
      geometry,
      notes: 'Übernommen aus Kulturen-Vorlage (deckt sich mit der Parzelle)',
    })
    setNewPaddockId(paddockId)
    refresh()
  }

  async function handleEdited(paddockId: string, geometry: string) {
    await saveNewVersion(paddockId, { geometry })
    refresh()
  }

  async function handleDeleted(paddockId: string) {
    await deletePaddock(paddockId)
    refresh()
  }

  function handleSelect(paddockId: string) {
    const p = paddocks.find((pp) => pp.paddock_id === paddockId)
    if (p) setDetailTarget(p)
  }

  const editingTarget = detailTarget ?? (newPaddockId ? paddocks.find((p) => p.paddock_id === newPaddockId) ?? null : null)

  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Karte · Weidegänge {seasonYear}</h1>
      <p className="text-xs text-gray-500">
        Zeichne einen Weidegang direkt auf die Karte (Toolbar oben rechts). Jede Verschiebung des Zauns wird als neue
        Version gespeichert — die Karte zeigt immer den aktuellen Ist-Zustand, die Historie bleibt erhalten.
      </p>

      <PaddockMap
        paddocks={paddocks}
        parcels={parcels}
        onCreated={handleCreated}
        onEdited={handleEdited}
        onDeleted={handleDeleted}
        onSelect={handleSelect}
        onAdoptFieldsGeometry={handleAdopted}
      />

      {editingTarget && (
        <PaddockDetailsModal
          paddock={editingTarget}
          parcels={parcels}
          onClose={() => {
            setDetailTarget(null)
            setNewPaddockId(null)
          }}
          onSaved={refresh}
          onEnded={() => {
            setDetailTarget(null)
            setNewPaddockId(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function PaddockDetailsModal({
  paddock,
  parcels,
  onClose,
  onSaved,
  onEnded,
}: {
  paddock: Paddock
  parcels: Parcel[]
  onClose: () => void
  onSaved: () => void
  onEnded: () => void
}) {
  const [animalGroup, setAnimalGroup] = useState(paddock.animal_group ?? '')
  const [parcelId, setParcelId] = useState(paddock.parcel_id ?? '')
  const [notes, setNotes] = useState(paddock.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await saveNewVersion(paddock.paddock_id, {
        animal_group: animalGroup.trim() || null,
        parcel_id: (parcelId || null) as never,
        notes: notes.trim() || null,
      })
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function end() {
    if (!confirm('Diesen Weidegang beenden? Er verschwindet aus der aktuellen Karte, die Historie bleibt erhalten.')) return
    await deletePaddock(paddock.paddock_id)
    onEnded()
  }

  return (
    <Modal title="Weidegang" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Tiergruppe</span>
          <input
            type="text"
            placeholder="z.B. 12 Milchkühe"
            value={animalGroup}
            onChange={(e) => setAnimalGroup(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            autoFocus
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Parzelle (optional)</span>
          <select
            value={parcelId}
            onChange={(e) => setParcelId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">– keine Zuordnung –</option>
            {parcels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            rows={2}
          />
        </label>
        <div className="flex items-center justify-between border-t pt-3">
          <button type="button" onClick={end} className="rounded-lg px-3 py-1.5 text-sm text-red-600">
            Weidegang beenden
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Schliessen
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
