// Ausführende Person (Klauen, Trächtigkeit): Eingabe mit Schnellauswahl. Zuoberst die zuletzt eingesetzten Personen,
// darunter alle alphabetisch (bisherige Einträge + Personen aus dem Dienstplan, Modul Betrieb), mit Suchfilter.

import { useEffect, useMemo, useState } from 'react'
import { getSyncedDb as getBetriebDb } from '@fmis/betrieb/db/access'

/** Personen aus dem Dienstplan (aktiv); ohne Recht auf das Modul Betrieb leer. */
function useDutyPeople(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let live = true
    getBetriebDb()
      .then((pg) => pg.query<{ name: string }>('select name from duty_people where deleted_at is null and active'))
      .then((r) => live && setNames(r.rows.map((x) => x.name.trim()).filter(Boolean)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return names
}

const norm = (s: string) => s.toLocaleLowerCase('de-CH').normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Liste für die Auswahl: zuletzt eingesetzte (max. `recentMax`) und alle alphabetisch, gefiltert nach `query`. */
export function personOptions(recent: string[], others: string[], query: string, recentMax = 4): { recent: string[]; all: string[] } {
  const q = norm(query.trim())
  const hit = (n: string) => !q || norm(n).includes(q)
  const seen = new Map<string, string>()
  for (const n of [...recent, ...others]) {
    const t = n.trim()
    if (t && !seen.has(norm(t))) seen.set(norm(t), t)
  }
  return {
    recent: recent.filter(hit).slice(0, recentMax),
    all: [...seen.values()].filter(hit).sort((a, b) => a.localeCompare(b, 'de-CH')),
  }
}

export default function PersonPicker({
  id,
  value,
  onChange,
  recent,
  placeholder,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  /** bisherige Ausführende, zuletzt eingesetzte zuerst */
  recent: string[]
  placeholder?: string
}) {
  const people = useDutyPeople()
  const [open, setOpen] = useState(false)
  // Filter erst, wenn getippt wird; ein schon gewählter Name zeigt die ganze Liste
  const [typed, setTyped] = useState(false)
  const opts = useMemo(() => personOptions(recent, people, typed ? value : ''), [recent, people, value, typed])
  const chip = (on: boolean) => `min-h-11 shrink-0 rounded-full border-2 px-3 text-sm ${on ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-400 bg-white text-gray-800'}`
  const pick = (n: string) => {
    onChange(n)
    setTyped(false)
    setOpen(false)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          id={id}
          className="min-h-12 min-w-0 flex-1 rounded-lg border-2 border-gray-400 px-3 text-base text-gray-900 focus:border-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setTyped(true)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={id ? `${id}-liste` : undefined}
        />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Liste schliessen' : 'Alle Personen zeigen'} className="min-h-12 shrink-0 rounded-lg border-2 border-gray-400 bg-white px-3 text-gray-800">
          {open ? '▴' : '▾'}
        </button>
      </div>
      {opts.recent.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Zuletzt eingesetzt">
          {opts.recent.map((n) => (
            <button key={n} type="button" className={chip(value.trim() === n)} onClick={() => pick(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
      {open && (
        <ul id={id ? `${id}-liste` : undefined} role="listbox" className="max-h-56 divide-y overflow-y-auto rounded-lg border-2 border-gray-300 bg-white">
          {opts.all.map((n) => (
            <li key={n} role="option" aria-selected={value.trim() === n}>
              <button type="button" onClick={() => pick(n)} className={`flex min-h-11 w-full items-center px-3 text-left ${value.trim() === n ? 'bg-brand-50 font-semibold' : ''}`}>
                {n}
              </button>
            </li>
          ))}
          {opts.all.length === 0 && <li className="px-3 py-2 text-sm text-gray-600">{value.trim() ? `Neu: «${value.trim()}» wird so übernommen.` : 'Noch keine Personen erfasst.'}</li>}
        </ul>
      )}
    </div>
  )
}
