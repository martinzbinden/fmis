import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { shortEarTag } from '@fmis/core/earTag'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, isoDate, num } from '../lib/format'
import { compareRounds, fmtDuration, groupRounds, METHOD_LABEL, RESULT_LABEL } from '../lib/pregnancy'
import type { Animal, PregnancyCheck, PregnancyMethod, PregnancyResult } from '../types'

async function loadData(pg: PGlite) {
  const [animals, checks] = await Promise.all([
    pg.query<Animal>('select * from animals where deleted_at is null'),
    pg.query<PregnancyCheck>('select * from pregnancy_checks where deleted_at is null'),
  ])
  return {
    animals: animals.rows,
    checks: checks.rows.map((c) => ({
      ...c,
      check_date: isoDate(c.check_date)!,
      weeks: num(c.weeks),
      recorded_at: (c.recorded_at as unknown) instanceof Date ? (c.recorded_at as unknown as Date).toISOString() : String(c.recorded_at),
    })),
  }
}

const ICON: Record<PregnancyResult, { icon: string; cls: string }> = {
  ja: { icon: '✓', cls: 'text-green-600' },
  nein: { icon: '✗', cls: 'text-red-600' },
  unsicher: { icon: '?', cls: 'text-amber-500' },
}
const METHOD_ICON: Record<PregnancyMethod, string> = { auge: '👁', farbtupfer: '🎨', ultraschall: '🔊' }

/** Trächtigkeits-Durchgänge nebeneinander, z.B. eigene Einschätzung gegen den Ultraschall des Tierarztes. */
export default function PregnancyCompare() {
  const { data } = useQuery(loadData)
  const animals = useMemo(() => new Map((data?.animals ?? []).map((a) => [a.id, a])), [data])
  const checks = useMemo(() => data?.checks ?? [], [data])
  const rounds = useMemo(() => groupRounds(checks), [checks])
  const [picked, setPicked] = useState<string[] | null>(null)
  const [onlyDiff, setOnlyDiff] = useState(false)
  // Standard: die zwei neuesten Durchgänge; Spalten zeitlich geordnet (ältester links)
  const selected = (picked ?? rounds.slice(0, 2).map((r) => r.id)).filter((id) => rounds.some((r) => r.id === id))
  const columns = rounds.filter((r) => selected.includes(r.id)).reverse()
  const rows = useMemo(() => {
    const sortKey = (id: string) => {
      const a = animals.get(id)
      return `${(a?.lauf_nr ?? '').padStart(8, '~')}${shortEarTag(a?.ear_tag ?? '')}`
    }
    return compareRounds(checks, columns.map((c) => c.id)).sort((x, y) => sortKey(x.animal_id).localeCompare(sortKey(y.animal_id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks, animals, columns.map((c) => c.id).join()])
  const both = rows.filter((r) => r.cells.filter(Boolean).length > 1)
  const differing = rows.filter((r) => r.differs).length
  const shown = onlyDiff ? rows.filter((r) => r.differs) : rows

  function toggle(id: string) {
    setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">Trächtigkeit vergleichen</h1>
        <Link to=".." relative="path" className="min-h-11 shrink-0 content-center rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-medium text-gray-800">
          ‹ Erfassen
        </Link>
      </div>

      <section className="space-y-1.5">
        <h2 className="px-1 text-sm font-semibold text-gray-700">Durchgänge (Spalten)</h2>
        <div className="flex flex-wrap gap-1.5">
          {rounds.map((r) => {
            const on = selected.includes(r.id)
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r.id)}
                className={`min-h-11 rounded-xl border-2 px-3 py-1 text-left text-sm ${on ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-800'}`}
              >
                <span className="block font-semibold">
                  {fmtDate(r.date)} {r.method ? METHOD_ICON[r.method] : ''}
                </span>
                <span className="block text-xs opacity-90">
                  {r.examiner || 'ohne Angabe'} · {r.count} {r.count === 1 ? 'Tier' : 'Tiere'}
                </span>
              </button>
            )
          })}
          {data && rounds.length === 0 && <p className="text-sm text-gray-700">Noch keine Untersuchungen erfasst.</p>}
        </div>
      </section>

      {columns.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-800">
              {rows.length} {rows.length === 1 ? 'Tier' : 'Tiere'}{columns.length > 1 ? `, ${both.length} in mehreren Durchgängen: ${both.length - both.filter((r) => r.differs).length} gleich, ` : ''}
              {columns.length > 1 && <b className="text-amber-800">{differing} abweichend</b>}
            </span>
            {columns.length > 1 && (
              <label className="ml-auto flex min-h-11 items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
                nur Abweichungen
              </label>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-semibold text-gray-800">Tier</th>
                  {columns.map((c) => (
                    <th key={c.id} className="min-w-[5.5rem] px-2 py-2 text-center align-bottom font-normal text-gray-800">
                      <span className="block font-semibold">{fmtDate(c.date)}</span>
                      <span className="block text-xs">{c.examiner || 'ohne Angabe'}</span>
                      <span className="block text-xs text-gray-600">{c.method ? `${METHOD_ICON[c.method]} ${METHOD_LABEL[c.method]}` : ''}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const a = animals.get(r.animal_id)
                  return (
                    <tr key={r.animal_id} className={`border-b border-gray-200 last:border-0 ${r.differs ? 'bg-amber-50' : ''}`}>
                      <td className={`sticky left-0 z-10 px-2 py-1.5 ${r.differs ? 'bg-amber-50' : 'bg-white'}`}>
                        <span className="block font-semibold text-gray-900">{a?.lauf_nr ?? shortEarTag(a?.ear_tag ?? '')}</span>
                        {a?.lauf_nr && <span className="block text-xs text-gray-600">{shortEarTag(a.ear_tag)}</span>}
                      </td>
                      {r.cells.map((c, i) => (
                        <td key={columns[i].id} className="px-2 py-1.5 text-center">
                          {c ? (
                            <>
                              <span className={`block text-2xl font-bold leading-none ${ICON[c.result].cls}`} title={RESULT_LABEL[c.result]} aria-label={RESULT_LABEL[c.result]}>
                                {ICON[c.result].icon}
                              </span>
                              {c.weeks != null && <span className="block text-xs tabular-nums text-gray-700">{fmtDuration(c.weeks, c.duration_unit)}</span>}
                            </>
                          ) : (
                            <span className="text-gray-400">–</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 1} className="px-3 py-3 text-gray-700">
                      {onlyDiff ? 'Keine Abweichungen.' : 'Keine Einträge.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-1 text-xs text-gray-600">
            <span className="font-bold text-green-600">✓</span> trächtig · <span className="font-bold text-red-600">✗</span> leer · <span className="font-bold text-amber-500">?</span> unsicher · – nicht untersucht. Gelb: Ergebnisse weichen ab.
          </p>
        </>
      )}
    </div>
  )
}
