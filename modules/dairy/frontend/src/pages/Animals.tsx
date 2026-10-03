import { isDrySql } from '../lib/dryOff'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDate } from '../lib/format'
import AnimalTable, { matchesFilter, type AnimalRow } from '../components/AnimalTable'
import { animalKey, animalLabel } from '@fmis/core/earTag'
import { loadInbreeding } from '../lib/pedigreeData'

async function loadAnimals(pg: PGlite): Promise<AnimalRow[]> {
  const { rows } = await pg.query<AnimalRow>(`
    select a.*,
      (select count(*) from milk_tests mt where mt.animal_id = a.id and mt.deleted_at is null) as milk_test_count,
      (select count(*) from animal_journal j where j.animal_id = a.id and j.deleted_at is null) as journal_count,
      (select j.text from animal_journal j where j.animal_id = a.id and j.deleted_at is null
        order by j.entry_date desc, j.updated_at desc limit 1) as last_journal,
      ${isDrySql('a')} as dry
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
    dry: Boolean(r.dry),
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
  const { data, loading } = useQuery(loadAnimals)
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

      <Link to="/import" className="block rounded-lg bg-white p-4 text-sm shadow-sm active:bg-gray-50">
        <span className="font-semibold text-brand-700">📥 Daten importieren</span>
        <span className="block text-xs text-gray-500">
          Herdebuch-Export, TVD-Tierbestand{moduleKey === 'dairy' ? '' : ', SMG-Leistungsausweise'} — auf der zentralen Upload-Seite, die
          Dateien werden der richtigen Herde automatisch zugeordnet.
        </span>
      </Link>

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
              <span className="flex shrink-0 gap-1">
                {a.dry && a.status === 'aktiv' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">trocken</span>}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    a.status === 'aktiv' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {a.status}
                </span>
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
