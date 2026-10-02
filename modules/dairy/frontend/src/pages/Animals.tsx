import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useDb } from '@fmis/core/DbContext'
import { parseAdisFiles, importAdisData, readHerdbookFile, type HerdbookSpecies, type ImportSummary } from '../lib/importAdis'
import { parseTierbestand, importSmgData, type SmgImportSummary } from '../lib/importSmg'
import { fmtDate } from '../lib/format'
import AnimalTable, { matchesFilter, type AnimalRow } from '../components/AnimalTable'
import { animalLabel } from '@fmis/core/earTag'

async function loadAnimals(pg: PGlite): Promise<AnimalRow[]> {
  const { rows } = await pg.query<AnimalRow>(`
    select a.*,
      (select count(*) from milk_tests mt where mt.animal_id = a.id and mt.deleted_at is null) as milk_test_count,
      (select count(*) from animal_journal j where j.animal_id = a.id and j.deleted_at is null) as journal_count,
      (select j.text from animal_journal j where j.animal_id = a.id and j.deleted_at is null
        order by j.entry_date desc, j.updated_at desc limit 1) as last_journal
    from animals a
    where a.deleted_at is null
    order by a.status, a.lauf_nr nulls last, a.ear_tag
  `)
  return rows.map((r) => ({ ...r, milk_test_count: Number(r.milk_test_count), journal_count: Number(r.journal_count) }))
}

type ViewMode = 'cards' | 'list'

