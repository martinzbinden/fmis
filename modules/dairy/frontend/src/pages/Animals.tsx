import { useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useDb } from '../db/DbContext'
import { parseAdisFiles, importAdisData, type ImportSummary } from '../lib/importAdis'
import { fmtDate } from '../lib/format'
import type { Animal } from '../types'

interface AnimalRow extends Animal {
  milk_test_count: number
}

async function loadAnimals(pg: PGlite): Promise<AnimalRow[]> {
  const { rows } = await pg.query<AnimalRow>(`
    select a.*, count(mt.id) as milk_test_count
    from animals a
    left join milk_tests mt on mt.animal_id = a.id and mt.deleted_at is null
    where a.deleted_at is null
    group by a.id
    order by a.status, a.ear_tag
  `)
  return rows
}

export default function Animals() {
  const { data, loading, refresh } = useQuery(loadAnimals)
  const animals = data ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Kühe</h1>

      <ImportForm onImported={refresh} />

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && animals.length === 0 && (
        <p className="text-center text-gray-500">Noch keine Kühe importiert.</p>
      )}

      <ul className="space-y-2">
        {animals.map((a) => (
          <li key={a.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-800">{a.name ?? a.ear_tag}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  a.status === 'aktiv' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {a.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {a.ear_tag} {a.breed_code ? `· ${a.breed_code}` : ''} · geb. {fmtDate(a.birth_date)}
            </div>
            <div className="mt-1 text-xs text-gray-500">{a.milk_test_count} Milchtests erfasst</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImportForm({ onImported }: { onImported: () => void }) {
  const db = useDb()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const files = await Promise.all(
        [...fileList].map(async (f) => ({ name: f.name, text: await f.text() })),
      )
      const parsed = parseAdisFiles(files)
      const result = await importAdisData(db, parsed)
      setSummary(result)
      setWarnings(parsed.warnings)
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Herdebuch-Export importieren</h2>
      <p className="mb-3 text-xs text-gray-500">
        Alle Dateien des Herdebuch-Exports auswählen (z.B. <code>b&lt;nr&gt;.Y01</code>,{' '}
        <code>b&lt;nr&gt;.K33</code>, …) — die Satzart wird pro Zeile erkannt, nicht am
        Dateinamen. Nichts verlässt den Browser.
      </p>
      <input
        type="file"
        multiple
        disabled={busy}
        onChange={(e) => void handleFiles(e.target.files)}
        className="block w-full text-sm text-gray-600"
      />
      {busy && <p className="mt-2 text-sm text-gray-500">Importiere…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {summary && (
        <div className="mt-3 rounded bg-brand-50 p-3 text-sm text-brand-900">
          <p>{summary.animalsImported} Kühe importiert.</p>
          <p>{summary.milkTestsImported} Milchtests importiert.</p>
          {summary.unmatchedEarTags.length > 0 && (
            <p className="mt-1 text-amber-700">
              {summary.unmatchedEarTags.length} Milchtests ohne passende Kuh übersprungen:{' '}
              {summary.unmatchedEarTags.join(', ')}
            </p>
          )}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
