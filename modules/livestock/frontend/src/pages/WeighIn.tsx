import { useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useEarTagFilter } from '../hooks/useEarTagFilter'
import EarTagFilterInput from '../components/EarTagFilterInput'
import { useDb } from '../db/DbContext'
import { upsertRow } from '../db/write'
import { todayIso, num } from '../lib/format'
import {
  parseGenericCsv,
  guessDateFromHeader,
  importWeightsFromCsv,
  type ParsedCsv,
  type ImportWeightsResult,
} from '../lib/importWeights'

interface GroupOption {
  id: string
  name: string
}

interface AnimalRow {
  animal_id: string
  ear_tag: string
  last_weight: unknown
}

async function loadGroups(pg: PGlite): Promise<GroupOption[]> {
  const { rows } = await pg.query<GroupOption>(
    "select id, name from animal_groups where deleted_at is null and status = 'aktiv' order by created_date desc",
  )
  return rows
}

function loadAnimalsForGroup(groupId: string | null) {
  return async (pg: PGlite): Promise<AnimalRow[]> => {
    if (!groupId) return []
    const { rows } = await pg.query<AnimalRow>(
      `select a.id as animal_id, a.ear_tag,
              w_last.weight_kg as last_weight
       from group_memberships gm
       join animals a on a.id = gm.animal_id and a.deleted_at is null and a.status = 'aktiv'
       left join lateral (
         select weight_kg from weighings w
         where w.animal_id = a.id and w.deleted_at is null
         order by w.date desc, w.updated_at desc limit 1
       ) w_last on true
       where gm.group_id = $1 and gm.deleted_at is null and gm.end_date is null
       order by a.ear_tag`,
      [groupId],
    )
    return rows
  }
}

interface ColumnSelection {
  checked: boolean
  date: string
}

