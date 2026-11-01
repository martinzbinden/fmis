import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { Animal } from '../types'
import { useQuery } from '../hooks/useQuery'
import { ANIMAL_SORTS, loadAnimalFacts, sortAnimals, sortDate, sortLabel, type AnimalSort } from '../lib/animalSort'
import { fmtDate } from '../lib/format'
import { speciesOf } from '../lib/species'
import { animalLabel, shortEarTag } from '@fmis/core/earTag'
import AnimalOption from '@fmis/core/AnimalOption'
import { matchRead, useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'

/** Tierauswahl per Laufnummer, Name oder Ohrmarke — für die Erfassungs-
 * formulare. Mit `multiple` mehrere Tiere (z.B. eine Belegperiode für die
 * ganze Gruppe). Mit `readerModule` auch per Lesegerät: jede Lesung wählt
 * das Tier (bei `multiple` kommt es dazu; schon gewählte Tiere werden ignoriert,
 * ein wieder entferntes Tier zählt beim nächsten Lesen wieder). */
export default function AnimalPicker({
  animals,
  selected,
  onChange,
  multiple = false,
  placeholder = 'Laufnummer, Name oder Ohrmarke',
  readerModule,
}: {
  animals: Animal[]
  selected: string[]
  onChange: (ids: string[]) => void
  multiple?: boolean
  placeholder?: string
  readerModule?: string
}) {
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return animals
      .filter((a) => !selected.includes(a.id))
      .map((a) => {
        const nr = (a.lauf_nr ?? '').toLowerCase()
        const score = nr === q ? 0 : nr.startsWith(q) ? 1 : (a.name ?? '').toLowerCase().includes(q) ? 2 : a.ear_tag.toLowerCase().includes(q.replace(/[.\s]/g, '')) ? 3 : 9
        return { a, score }
      })
      .filter((m) => m.score < 9)
      .sort((x, y) => x.score - y.score || (x.a.lauf_nr ?? '').localeCompare(y.a.lauf_nr ?? ''))
      .slice(0, 8)
      .map((m) => m.a)
  }, [animals, query, selected])

  function pick(id: string) {
    onChange(multiple ? [...selected, id] : [id])
    setQuery('')
  }

  const label = (a: Animal) => `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${animalLabel(a)}`

  const reader = useTagReader({
    moduleKey: readerModule ?? '',
    duplicate: (read) => {
      const a = matchRead(read, animals)
      return a && selected.includes(a.id) ? `${label(a)} schon gewählt` : null
    },
    onRead: (read) => {
      const a = matchRead(read, animals)
      if (!a) return { text: `${shortEarTag(read.earTag)}: nicht in der Auswahl`, tone: 'error' }
      if (!selected.includes(a.id)) pick(a.id)
      return multiple ? `${label(a)} dazu (${selected.length + (selected.includes(a.id) ? 0 : 1)} gewählt)` : `${label(a)} gewählt`
    },
  })

  return (
    <div>
      {readerModule && (
        <div className="mb-2">
          <TagReaderButton reader={reader} hint={multiple ? 'jede Lesung kommt dazu' : undefined} />
        </div>
      )}
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const a = byId.get(id)
            return (
              <span key={id} className="flex items-center gap-1 rounded-full bg-brand-100 py-0.5 pl-3 text-sm font-medium text-brand-900">
                {a ? label(a) : id}
                {/* ganze 44-px-Fläche antippbar — der einzige Weg, ein falsches Tier zu entfernen */}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((x) => x !== id))}
                  className="grid h-11 w-11 place-items-center rounded-full text-lg text-brand-700 active:bg-brand-200"
                  aria-label={`${a ? label(a) : id} entfernen`}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
      {(multiple || selected.length === 0) && (
        <>
          <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                e.preventDefault()
                pick(matches[0].id)
              }
            }}
            placeholder={placeholder}
            inputMode="search"
            autoComplete="off"
            aria-label="Tier suchen (Laufnummer, Name oder Ohrmarke)"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-3 text-base"
          />
          <button
            type="button"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
            className={`shrink-0 rounded-lg border px-3 text-sm font-medium ${listOpen ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-800'}`}
          >
            ☰ Liste
          </button>
          </div>
          {listOpen && (
            <AnimalListPanel
              animals={animals}
              selected={selected}
              onPick={(id) => {
                pick(id)
                if (!multiple) setListOpen(false)
              }}
            />
          )}
          {query.trim() && matches.length === 0 && (
            // beim Start am Handy braucht die Ablage Sekunden — nicht «gibt es nicht» vortäuschen
            <p className="mt-1 px-1 text-sm text-gray-600">{animals.length === 0 ? 'Tiere werden geladen …' : `Kein Tier mit «${query.trim()}».`}</p>
          )}
          {matches.length > 0 && (
            <ul className="mt-1 divide-y rounded-lg border border-gray-200 bg-white">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => pick(a.id)} className="flex w-full px-3 py-2.5 text-left active:bg-gray-50">
                    <AnimalOption animal={a} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function loadSort(): AnimalSort {
  try {
    const v = localStorage.getItem('dairy_picker_sort') as AnimalSort | null
    return v && ANIMAL_SORTS.includes(v) ? v : 'geburt'
  } catch {
    return 'geburt'
  }
}

/** Alle Tiere als Liste, sortiert z.B. nach zuletzt abgelammt oder zuletzt
 * behandelt — wenn man die Nummer nicht weiss («die, die gestern gelammt hat»). */
export function AnimalListPanel({ animals, selected, onPick }: { animals: Animal[]; selected: string[]; onPick: (id: string) => void }) {
  const species = speciesOf(useLocation().pathname.split('/')[1] ?? '')
  const { data: facts } = useQuery(loadAnimalFacts)
  const [sort, setSort] = useState<AnimalSort>(loadSort)
  const [limit, setLimit] = useState(30)
  const list = useMemo(() => sortAnimals(animals.filter((a) => !selected.includes(a.id)), facts, sort), [animals, selected, facts, sort])
  const word = { nr: '', geburt: species === 'sheep' ? 'abgelammt' : 'abgekalbt', jung: 'geb.', behandelt: 'behandelt' }[sort]

  function changeSort(v: AnimalSort) {
    setSort(v)
    setLimit(30)
    try {
      localStorage.setItem('dairy_picker_sort', v)
    } catch {
      // nur bis zum Reload
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap gap-1.5 border-b p-2" role="radiogroup" aria-label="Sortierung">
        {ANIMAL_SORTS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={sort === k}
            onClick={() => changeSort(k)}
            className={`min-h-11 rounded-full border px-3 text-sm ${sort === k ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-800'}`}
          >
            {sortLabel(k, species)}
          </button>
        ))}
      </div>
      {!facts && sort !== 'nr' && <p className="px-3 py-2 text-sm text-gray-600">Lädt …</p>}
      <ul className="max-h-80 divide-y overflow-y-auto">
        {list.slice(0, limit).map((a) => {
          const d = sortDate(a, facts, sort)
          return (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a.id)} className="flex min-h-12 w-full items-center px-3 py-2 text-left active:bg-gray-50">
                <span className="block w-full">
                  <AnimalOption animal={a} />
                  {sort !== 'nr' && sort !== 'jung' && <span className="block text-sm text-gray-700">{d ? `${word} ${fmtDate(d)}` : `nie ${word}`}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {list.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + 50)} className="min-h-11 w-full border-t text-sm font-medium text-brand-700">
          weitere {Math.min(50, list.length - limit)} von {list.length - limit} anzeigen
        </button>
      )}
    </div>
  )
}
