import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import SidePanel from './SidePanel'
import { closePanel, openPanel, useOpenPanel } from './headerPanel'
import type { ModuleDescriptor } from './ModuleDescriptor'
import { animalProviders } from './animals'
import { readDigits, useTagReader } from './tagReader'
import TagReaderButton from './TagReaderButton'
import { clearSearchCache, readRecent, recordRecent, searchAll, SEARCH_GROUPS, type SearchGroup, type SearchHit } from './search'
import AppIcon from './AppIcon'

export const openSearch = () => openPanel('suche')

/** Lupe in der Kopfzeile (öffnet die Suche über alles). */
export function SearchButton({ className = '' }: { className?: string }) {
  const open = useOpenPanel() === 'suche'
  return (
    <button
      type="button"
      onClick={() => (open ? closePanel('suche') : openSearch())}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="Suchen: Tiere, Funktionen, Gruppen, Parzellen …"
      title="Suchen"
      className={`grid min-h-12 min-w-10 place-items-center rounded-full text-xl active:bg-gray-100 sm:min-w-12 ${open ? 'bg-gray-200' : ''} ${className}`}
    >
      <AppIcon icon="suche" size={30} />
    </button>
  )
}

/** Grosses Suchfeld (z.B. auf der Übersicht): sieht aus wie ein Feld, öffnet die Suche. */
export function SearchField() {
  return (
    <button
      type="button"
      onClick={openSearch}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-gray-300 bg-white px-4 text-left text-base text-gray-500 shadow-sm active:bg-gray-50"
    >
      <AppIcon icon="suche" size={30} />
      Suchen: Tier, Funktion, Gruppe, Parzelle …
    </button>
  )
}

const SHOWN = 5

/** Suche über den ganzen Betrieb als Seitenfenster (einmal in der App, frontend/src/App.tsx). */
export default function GlobalSearch({ modules }: { modules: ModuleDescriptor[] }) {
  const open = useOpenPanel() === 'suche'
  return (
    <SidePanel panel="suche" title="Suchen" wide>
      {open && <SearchBody modules={modules} />}
    </SidePanel>
  )
}

function SearchBody({ modules }: { modules: ModuleDescriptor[] }) {
  const [q, setQ] = useState('')
  const [abc, setAbc] = useState(false)
  const [groups, setGroups] = useState<{ group: SearchGroup; hits: SearchHit[] }[]>([])
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<SearchGroup>>(new Set())
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // frische Tierlisten bei jedem Öffnen
  useEffect(() => {
    clearSearchCache()
    input.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const term = q
    if (!term.trim()) {
      setGroups([])
      return
    }
    let stale = false
    setBusy(true)
    const t = setTimeout(() => {
      void searchAll(modules, term)
        .then((g) => !stale && setGroups(g))
        .finally(() => !stale && setBusy(false))
    }, 120)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q, modules])
  useEffect(() => setExpanded(new Set()), [q])

  // Lesegerät des aktuellen Tiermoduls (sonst des ersten)
  const readerModule = useMemo(() => {
    const keys = animalProviders().map(([k]) => k)
    const here = pathname.split('/')[1]
    return keys.includes(here) ? here : (keys[0] ?? '')
  }, [pathname])
  const reader = useTagReader({
    moduleKey: readerModule,
    onRead: (read) => {
      setAbc(false)
      setQ(readDigits(read))
      return `gelesen: ${read.earTag}`
    },
  })

  const go = (hit: Pick<SearchHit, 'to' | 'title' | 'icon'>, to = hit.to) => {
    recordRecent({ path: to, title: hit.title, icon: hit.icon })
    closePanel('suche')
    navigate(to)
  }
  const recent = readRecent().slice(0, 8)
  const first = groups[0]?.hits[0]

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (first) go(first)
        }}
      >
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode={abc ? 'search' : 'decimal'}
          enterKeyHint="go"
          autoComplete="off"
          placeholder={abc ? 'Name, Funktion, Parzelle …' : 'Nummer oder Geburtsdatum'}
          aria-label="Suchbegriff"
          className="min-h-14 min-w-0 flex-1 rounded-xl border-2 border-gray-300 px-4 text-lg"
        />
        <button
          type="button"
          onClick={() => {
            setAbc(!abc)
            input.current?.focus()
          }}
          aria-pressed={abc}
          title={abc ? 'Zifferntastatur' : 'Buchstaben-Tastatur'}
          className="min-h-14 min-w-14 rounded-xl border-2 border-gray-300 bg-white px-2 text-base font-semibold text-gray-700"
        >
          {abc ? '123' : 'ABC'}
        </button>
      </form>
      <TagReaderButton reader={reader} />

      {!q.trim() ? (
        recent.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold text-gray-600">Zuletzt geöffnet</h3>
            <ul className="grid grid-cols-2 gap-2">
              {recent.map((r) => (
                <li key={r.path}>
                  <Link
                    to={r.path}
                    onClick={(e) => {
                      e.preventDefault()
                      closePanel('suche')
                      navigate(r.path)
                    }}
                    className="flex min-h-14 items-center gap-2 rounded-xl bg-white px-3 py-1 shadow-sm active:bg-gray-50"
                  >
                    <AppIcon icon={r.icon ?? 'mehr'} size={30} />
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-sm font-semibold text-gray-800">{r.title}</span>
                      {r.sub && <span className="block truncate text-xs text-gray-600">{r.sub}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      ) : groups.length === 0 ? (
        <p className="text-base text-gray-600">{busy ? 'Suche …' : `Nichts gefunden für «${q.trim()}».`}</p>
      ) : (
        groups.map(({ group, hits }) => {
          const all = expanded.has(group)
          const shown = all ? hits : hits.slice(0, SHOWN)
          return (
            <section key={group}>
              <h3 className="mb-1 flex items-baseline justify-between text-sm font-semibold text-gray-600">
                {SEARCH_GROUPS[group]} <span className="font-normal">{hits.length}</span>
              </h3>
              <ul className="divide-y rounded-xl bg-white shadow-sm">
                {shown.map((h, i) => (
                  <li key={h.key}>
                    <Link
                      to={h.to}
                      onClick={(e) => {
                        e.preventDefault()
                        go(h)
                      }}
                      className="flex min-h-14 items-center gap-3 px-3 py-2 active:bg-gray-50"
                    >
                      <AppIcon icon={h.icon ?? 'mehr'} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-semibold text-gray-900">{h.title}</span>
                        {h.subtitle && <span className="block truncate text-sm text-gray-600">{h.subtitle}</span>}
                      </span>
                    </Link>
                    {/* Direktknöpfe nur bei den ersten drei Treffern, sonst wird die Liste lang */}
                    {h.actions && h.actions.length > 0 && i < 3 && (
                      <div className="flex flex-wrap gap-2 px-3 pb-2 pl-12">
                        {h.actions.map((a) => (
                          <Link
                            key={a.to}
                            to={a.to}
                            onClick={(e) => {
                              e.preventDefault()
                              go({ title: `${a.label}: ${h.title}`, icon: a.icon, to: a.to })
                            }}
                            className="flex min-h-12 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-800 active:bg-gray-100"
                          >
                            <AppIcon icon={a.icon} size={24} />
                            {a.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {hits.length > SHOWN && (
                <button
                  type="button"
                  onClick={() => setExpanded((s) => new Set(s).add(group))}
                  className={`mt-1 min-h-12 w-full rounded-lg text-sm font-semibold text-brand-700 active:bg-gray-100 ${all ? 'hidden' : ''}`}
                >
                  alle {hits.length} zeigen
                </button>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
