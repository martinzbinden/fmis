import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useDb } from '@fmis/core/DbContext'
import { decodeHerdbookFile, parseAdisFiles, importAdisData, type HerdbookSpecies, type ImportSummary } from '../lib/importAdis'
import { expandImportFiles, type ImportFile } from '../lib/importFiles'
import { parseTierbestand, importTierbestand } from '../lib/importTvd'
import { inTransaction } from '../db/transaction'
import { fmtDate, todayIso } from '../lib/format'
import { parseSmgCertificate, readPdfText } from '../lib/smgCertificate'
import { applyCertificatePlan, planCertificateImport, type CertificateImportResult, type CertificatePlan } from '../lib/importCertificate'
import AnimalTable, { matchesFilter, type AnimalRow } from '../components/AnimalTable'
import { animalKey, animalLabel } from '@fmis/core/earTag'
import { loadInbreeding } from '../lib/pedigreeData'

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
  const inbreeding = await loadInbreeding(pg)
  return rows.map((r) => ({
    ...r,
    milk_test_count: Number(r.milk_test_count),
    journal_count: Number(r.journal_count),
    inbreeding: inbreeding.inbreeding(animalKey(r.ear_tag) ?? r.ear_tag),
  }))
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

/** Ein Importfeld für alle Quellen (lib/importFiles.ts): Herdebuch-Export,
 * TVD-Tierbestand (Excel; bei den Schafen für Jungtiere und Widder, die im
 * SMG-Export fehlen) und SMG-Leistungsausweise (PDF), einzeln oder als ZIP.
 * Reihenfolge: Export, dann TVD (Abgleich über den Ohrmarken-Schlüssel, Kurz-
 * und Langform werden nicht doppelt angelegt), zuletzt Ausweise — so hat der
 * Export-Stammbaum Vorrang und der Ausweis füllt Lücken. */