function loadView(key: string): ViewMode {
  try {
    return localStorage.getItem(key) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

export default function Animals({ moduleKey }: { moduleKey: string }) {
  const { data, loading, refresh } = useQuery(loadAnimals)
  const viewKey = `${moduleKey}_animals_view`
  const [view, setView] = useState<ViewMode>(() => loadView(viewKey))
  const [filter, setFilter] = useState('')
  const allAnimals = data ?? []
  // Ein Filterfeld über alle Spalten — gilt für Karten und Liste.
  const animals = filter ? allAnimals.filter((a) => matchesFilter(a, filter)) : allAnimals

  function changeView(v: ViewMode) {
    setView(v)
    try {
      localStorage.setItem(viewKey, v)
    } catch {
      // nur bis zum Reload
    }
  }

  return (
    <div className={`mx-auto space-y-6 p-4 pb-24 ${view === 'list' ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <h1 className="text-xl font-bold text-gray-800">Tiere</h1>

      <ImportForm onImported={refresh} species={moduleKey === 'dairy' ? 'cattle' : 'sheep'} />
      {moduleKey !== 'dairy' && <TierbestandImportForm onImported={refresh} />}

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && allAnimals.length === 0 && (
        <p className="text-center text-gray-500">Noch keine Tiere importiert.</p>
      )}

      {allAnimals.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Filter (Name, Ohrmarke, Rasse, Status, …)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <span className="text-xs text-gray-500">
            {animals.length}
            {filter ? ` von ${allAnimals.length}` : ''}
          </span>
          <div className="flex rounded border border-gray-300 text-xs">
            {(
              [
                ['cards', 'Karten'],
                ['list', 'Liste'],
              ] as [ViewMode, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                className={`px-2.5 py-1 ${view === v ? 'bg-brand-700 text-white' : 'text-gray-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'list' && allAnimals.length > 0 && <AnimalTable animals={animals} storageKey={`${moduleKey}_animals_columns`} />}

      {view === 'cards' && animals.length === 0 && allAnimals.length > 0 && (
        <p className="text-center text-gray-400">Keine Treffer.</p>
      )}
      <ul className={`space-y-2 ${view === 'list' ? 'hidden' : ''}`}>
        {animals.map((a) => (
          <li key={a.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Link to={a.id} className="font-semibold text-gray-800">
                {a.lauf_nr && <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-sm font-bold">{a.lauf_nr}</span>}
                {animalLabel(a)}
              </Link>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  a.status === 'aktiv' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {a.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {a.breed_code ? `${a.breed_code} · ` : ''}geb. {fmtDate(a.birth_date)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {a.milk_test_count} Milchtests erfasst
              {a.journal_count > 0 ? ` · ${a.journal_count} Journaleinträge` : ''}
            </div>
            {a.last_journal && <div className="mt-1 text-xs text-gray-600">📝 {a.last_journal}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImportForm({ onImported, species }: { onImported: () => void; species: HerdbookSpecies }) {
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
      const files = await Promise.all([...fileList].map(readHerdbookFile))
      const parsed = parseAdisFiles(files, species)
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
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        Herdebuch-Export importieren ({species === 'sheep' ? 'SMG' : 'swissherdbook/Braunvieh'})
      </h2>
      <p className="mb-3 text-xs text-gray-500">
        Alle Dateien des Exports auswählen (z.B. <code>b&lt;nr&gt;.Y01</code>, <code>.Y02</code>,{' '}
        <code>.K04</code>, <code>.K09</code>–<code>.K11</code>, <code>.K33</code>) — die Satzart wird
        pro Zeile erkannt, nicht am Dateinamen. Liest Stammdaten, Abstammung, Milchproben,
        Laktationen, Belegungen, Geburten und Zuchtwerte. Nichts verlässt den Browser.
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
          <p>{summary.animalsImported} Tiere, {summary.milkTestsImported} Milchproben, {summary.lactationsImported} Laktationsdaten gelesen.</p>
          <p>
            Neu oder geändert: {summary.pedigreeWritten} Stammbaum-Einträge, {summary.matingsWritten} Belegungen,{' '}
            {summary.birthsWritten} Geburten ({summary.offspringWritten} Nachkommen), {summary.breedingValuesWritten} Zuchtwerte.
          </p>
          {summary.unmatchedEarTags.length > 0 && (
            <p className="mt-1 text-amber-700">
              {summary.unmatchedEarTags.length} Muttertiere nicht (mehr) im Bestand — ihre Einträge wurden
              übersprungen: {summary.unmatchedEarTags.join(', ')}
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

/** Zusatz-Import für die Milchschafe: der SMG-Export enthält nur Auen mit
 * Milchleistungsdaten — Jungtiere und Widder kommen aus dem TVD-Tierbestand.
 * Abgleich über den normalisierten Ohrmarken-Schlüssel (lib/animalId.ts),
 * damit Kurz- und Langform nicht doppelt angelegt werden. */
function TierbestandImportForm({ onImported }: { onImported: () => void }) {
  const db = useDb()
  const [tierbestandFile, setTierbestandFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SmgImportSummary | null>(null)
  const [warnings] = useState<string[]>([])

  async function handleImport() {
    if (!tierbestandFile) return
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const tierbestand = await parseTierbestand(tierbestandFile)
      const result = await importSmgData(db, tierbestand, { lactations: [], milkTests: [], warnings: [] })
      setSummary(result)
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">TVD-Tierbestand importieren (Jungtiere, Widder)</h2>
      <p className="mb-3 text-xs text-gray-500">
        Der SMG-Export enthält nur Auen mit Milchleistung. Jungtiere und Widder kommen aus dem
        TVD-Tierbestand (<code>Tierbestand.xlsx</code>). Nichts verlässt den Browser.
      </p>
      <label className="block text-xs font-medium text-gray-600">
        TVD-Tierbestand (Excel)
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={busy}
          onChange={(e) => setTierbestandFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-gray-600"
        />
      </label>
      <button
        type="button"
        onClick={() => void handleImport()}
        disabled={busy || !tierbestandFile}
        className="mt-3 w-full rounded-lg bg-brand-700 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Importiere…' : 'Importieren'}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {summary && (
        <div className="mt-3 rounded bg-brand-50 p-3 text-sm text-brand-900">
          <p>{summary.animalsImported} Tiere aus dem TVD-Tierbestand übernommen.</p>
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
