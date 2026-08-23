import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useEarTagFilter } from '../hooks/useEarTagFilter'
import EarTagFilterInput from '../components/EarTagFilterInput'
import { importAnimalRows, parseIntakeCsv, type SeedRow } from '../lib/importCsv'
import { parseIntakePdf } from '../lib/parsePdfIntake'
import { fmtKg, fmtAge, num } from '../lib/format'
import type { AnimalStatus } from '../types'

interface Row {
  id: string
  ear_tag: string
  status: AnimalStatus
  birth_date: string | null
  last_weight: unknown
  group_name: string | null
}

async function loadAnimals(pg: PGlite): Promise<Row[]> {
  const { rows } = await pg.query<Row>(`
    select
      a.id, a.ear_tag, a.status, a.birth_date,
      w_last.weight_kg as last_weight,
      g.name as group_name
    from animals a
    left join lateral (
      select weight_kg from weighings w
      where w.animal_id = a.id and w.deleted_at is null
      order by w.date desc, w.updated_at desc limit 1
    ) w_last on true
    left join lateral (
      select gm.group_id
      from group_memberships gm
      where gm.animal_id = a.id and gm.deleted_at is null and gm.end_date is null
      order by gm.start_date desc limit 1
    ) cur_gm on true
    left join animal_groups g on g.id = cur_gm.group_id and g.deleted_at is null
    where a.deleted_at is null
    order by (a.status = 'aktiv') desc, a.ear_tag
  `)
  return rows
}

const STATUS_LABEL: Record<AnimalStatus, string> = {
  aktiv: 'Aktiv',
  verkauft: 'Verkauft',
  geschlachtet: 'Geschlachtet',
  verendet: 'Verendet',
}

const STATUS_COLOR: Record<AnimalStatus, string> = {
  aktiv: 'bg-green-100 text-green-800',
  verkauft: 'bg-blue-100 text-blue-800',
  geschlachtet: 'bg-gray-200 text-gray-700',
  verendet: 'bg-red-100 text-red-800',
}

const today = () => new Date().toISOString().slice(0, 10)

function ImportForm({ onDone }: { onDone: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<SeedRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [groupName, setGroupName] = useState(`Gruppe ${today()}`)
  const [intakeDate, setIntakeDate] = useState(today())
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setRows(null)
    setWarnings([])
    setImportError(null)
    setParsing(true)
    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const result = await parseIntakePdf(await file.arrayBuffer())
        setRows(result.animals)
        setWarnings(result.warnings)
      } else {
        setRows(parseIntakeCsv(await file.text()))
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!rows) return
    setImporting(true)
    setImportError(null)
    try {
      await importAnimalRows(rows, groupName, intakeDate)
      onDone()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm text-gray-600">
        TVD-Begleitdokument (PDF, beliebig viele Seiten/Tiere) oder CSV mit Spalten{' '}
        <code className="rounded bg-gray-100 px-1">ear_tag,birth_date,sex</code> von deinem Gerät
        wählen — die Datei bleibt lokal und wird nicht ins Repo übernommen.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv,.pdf,application/pdf"
        onChange={handleFileChange}
        className="mb-3 block w-full text-sm"
      />
      {parsing && <p className="text-sm text-gray-500">Lese {fileName}…</p>}
      {rows && (
        <div className="space-y-2">
          <p className="text-sm text-gray-700">
            {fileName}: <strong>{rows.length} Tiere</strong> erkannt
          </p>
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-700">
              ⚠ {w}
            </p>
          ))}
          <label className="block text-sm">
            Gruppenname
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </label>
          <label className="block text-sm">
            Eingangsdatum
            <input
              type="date"
              value={intakeDate}
              onChange={(e) => setIntakeDate(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || rows.length === 0}
            className="w-full rounded-lg bg-brand-700 px-5 py-3 font-semibold text-white active:bg-brand-800 disabled:opacity-50"
          >
            {importing ? 'Importiere…' : `${rows.length} Tiere importieren`}
          </button>
        </div>
      )}
      {importError && <p className="mt-3 text-sm text-red-600">{importError}</p>}
    </div>
  )
}

export default function Animals() {
  const { data, loading, refresh } = useQuery(loadAnimals)
  const [showImport, setShowImport] = useState(false)
  const { filter, setFilter, filtered } = useEarTagFilter(data, (a) => a.ear_tag)

  if (loading && !data) {
    return <div className="p-4 text-center text-gray-400">Lädt…</div>
  }

  const animals = data ?? []
  const visibleAnimals = filtered ?? []

  if (animals.length === 0) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="mb-4 text-center text-gray-500">Noch keine Tiere erfasst.</p>
        <ImportForm onDone={refresh} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Tiere ({animals.length})</h1>
        <button
          type="button"
          onClick={() => setShowImport((v) => !v)}
          className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
        >
          {showImport ? 'Schliessen' : '+ Tiere importieren'}
        </button>
      </div>
      {showImport && (
        <div className="mb-4">
          <ImportForm
            onDone={() => {
              setShowImport(false)
              refresh()
            }}
          />
        </div>
      )}
      <div className="mb-3">
        <EarTagFilterInput value={filter} onChange={setFilter} />
      </div>
      {visibleAnimals.length === 0 && (
        <p className="text-center text-gray-500">Keine Tiere gefunden.</p>
      )}
      <ul className="space-y-2">
        {visibleAnimals.map((a) => (
          <li key={a.id}>
            <Link
              to={`/tiere/${a.id}`}
              className="flex items-center justify-between rounded-lg bg-white p-3 shadow-sm active:bg-gray-50"
            >
              <div>
                <div className="font-semibold text-gray-800">{a.ear_tag}</div>
                <div className="text-xs text-gray-500">
                  {fmtAge(a.birth_date)}
                  {a.group_name ? ` · ${a.group_name}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-gray-700">{fmtKg(num(a.last_weight))}</span>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLOR[a.status]}`}>
                  {STATUS_LABEL[a.status]}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