function ImportForm({ onImported, species }: { onImported: () => void; species: HerdbookSpecies }) {
  const db = useDb()
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<ImportFile[]>([])
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [tvdCount, setTvdCount] = useState<number | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [certificates, setCertificates] = useState<CertificateImportResult[]>([])
  const [pending, setPending] = useState<CertificatePlan[]>([])

  async function decide(plan: CertificatePlan, overwrite: boolean) {
    setBusy(true)
    try {
      const result = await inTransaction(db, (tx) => applyCertificatePlan(tx, plan, overwrite))
      setCertificates((c) => [...c, result])
      setPending((p) => p.filter((x) => x !== plan))
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return
    setBusy(true)
    setError(null)
    setFound([])
    setSummary(null)
    setTvdCount(null)
    setCertificates([])
    setPending([])
    setWarnings([])
    try {
      const files = await expandImportFiles([...fileList])
      setFound(files)
      const of = (kind: ImportFile['kind']) => files.filter((f) => f.kind === kind)
      const nextWarnings = of('ignored').map((f) => `${f.name}: übergangen (${f.reason})`)

      const herdbook = of('herdbook')
      if (herdbook.length > 0) {
        const parsed = parseAdisFiles(
          herdbook.map((f) => decodeHerdbookFile(f.name, f.data)),
          species,
        )
        setSummary(await importAdisData(db, parsed))
        nextWarnings.push(...parsed.warnings)
      }

      let tvd = 0
      for (const f of of('tvd')) {
        try {
          const animals = await parseTierbestand(new File([f.data], f.name))
          if (animals.length === 0) {
            nextWarnings.push(`${f.name}: keine Tiere erkannt (Spalte «Ohrmarkennummer» fehlt?)`)
            continue
          }
          tvd += await inTransaction(db, (tx) => importTierbestand(tx, animals))
        } catch (err) {
          nextWarnings.push(`${f.name}: ${err instanceof Error ? err.message : 'nicht lesbar'}`)
        }
      }
      if (of('tvd').length) setTvdCount(tvd)

      // Ohne Abweichungen direkt speichern, sonst zuerst nachfragen.
      const results: CertificateImportResult[] = []
      const toDecide: CertificatePlan[] = []
      for (const f of of('certificate')) {
        try {
          const plan = await planCertificateImport(db, parseSmgCertificate(await readPdfText(f.data), todayIso()))
          if (plan.conflicts.length) toDecide.push(plan)
          else results.push(await inTransaction(db, (tx) => applyCertificatePlan(tx, plan, true)))
        } catch (err) {
          nextWarnings.push(`${f.name}: ${err instanceof Error ? err.message : 'nicht lesbar'}`)
        }
      }
      setCertificates(results)
      setPending(toDecide)
      setWarnings(nextWarnings)
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const counts = (['herdbook', 'tvd', 'certificate'] as const)
    .map((k) => [k, found.filter((f) => f.kind === k).length] as const)
    .filter(([, n]) => n > 0)
  const KIND_LABEL = { herdbook: 'Herdebuch-Dateien', tvd: 'TVD-Liste(n)', certificate: 'Leistungsausweis(e)' }

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Daten importieren</h2>
      <p className="mb-3 text-xs text-gray-500">
        Herdebuch-Export ({species === 'sheep' ? 'SMG' : 'swissherdbook/Braunvieh'}: <code>b&lt;nr&gt;.Y01</code>, <code>.K04</code>,{' '}
        <code>.K09</code>–<code>.K11</code>, <code>.K33</code> …), TVD-Tierbestand (Excel)
        {species === 'sheep' ? ', SMG-Abstammungs- und Leistungsausweise (PDF)' : ''} — einzeln, mehrere zusammen oder als ZIP. Die
        Dateiart wird automatisch erkannt. Nichts verlässt den Browser.
      </p>
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handleFiles(e.dataTransfer.files)
        }}
        className={`block cursor-pointer rounded-lg border-2 border-dashed p-4 text-center text-sm ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 text-gray-600'
        }`}
      >
        {busy ? 'Importiere…' : 'Dateien oder ZIP hierher ziehen oder antippen zum Auswählen'}
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
          className="sr-only"
        />
      </label>
      {counts.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">Erkannt: {counts.map(([k, n]) => `${n} ${KIND_LABEL[k]}`).join(', ')}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {summary && (
        <div className="mt-3 rounded bg-brand-50 p-3 text-sm text-brand-900">
          <p>Herdebuch: {summary.animalsImported} Tiere, {summary.milkTestsImported} Milchproben, {summary.lactationsImported} Laktationsdaten gelesen.</p>
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
      {tvdCount != null && (
        <p className="mt-2 rounded bg-brand-50 p-3 text-sm text-brand-900">TVD-Tierbestand: {tvdCount} Tiere übernommen.</p>
      )}
      {pending.map((plan) => (
        <div key={plan.subject} className="mt-2 space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            Leistungsausweis {plan.subject}
            {plan.document_date ? ` (Stand ${fmtDate(plan.document_date)})` : ''} weicht von gespeicherten Angaben ab:
          </p>
          {plan.older_than_stored && (
            <p className="font-semibold text-red-700">Achtung: Dieser Ausweis ist älter als bereits gespeicherte Angaben.</p>
          )}
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
            {plan.conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(plan, true)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${plan.older_than_stored ? 'border border-amber-400 bg-white' : 'bg-amber-600 text-white'}`}
            >
              Mit Ausweis überschreiben
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(plan, false)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${plan.older_than_stored ? 'bg-amber-600 text-white' : 'border border-amber-400 bg-white'}`}
            >
              Nur Neues ergänzen
            </button>
          </div>
        </div>
      ))}
      {certificates.map((c) => (
        <p key={c.subject} className="mt-2 rounded bg-brand-50 p-3 text-sm text-brand-900">
          Leistungsausweis {c.subject}: {c.written} Einträge neu oder geändert
          {c.skipped ? `, ${c.skipped} abweichende Angaben belassen` : ''}.
        </p>
      ))}
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
