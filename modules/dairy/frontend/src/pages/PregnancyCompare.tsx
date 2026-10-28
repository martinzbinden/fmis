import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { shortEarTag } from '@fmis/core/earTag'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, isoDate, num } from '../lib/format'
import { agreement, classifyAgreement, compareRounds, fmtDuration, fmtTimeRange, groupRounds, METHOD_LABEL, METHOD_RANK, RESULT_LABEL } from '../lib/pregnancy'
import type { AgreementClass, RoundSummary } from '../lib/pregnancy'
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

const roundLabel = (r: RoundSummary) =>
  `${fmtDate(r.date)} ${fmtTimeRange(r.first, r.last)} · ${r.examiner || 'ohne Angabe'}${r.method ? ` · ${METHOD_ICON[r.method]} ${METHOD_LABEL[r.method]}` : ''}`

type Filter = 'diff' | 'gleich' | AgreementClass | null

/** Trächtigkeits-Durchgänge nebeneinander, z.B. eigene Einschätzung gegen den Ultraschall des Tierarztes. */
export default function PregnancyCompare() {
  const { data } = useQuery(loadData)
  const animals = useMemo(() => new Map((data?.animals ?? []).map((a) => [a.id, a])), [data])
  const checks = useMemo(() => data?.checks ?? [], [data])
  const rounds = useMemo(() => groupRounds(checks), [checks])
  const [picked, setPicked] = useState<string[] | null>(null)
  const [filter, setFilter] = useState<Filter>(null)
  const [refPick, setRefPick] = useState<string | null>(null)
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

  // Auswertung bei genau zwei Durchgängen: Massstab ist standardmässig die genauere Methode, sonst der spätere
  const pair = columns.length === 2
  const rank = (r: RoundSummary) => (r.method ? METHOD_RANK[r.method] : 0)
  const refIdx = !pair ? -1 : refPick && columns.some((c) => c.id === refPick) ? columns.findIndex((c) => c.id === refPick) : rank(columns[0]) > rank(columns[1]) ? 0 : 1
  const testIdx = 1 - refIdx
  const classOf = (cells: (PregnancyCheck | undefined)[]) => classifyAgreement(cells[testIdx]?.result, cells[refIdx]?.result)
  const stats = pair ? agreement(rows.map((r) => [r.cells[testIdx]?.result, r.cells[refIdx]?.result])) : null
  const activeFilter: Filter = !pair && filter !== 'diff' ? null : filter
  const matches = (r: (typeof rows)[number]) => {
    if (activeFilter === 'diff') return r.differs
    const k = classOf(r.cells)
    return activeFilter === 'gleich' ? k === 'tp' || k === 'tn' : k === activeFilter
  }
  const shown = activeFilter === null ? rows : rows.filter(matches)
  const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)} %`)

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
                <span className="block text-xs opacity-90">{fmtTimeRange(r.first, r.last)}</span>
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
          {stats && (
            <section className="space-y-2 rounded-xl bg-white p-3 shadow-sm" aria-label="Auswertung">
              <h2 className="font-semibold text-gray-900">Auswertung</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-gray-800">
                    <span className="text-gray-600">Geprüft:</span> {roundLabel(columns[testIdx])}
                  </p>
                  <p className="text-gray-800">
                    <span className="text-gray-600">Massstab:</span> <b>{roundLabel(columns[refIdx])}</b>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRefPick(columns[testIdx].id)
                    setFilter(null)
                  }}
                  className="min-h-11 shrink-0 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-medium text-gray-800"
                >
                  ⇄ tauschen
                </button>
              </div>
              <p className="text-sm text-gray-800">
                {stats.both} {stats.both === 1 ? 'Tier' : 'Tiere'} in beiden Durchgängen
                {stats.nur_eine > 0 && <span className="text-gray-600"> · {stats.nur_eine} nur in einem</span>}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    { key: 'gleich', label: 'gleich', value: stats.tp + stats.tn, sub: `${pct(stats.agreeRate)} · ${stats.tp} trächtig, ${stats.tn} leer`, tone: 'border-green-600 text-green-800' },
                    { key: 'fp', label: 'falsch positiv', value: stats.fp, sub: 'trächtig beurteilt, aber leer', tone: 'border-red-600 text-red-800' },
                    { key: 'fn', label: 'falsch negativ', value: stats.fn, sub: 'leer beurteilt, aber trächtig', tone: 'border-red-600 text-red-800' },
                    { key: 'unsicher', label: 'unsicher', value: stats.unsicher, sub: 'in einem der beiden', tone: 'border-amber-500 text-amber-800' },
                  ] as const
                ).map((t) => {
                  const on = activeFilter === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFilter(on ? null : t.key)}
                      className={`min-h-11 rounded-xl border-2 px-3 py-2 text-left ${t.tone} ${on ? 'bg-gray-100 ring-2 ring-brand-700' : 'bg-white'}`}
                    >
                      <span className="block text-xs font-semibold uppercase tracking-wide">{t.label}</span>
                      <span className="block text-2xl font-bold tabular-nums leading-tight">{t.value}</span>
                      <span className="block text-xs text-gray-700">{t.sub}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-sm text-gray-800">
                Trächtige erkannt: <b>{pct(stats.sensitivity)}</b> ({stats.tp} von {stats.tp + stats.fn}) · Leere erkannt: <b>{pct(stats.specificity)}</b> ({stats.tn} von {stats.tn + stats.fp})
              </p>
              <p className="text-xs text-gray-600">Ohne unsichere Ergebnisse gerechnet. Kachel antippen, um die Tiere in der Tabelle zu zeigen.</p>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-800">
              {rows.length} {rows.length === 1 ? 'Tier' : 'Tiere'}{columns.length > 1 ? `, ${both.length} in mehreren Durchgängen: ${both.length - both.filter((r) => r.differs).length} gleich, ` : ''}
              {columns.length > 1 && <b className="text-amber-800">{differing} abweichend</b>}
            </span>
            {columns.length > 1 && (
              <label className="ml-auto flex min-h-11 items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={activeFilter === 'diff'} onChange={(e) => setFilter(e.target.checked ? 'diff' : null)} />
                nur Abweichungen
              </label>
            )}
          </div>
          {columns.length > 2 && <p className="px-1 text-xs text-gray-600">Für die Auswertung (falsch positiv/negativ) genau zwei Durchgänge wählen.</p>}

          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-semibold text-gray-800">Tier</th>
                  {columns.map((c) => (
                    <th key={c.id} className="min-w-[5.5rem] px-2 py-2 text-center align-bottom font-normal text-gray-800">
                      <span className="block font-semibold">{fmtDate(c.date)}</span>
                      <span className="block text-xs text-gray-600">{fmtTimeRange(c.first, c.last)}</span>
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
                      {activeFilter ? 'Keine Tiere in dieser Auswahl.' : 'Keine Einträge.'}
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
