import { useState } from 'react'
import { importAnimalRows, type SeedRow } from '../lib/importCsv'
import { syncClient } from '../db/sync'

const today = () => new Date().toISOString().slice(0, 10)

/** Neue Mastgruppe aus einem TVD-Begleitdokument (PDF) oder einer CSV
 * (ear_tag,birth_date,sex) — von der zentralen Upload-Seite
 * (lib/importDetect.ts). Gruppenname und Eingangsdatum bestätigt der
 * Benutzer, darum startet dieser Import nicht von selbst. */
export default function IntakePanel({ rows, warnings }: { rows: SeedRow[]; warnings: string[] }) {
  const [groupName, setGroupName] = useState(`Gruppe ${today()}`)
  const [intakeDate, setIntakeDate] = useState(today())
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    setImporting(true)
    setError(null)
    try {
      const { count } = await importAnimalRows(rows, groupName, intakeDate)
      setDone(count)
      void syncClient.syncNow()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setImporting(false)
    }
  }

  if (done != null) {
    return (
      <p className="rounded bg-brand-50 p-3 text-sm text-brand-900">
        Gruppe «{groupName}» mit {done} Tieren angelegt.
      </p>
    )
  }

  return (
    <div className="space-y-2 text-sm">
      {warnings.map((w, i) => (
        <p key={i} className="text-amber-700">
          ⚠ {w}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          Gruppenname
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        <label className="block">
          Eingangsdatum
          <input
            type="date"
            value={intakeDate}
            onChange={(e) => setIntakeDate(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => void handleImport()}
        disabled={importing || rows.length === 0}
        className="w-full rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white active:bg-brand-800 disabled:opacity-50"
      >
        {importing ? 'Importiere…' : `Neue Mastgruppe mit ${rows.length} Tieren anlegen`}
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
