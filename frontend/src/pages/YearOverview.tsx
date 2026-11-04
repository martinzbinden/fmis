import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import YearBarsChart from '@fmis/core/YearBarsChart'
import { localTodayIso } from '@fmis/core/dates'
import { errorText } from '@fmis/core/toast'
import type { YearSection } from '@fmis/core/yearSummary'
import YearCompare from './YearCompare'

type Loaded = { key: string; section: YearSection | null; error?: string }

/** Jahresübersicht: Kennzahlen und Diagramme aller aktiven Module für ein
 * Jahr (ModuleDescriptor.yearSummary), aus den Daten auf diesem Gerät. */
const COMPARE_YEARS = 5

export default function YearOverview({ modules }: { modules: ModuleDescriptor[] }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [sections, setSections] = useState<Loaded[] | null>(null)
  const [compare, setCompare] = useState<Map<number, Loaded[]> | null>(null)
  // je Jahr nur einmal laden (beim Blättern und für den Vergleich)
  const cache = useRef(new Map<number, Promise<Loaded[]>>())

  useEffect(() => {
    cache.current.clear()
  }, [modules])

  useEffect(() => {
    let alive = true
    const loadYear = (y: number) => {
      let p = cache.current.get(y)
      if (!p) {
        const providers = modules.filter((m) => m.yearSummary)
        p = Promise.all(
          providers.map((m) =>
            m.yearSummary!(y).then(
              (section): Loaded => ({ key: m.key, section }),
              (e): Loaded => ({ key: m.key, section: null, error: `${m.title}: ${errorText(e)}` }),
            ),
          ),
        )
        cache.current.set(y, p)
      }
      return p
    }
    setSections(null)
    setCompare(null)
    void loadYear(year).then((list) => {
      if (!alive) return
      setSections(list)
      // danach die Vorjahre für den Vergleich
      const years = Array.from({ length: COMPARE_YEARS }, (_, i) => year - COMPARE_YEARS + 1 + i)
      void Promise.all(years.map(loadYear)).then((all) => alive && setCompare(new Map(years.map((y, i) => [y, all[i]]))))
    })
    return () => {
      alive = false
    }
  }, [modules, year])

  const shown = (sections ?? []).filter((s) => s.section)
  const errors = (sections ?? []).filter((s) => s.error)

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Jahresübersicht</h1>
        <div className="flex items-center rounded-lg bg-white shadow-sm" role="group" aria-label="Jahr wählen">
          <button type="button" onClick={() => setYear((y) => y - 1)} className="grid h-11 w-11 place-items-center text-lg text-gray-600" aria-label="Vorjahr">
            ‹
          </button>
          <span className="min-w-[4rem] text-center text-lg font-bold text-gray-800">{year}</span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= thisYear + 1}
            className="grid h-11 w-11 place-items-center text-lg text-gray-600 disabled:opacity-30"
            aria-label="Folgejahr"
          >
            ›
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500">Aus den Daten auf diesem Gerät{year === thisYear ? ', laufendes Jahr bis heute' : ''}. Geplantes zählt nur bei der Fruchtfolge.</p>

      {!sections && <p className="text-center text-gray-500">Lädt…</p>}
      {sections && shown.length === 0 && <p className="text-center text-gray-500">Für {year} gibt es keine Daten.</p>}

      {sections && (compare?.has(year) ? <YearCompare byYear={compare} today={localTodayIso()} /> : <p className="text-xs text-gray-500">Vergleich mit den Vorjahren lädt…</p>)}

      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map(({ key, section }) => (
          <section key={key} className="min-w-0 space-y-3 rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-bold text-gray-800">
                <span className="mr-1">{section!.icon}</span>
                {section!.title}
              </h2>
              {section!.to && (
                <Link to={section!.to} className="link-btn shrink-0 text-sm text-brand-700">
                  öffnen →
                </Link>
              )}
            </div>
            {section!.figures.length > 0 && (
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {section!.figures.map((f) => (
                  <div key={f.label} className="rounded-lg bg-gray-50 px-3 py-2">
                    <dt className="text-xs text-gray-500">{f.label}</dt>
                    <dd className="text-lg font-bold leading-tight text-gray-900">{f.value}</dd>
                    {f.detail && <dd className="text-[11px] leading-tight text-gray-500">{f.detail}</dd>}
                  </div>
                ))}
              </dl>
            )}
            {section!.charts.map((c) => (
              <YearBarsChart key={c.title} chart={c} />
            ))}
            {section!.note && <p className="text-xs text-gray-500">{section!.note}</p>}
          </section>
        ))}
      </div>
      {errors.length > 0 && <p className="text-xs text-red-700">{errors.map((e) => e.error).join(' · ')}</p>}
    </div>
  )
}
