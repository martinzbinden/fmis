import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Modal from '../Modal'
import { currentPart, describeCondition, suggest, type ParsedQuery, type QueryField, type Suggestion } from './engine'

export interface QueryExample {
  q: string
  text: string
}

/** Suchfeld einer Liste mit Lupe, Vorschlägen beim Tippen (Felder, Vergleiche, Auswahlwerte) und Hilfe (ⓘ). Nummer oder Name
 * suchen wie bisher; Formeln wie «ZZ > 200» filtern nach Angaben (query/engine.ts). */
export default function QueryInput<R, C>({
  fields,
  value,
  onChange,
  choices = {},
  examples,
  placeholder = 'Suchen oder Formel, z.B. ZZ > 200',
  intro,
  extraHelp,
  className = '',
}: {
  fields: QueryField<R, C>[]
  value: string
  onChange: (v: string) => void
  /** Werte der Auswahlfelder je Feldschlüssel (z.B. Gruppennamen) */
  choices?: Record<string, string[]>
  examples: QueryExample[]
  placeholder?: string
  /** Satz oben in der Hilfe: was die Liste durchsucht */
  intro?: ReactNode
  extraHelp?: ReactNode
  className?: string
}) {
  const [focus, setFocus] = useState(false)
  const [active, setActive] = useState(-1)
  const [help, setHelp] = useState(false)
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const exampleSuggestions = useMemo<Suggestion[]>(() => examples.slice(0, 7).map((e) => ({ insert: e.q, label: e.text })), [examples])
  const suggestions = useMemo(() => suggest(fields, value, choices, exampleSuggestions), [fields, value, choices, exampleSuggestions])
  const open = focus && suggestions.length > 0

  function apply(insert: string) {
    onChange(`${currentPart(value).head}${insert}`)
    setActive(-1)
    input.current?.focus()
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <div className="relative">
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m13 13 4 4" />
        </svg>
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setActive(-1)
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setFocus(false)
            else if (open && e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % suggestions.length)
            } else if (open && e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1))
            } else if (open && e.key === 'Enter' && active >= 0) {
              e.preventDefault()
              apply(suggestions[active].insert)
            }
          }}
          placeholder={placeholder}
          aria-label="Suchen oder filtern"
          spellCheck={false}
          autoComplete="off"
          className="min-h-11 w-72 max-w-[60vw] rounded-lg border-2 border-gray-300 bg-white pl-8 pr-8 text-sm"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              input.current?.focus()
            }}
            aria-label="Eingabe löschen"
            className="absolute right-1 top-1/2 grid h-9 w-8 -translate-y-1/2 place-items-center rounded text-gray-500 active:bg-gray-100"
          >
            ✕
          </button>
        )}
        {open && (
          <ul id={listId} role="listbox" aria-label="Vorschläge" className="absolute left-0 z-30 mt-1 max-h-72 w-80 max-w-[90vw] overflow-y-auto rounded-xl border border-gray-300 bg-white py-1 shadow-xl">
            {suggestions.map((s, i) => (
              <li key={`${s.insert}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(s.insert)} className={`flex min-h-11 w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${i === active ? 'bg-brand-50' : 'active:bg-gray-100'}`}>
                  <span className="font-medium text-gray-900">{s.insert.trim() || s.label}</span>
                  <span className="truncate text-xs text-gray-600">{s.hint ? `${s.label} · ${s.hint}` : s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" onClick={() => setHelp(true)} aria-label="Hilfe zur Suche" title="Hilfe zur Suche und zu den Formeln" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-gray-300 bg-white text-lg font-bold text-brand-700 active:bg-gray-100">
        ⓘ
      </button>
      {help && (
        <QueryHelp
          fields={fields}
          examples={examples}
          intro={intro}
          extraHelp={extraHelp}
          onClose={() => setHelp(false)}
          onUse={(q) => {
            onChange(q)
            setHelp(false)
            input.current?.focus()
          }}
        />
      )}
    </div>
  )
}

/** Erkannte Bedingungen, Fehler und Freitext als Chips unter dem Suchfeld. */
export function QueryChips<R, C>({ parsed }: { parsed: ParsedQuery<R, C> }) {
  if (parsed.conditions.length === 0 && parsed.errors.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Erkannte Bedingungen der Suche">
      {parsed.conditions.map((c, i) => (
        <span key={`c${i}`} className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-900">
          {describeCondition(c)}
        </span>
      ))}
      {parsed.errors.map((e, i) => (
        <span key={`e${i}`} className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-900" title={e.text}>
          {e.reason}
        </span>
      ))}
      {parsed.free && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-800">Text: {parsed.free}</span>}
    </div>
  )
}

function QueryHelp<R, C>({ fields, examples, intro, extraHelp, onClose, onUse }: { fields: QueryField<R, C>[]; examples: QueryExample[]; intro?: ReactNode; extraHelp?: ReactNode; onClose: () => void; onUse: (q: string) => void }) {
  const nums = fields.filter((f) => f.kind === 'num')
  const flags = fields.filter((f) => f.kind === 'flag')
  const choices = fields.filter((f) => f.kind === 'choice')
  return (
    <Modal title="Suchen und filtern" onClose={onClose} dirty={false}>
      <div className="space-y-4 text-sm text-gray-800">
        <p>
          {intro ?? 'Im Suchfeld findest du Einträge nach Text.'} Zusätzlich kannst du nach Angaben filtern, mit einer kurzen Formel wie <b>{examples[0]?.q ?? 'Feld > Wert'}</b>. Beim Tippen schlägt das Feld Felder, Vergleiche und Werte vor.
        </p>

        <section>
          <h3 className="mb-1 font-semibold text-gray-900">Aufbau</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>Feld Vergleich Wert</b>, z.B. «{nums[0]?.example ?? 'Feld > 3'}». Vergleiche: <code>&gt;</code> <code>&gt;=</code> <code>&lt;</code> <code>&lt;=</code> <code>=</code> <code>!=</code>, oder Wörter: über, unter, ab, bis, ist.
            </li>
            <li>
              <b>Mehrere Bedingungen</b> verbindest du mit «und», «&amp;» oder «;». Es müssen alle zutreffen.
            </li>
            {flags.length > 0 && (
              <li>
                <b>Merkmale ohne Wert</b> schreibst du allein, z.B. «{flags[0].aliases[0]}».
              </li>
            )}
            <li>Was nicht als Bedingung erkannt wird, ist Freitext. Bei einem unbekannten Feld erscheint eine rote Meldung statt einer stillen Wirkung.</li>
            <li>Gross- und Kleinschreibung, Umlaute und Leerzeichen im Feldnamen spielen keine Rolle. Dezimalzahlen mit Punkt oder Komma. Fehlt die Angabe, trifft die Bedingung nicht zu.</li>
            <li>
              <b>Sortierung:</b> Passt eine Formel zu einem Zahlenfeld, schlägt die Liste die Sortierung danach vor (das Sortierfeld blinkt kurz). Du kannst eine andere wählen, und im Sortierfeld lässt sich die Automatik abschalten.
            </li>
          </ul>
        </section>

        {examples.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold text-gray-900">Beispiele (antippen zum Übernehmen)</h3>
            <ul className="divide-y rounded-lg border">
              {examples.map((e) => (
                <li key={e.q}>
                  <button type="button" onClick={() => onUse(e.q)} className="flex min-h-11 w-full items-baseline gap-3 px-3 py-1.5 text-left active:bg-gray-100">
                    <code className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-900">{e.q}</code>
                    <span className="text-gray-700">{e.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {nums.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold text-gray-900">Felder mit Zahlen</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-gray-600">
                    <th className="py-1 pr-2 font-semibold">Schreibweisen</th>
                    <th className="py-1 pr-2 font-semibold">Bedeutung</th>
                    <th className="py-1 font-semibold">Einheit</th>
                  </tr>
                </thead>
                <tbody>
                  {nums.map((f) => (
                    <tr key={f.key} className="border-b border-gray-100 align-top">
                      <td className="py-1 pr-2 font-medium text-gray-900">{f.aliases.slice(0, 3).join(', ')}</td>
                      <td className="py-1 pr-2">{f.label}</td>
                      <td className="py-1">{f.kind === 'num' && f.unit ? f.unit : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {flags.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold text-gray-900">Merkmale ohne Wert</h3>
            <p className="text-gray-700">{flags.map((f) => f.aliases[0]).join(', ')}</p>
          </section>
        )}

        {choices.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold text-gray-900">Auswahl</h3>
            <p className="text-gray-700">
              {choices.map((f) => `${f.aliases[0]} = Name`).join(' · ')}. «!=» schliesst aus, der Anfang des Namens genügt.
            </p>
          </section>
        )}
        {extraHelp}
      </div>
    </Modal>
  )
}
