import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import YearBarsChart from '@fmis/core/YearBarsChart'
import { fmtNum, MONTHS } from '@fmis/core/yearSummary'
import { useQuery } from '../hooks/useQuery'
import { COUNTER_STYLE, COUNTER_TEXT } from '../components/CounterBadge'
import { todayIso } from '../lib/format'
import { loadHerdData } from '../lib/herds'
import { compositionAt, compositionText } from '../lib/herdModel'
import { accessIndex, groupYear, RAUS_SUMMER_WEIDE_DAYS, RAUS_WINTER_ACCESS_DAYS } from '../lib/outdoorAccess'

/** Weidenutzung je Monat: Gruppen × Monate mit Weide- und Laufhoftagen,
 * eingefärbt nach dem RAUS-Zähler, dazu Tier-Weidetage aller Gruppen. */
export default function GrazingYear() {
  const today = todayIso()
  const thisYear = Number(today.slice(0, 4))
  const [params, setParams] = useSearchParams()
  const year = Number(params.get('jahr')) || thisYear
  const setYear = (y: number) => setParams({ jahr: String(y) }, { replace: true })
  const { data, loading } = useQuery(() => loadHerdData(), [])

  const rows = useMemo(() => {
    if (!data) return []
    const idx = accessIndex(data)
    return data.groups
      .map((g) => ({ g, usage: groupYear(idx, g.id, year, today) }))
      .filter((r) => r.usage.some((u) => u.present > 0))
  }, [data, year, today])
  const monthly = MONTHS.map((name, i) => ({ name, value: rows.reduce((s, r) => s + r.usage[i].animalWeideDays, 0) }))
  const total = monthly.reduce((s, m) => s + m.value, 0)
  const compDate = year < thisYear ? `${year}-12-31` : today

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Weidenutzung</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-white shadow-sm" role="group" aria-label="Jahr wählen">
            <button type="button" onClick={() => setYear(year - 1)} className="grid h-11 w-11 place-items-center text-lg text-gray-600" aria-label="Vorjahr">
              ‹
            </button>
            <span className="min-w-[4rem] text-center text-lg font-bold text-gray-800">{year}</span>
            <button type="button" onClick={() => setYear(year + 1)} disabled={year >= thisYear} className="grid h-11 w-11 place-items-center text-lg text-gray-600 disabled:opacity-30" aria-label="Folgejahr">
              ›
            </button>
          </div>
          <Link to="/tiere/auslauf" className="link-btn text-sm text-brand-700">
            Auslaufjournal →
          </Link>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Je Gruppe und Monat: Weidetage, darunter Laufhoftage (L). Farbe nach RAUS: Sommer mindestens {RAUS_SUMMER_WEIDE_DAYS} Weidetage, Winter (November–April) {RAUS_WINTER_ACCESS_DAYS}{' '}
        Auslauftage, anteilig bei Gruppen ohne Tiere im ganzen Monat.
      </p>

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}
      {data && rows.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-gray-500 shadow-sm">Keine Gruppen mit Tieren in {year}.</p>}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-gray-500">
                  <th className="sticky left-0 z-10 bg-white p-1.5 text-left font-medium">Gruppe</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="min-w-10 p-1 text-center font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="p-1.5 text-right font-medium">Weidetage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ g, usage }) => {
                  const comp = compositionAt(g.id, data!.members, data!.counts, compDate)
                  return (
                    <tr key={g.id} className="border-t">
                      <td className="sticky left-0 z-10 max-w-40 bg-white p-1.5">
                        <span className="block truncate font-medium text-gray-800">{g.name}</span>
                        <span className="block truncate text-gray-500">{comp.total ? `${comp.total}: ${compositionText(comp)}` : '—'}</span>
                      </td>
                      {usage.map((u) => {
                        const c = u.counter
                        return (
                          <td key={u.month} className="border-l border-gray-100 p-0.5 text-center">
                            {u.present > 0 ? (
                              <span
                                className={`block rounded px-1 py-1 ${c ? COUNTER_STYLE[c.state] : ''}`}
                                title={`${u.weide} Weidetage, ${u.laufhof} Laufhoftage, ${u.present} Tage mit Tieren${c ? ` — RAUS ${c.done} von ${c.target}: ${COUNTER_TEXT[c.state]}` : ''}`}
                              >
                                <span className="block text-sm font-semibold">{u.weide}</span>
                                <span className="block text-[10px] leading-tight opacity-80">{u.laufhof ? `L ${u.laufhof}` : ' '}</span>
                              </span>
                            ) : (
                              <span className="block text-gray-300">·</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="p-1.5 text-right font-semibold tabular-nums text-gray-800">{fmtNum(usage.reduce((s, u) => s + u.weide, 0))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {(['erfuellt', 'knapp', 'offen', 'verfehlt'] as const).map((s) => (
              <span key={s} className={`rounded px-1.5 py-0.5 ${COUNTER_STYLE[s]}`}>
                {s === 'verfehlt' ? 'nicht erreicht' : COUNTER_TEXT[s]}
              </span>
            ))}
          </div>
          <section className="rounded-lg bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm text-gray-700">
              <b>{fmtNum(total)}</b> Tier-Weidetage {year} (Tiere × Tage auf der Weide, alle Gruppen)
            </p>
            <YearBarsChart chart={{ title: 'Tier-Weidetage je Monat', unit: 'Tier-Tage', kind: 'months', data: monthly }} />
          </section>
        </>
      )}
    </div>
  )
}
