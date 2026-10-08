import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '../hooks/useQuery'
import AnimalPicker from '../components/AnimalPicker'
import JournalForm from '../components/JournalForm'
import { speciesTerms } from '../lib/species'
import type { Animal } from '../types'

/** Beobachtung/Krankheit/Behandlung für ein oder mehrere Tiere erfassen. */
export default function JournalEntry({ moduleKey }: { moduleKey: string }) {
  const terms = speciesTerms(moduleKey)
  const { data } = useQuery((pg) =>
    pg
      .query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' order by lauf_nr nulls last, ear_tag")
      .then((r) => r.rows),
  )
  const [ids, setIds] = useState<string[]>([])
  const [saved, setSaved] = useState<string[] | null>(null)

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Beobachtung / Behandlung</h1>
        <Link to="../behandlungen" relative="path" className="text-sm text-brand-700">
          Behandlungsjournal →
        </Link>
      </div>
      {saved && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Gespeichert.{' '}
          {saved.length === 1 && (
            <Link to={`../kuehe/${saved[0]}`} relative="path" className="font-medium text-brand-700">
              Zum Tier
            </Link>
          )}
        </div>
      )}
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm text-gray-600">{terms.plural} (eines oder mehrere)</div>
        <AnimalPicker animals={data ?? []} selected={ids} onChange={setIds} multiple />
      </div>
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <JournalForm
          animalIds={ids}
          onSaved={() => {
            setSaved(ids)
            setIds([])
          }}
        />
      </div>
    </div>
  )
}