function CsvImportForm({ onDone }: { onDone: () => void }) {
  const pg = useDb()
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [csv, setCsv] = useState<ParsedCsv | null>(null)
  const [fileName, setFileName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [earTagColumn, setEarTagColumn] = useState(0)
  const [columns, setColumns] = useState<Record<number, ColumnSelection>>({})
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportWeightsResult | null>(null)

  function applyParsed(parsed: ParsedCsv) {
    setResult(null)
    setError(null)
    setCsv(parsed)
    setEarTagColumn(0)
    const initialColumns: Record<number, ColumnSelection> = {}
    parsed.headers.forEach((h, i) => {
      if (i === 0) return
      initialColumns[i] = { checked: false, date: guessDateFromHeader(h) }
    })
    setColumns(initialColumns)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    applyParsed(parseGenericCsv(await file.text()))
  }

  function handlePasteChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    setPasteText(text)
    if (text.trim()) {
      applyParsed(parseGenericCsv(text))
    } else {
      setCsv(null)
    }
  }

  const selectedColumns = Object.entries(columns)
    .filter(([, c]) => c.checked && c.date)
    .map(([i, c]) => ({ columnIndex: Number(i), date: c.date }))

  async function handleImport() {
    if (!csv || selectedColumns.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const res = await importWeightsFromCsv(pg, csv, earTagColumn, selectedColumns)
      setResult(res)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm text-gray-600">
        Tabelle mit einer Spalte für die Ohrmarke und einer oder mehreren Gewichts-Spalten (z.B.
        pro Wägedatum eine Spalte) — welche Spalten importiert werden, wählst du unten aus.
      </p>

      <div className="mb-3 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`rounded px-3 py-1.5 ${mode === 'file' ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
        >
          Datei
        </button>
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={`rounded px-3 py-1.5 ${mode === 'paste' ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
        >
          Text einfügen
        </button>
      </div>

      {mode === 'file' ? (
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="mb-3 block w-full text-sm"
        />
      ) : (
        <div className="mb-3">
          <textarea
            value={pasteText}
            onChange={handlePasteChange}
            rows={6}
            placeholder={'Direkt aus Excel kopieren und hier einfügen, z.B.:\nOhrmarke\t01.03.2026\t15.03.2026\nCH123456789\t45.2\t48.1'}
            className="w-full rounded border border-gray-300 p-2 font-mono text-xs"
          />
        </div>
      )}

      {csv && csv.headers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {mode === 'file' ? `${fileName}: ` : ''}
            <strong>{csv.rows.length} Zeilen</strong> erkannt
          </p>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Ohrmarken-Spalte</span>
            <select
              value={earTagColumn}
              onChange={(e) => setEarTagColumn(Number(e.target.value))}
              className="w-full rounded border border-gray-300 p-2"
            >
              {csv.headers.map((h, i) => (
                <option key={i} value={i}>
                  {h || `Spalte ${i + 1}`}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <span className="block text-sm font-medium text-gray-700">Gewichts-Spalten</span>
            {csv.headers.map((h, i) => {
              if (i === earTagColumn) return null
              const col = columns[i] ?? { checked: false, date: '' }
              return (
                <div key={i} className="flex items-center gap-2 rounded border border-gray-200 p-2">
                  <input
                    type="checkbox"
                    checked={col.checked}
                    onChange={(e) =>
                      setColumns((cs) => ({ ...cs, [i]: { ...col, checked: e.target.checked } }))
                    }
                    className="h-5 w-5"
                  />
                  <span className="flex-1 text-sm text-gray-700">{h || `Spalte ${i + 1}`}</span>
                  <input
                    type="date"
                    value={col.date}
                    onChange={(e) => setColumns((cs) => ({ ...cs, [i]: { ...col, date: e.target.value } }))}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
              )
            })}
          </div>

          <p className="text-xs text-gray-500">
            {selectedColumns.length} Gewichts-Spalte(n) ausgewählt und datiert.
          </p>

          <button
            type="button"
            onClick={handleImport}
            disabled={importing || selectedColumns.length === 0}
            className="w-full rounded-lg bg-brand-700 px-5 py-3 font-semibold text-white active:bg-brand-800 disabled:opacity-50"
          >
            {importing ? 'Importiere…' : 'Gewichte importieren'}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 space-y-1 text-sm">
          <p className="text-green-700">{result.imported} Gewichte importiert.</p>
          {result.skippedCells > 0 && (
            <p className="text-amber-700">{result.skippedCells} ungültige Zelle(n) übersprungen.</p>
          )}
          {result.unmatchedEarTags.length > 0 && (
            <p className="text-amber-700">
              Nicht gefunden: {result.unmatchedEarTags.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function WeighIn() {
  const { data: groups, loading: groupsLoading } = useQuery(loadGroups)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId && groups && groups.length > 0) setGroupId(groups[0].id)
  }, [groups, groupId])

  const { data: animals, loading: animalsLoading } = useQuery(loadAnimalsForGroup(groupId), [groupId])
  const { filter, setFilter, filtered: visibleAnimals } = useEarTagFilter(animals, (a) => a.ear_tag)

  const filledCount = useMemo(
    () => Object.values(weights).filter((v) => v.trim() !== '').length,
    [weights],
  )

  async function handleSave() {
    if (!animals) return
    setSaving(true)
    setSavedMsg(null)
    try {
      let count = 0
      for (const a of animals) {
        const raw = weights[a.animal_id]
        if (!raw || raw.trim() === '') continue
        const weightKg = Number(raw)
        if (Number.isNaN(weightKg) || weightKg <= 0) continue
        await upsertRow('weighings', {
          id: crypto.randomUUID(),
          animal_id: a.animal_id,
          date,
          weight_kg: weightKg,
          notes: null,
        })
        count++
      }
      setWeights({})
      setSavedMsg(`${count} Wägungen gespeichert.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-32">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Gewichte erfassen</h1>
        <button
          type="button"
          onClick={() => setShowCsvImport((v) => !v)}
          className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
        >
          {showCsvImport ? 'Schliessen' : 'CSV importieren'}
        </button>
      </div>

      {showCsvImport && <CsvImportForm onDone={() => setShowCsvImport(false)} />}

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Gruppe</label>
          <select
            value={groupId ?? ''}
            onChange={(e) => setGroupId(e.target.value || null)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          >
            {groupsLoading && <option>Lädt…</option>}
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Datum</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </div>
      </div>

      {animalsLoading && <p className="text-center text-gray-400">Lädt Tiere…</p>}

      {groups && groups.length === 0 && (
        <p className="text-center text-gray-500">Keine aktiven Gruppen vorhanden.</p>
      )}

      {animals && animals.length === 0 && groupId && !animalsLoading && (
        <p className="text-center text-gray-500">Keine aktiven Tiere in dieser Gruppe.</p>
      )}

      {animals && animals.length > 0 && (
        <EarTagFilterInput value={filter} onChange={setFilter} />
      )}

      <ul className="space-y-2">
        {(visibleAnimals ?? []).map((a) => (
          <li key={a.animal_id} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
            <div className="flex-1">
              <div className="font-semibold text-gray-800">{a.ear_tag}</div>
              {a.last_weight != null && (
                <div className="text-xs text-gray-500">zuletzt {num(a.last_weight)} kg</div>
              )}
            </div>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="kg"
              value={weights[a.animal_id] ?? ''}
              onChange={(e) => setWeights((w) => ({ ...w, [a.animal_id]: e.target.value }))}
              className="w-28 rounded border border-gray-300 px-3 py-3 text-right text-xl font-semibold"
            />
          </li>
        ))}
      </ul>

      {animals && animals.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-10 border-t bg-white p-3">
          <div className="mx-auto max-w-2xl">
            {savedMsg && <p className="mb-2 text-center text-sm text-green-700">{savedMsg}</p>}
            <button
              onClick={handleSave}
              disabled={saving || filledCount === 0}
              className="w-full rounded-lg bg-brand-700 py-3 text-base font-semibold text-white active:bg-brand-800 disabled:opacity-50"
            >
              {saving ? 'Speichert…' : `${filledCount} Gewichte speichern`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
