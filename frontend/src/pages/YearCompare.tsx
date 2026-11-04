import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtNum, MONTHS, sectionSeries, type YearSection, type YearSeries } from '@fmis/core/yearSummary'

export type YearSections = { key: string; section: YearSection | null }[]

// Jahre als eine Farbe, älter = heller; das gewählte (jüngste) Jahr am dunkelsten
const RAMP = ['#104281', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6']
const AXIS = { fontSize: 11, fill: '#6b7280' }
const PREF = 'fmis:jahresvergleich'

type Option = { id: string; group: string; series: YearSeries }

function loadPref(): { id?: string; sum?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PREF) ?? '{}') as { id?: string; sum?: boolean }
  } catch {
    return {}
  }
}

/** Monatswerte mehrerer Jahre übereinander: eine Linie je Jahr, je Monat
 * oder aufsummiert. Grössen aus ModuleDescriptor.yearSummary (sectionSeries). */
export default function YearCompare({ byYear, today }: { byYear: Map<number, YearSections>; today: string }) {
  const [pref, setPrefState] = useState(loadPref)
  const setPref = (p: { id?: string; sum?: boolean }) => {
    const next = { ...pref, ...p }
    setPrefState(next)
    try {
      localStorage.setItem(PREF, JSON.stringify(next))
    } catch {
      /* nur Bequemlichkeit */
    }
  }
  const years = [...byYear.keys()].sort((a, b) => a - b)

  // alle Grössen, die in mindestens einem Jahr vorkommen; Gruppe = Modul
  const options = useMemo(() => {
    const out = new Map<string, Option>()
    for (const y of [...years].reverse())
      for (const { key, section } of byYear.get(y) ?? [])
        if (section)
          for (const s of sectionSeries(section)) {
            const id = `${key}:${s.key}`
            if (!out.has(id)) out.set(id, { id, group: section.title, series: s })
          }
    return [...out.values()]
  }, [byYear, years])

  const selected = options.find((o) => o.id === pref.id) ?? options[0]
  if (!selected) return null
  const sum = selected.series.summable && !!pref.sum
  const [moduleKey, seriesKey] = [selected.id.slice(0, selected.id.indexOf(':')), selected.id.slice(selected.id.indexOf(':') + 1)]
  const nowYear = Number(today.slice(0, 4))
  const nowMonth = Number(today.slice(5, 7)) - 1

  // Werte je Jahr; Jahre ohne diese Grösse fallen weg, Monate nach heute bleiben leer
  const lines = years
    .map((y) => {
      const section = byYear.get(y)?.find((s) => s.key === moduleKey)?.section
      const s = section ? sectionSeries(section).find((x) => x.key === seriesKey) : undefined
      if (!s || s.values.every((v) => !v)) return null
      let run = 0
      const values = s.values.map((v, i) => {
        if (y === nowYear && i > nowMonth) return null
        if (!sum) return v
        run += v ?? 0
        return Math.round(run * 10) / 10
      })
      return { year: y, values }
    })
    .filter((l): l is { year: number; values: (number | null)[] } => l != null)
  const data = MONTHS.map((name, i) => Object.fromEntries([['name', name], ...lines.map((l) => [String(l.year), l.values[i]])]))
  const colorOf = (y: number) => RAMP[Math.min(RAMP.length - 1, years[years.length - 1] - y)]
  const digits = lines.some((l) => l.values.some((v) => v != null && !Number.isInteger(v))) ? 1 : 0
  const groups = [...new Set(options.map((o) => o.group))]

  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-bold text-gray-800">
          <span className="mr-1">📈</span>Jahre vergleichen
        </h2>
        <select
          value={selected.id}
          onChange={(e) => setPref({ id: e.target.value })}
          aria-label="Grösse"
          className="min-h-11 min-w-0 max-w-full rounded-lg border-2 border-gray-300 bg-white px-2 text-sm"
        >
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.series.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <div className="flex rounded-lg border-2 border-gray-300 text-sm" role="group" aria-label="Darstellung">
          {(
            [
              [false, 'je Monat'],
              [true, 'aufsummiert'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={sum === v}
              disabled={v && !selected.series.summable}
              onClick={() => setPref({ sum: v })}
              className={`min-h-10 px-3 font-medium disabled:opacity-40 ${sum === v ? 'bg-brand-700 text-white' : 'text-gray-700'}`}
              title={v && !selected.series.summable ? 'Mittelwerte lassen sich nicht aufsummieren' : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">Keine Werte in {years[0]}–{years[years.length - 1]}.</p>
      ) : (
        <figure>
          <figcaption className="mb-1 text-xs font-semibold text-gray-600">
            {selected.series.title}
            {sum ? ', aufsummiert' : ''} <span className="font-normal text-gray-400">({selected.series.unit})</span>
          </figcaption>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="#eef0f2" />
              <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} tickFormatter={(m: string) => m.slice(0, 1)} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={digits > 0} width={56} tickFormatter={(v: number) => fmtNum(v, Number.isInteger(v) ? 0 : 1)} />
              <Tooltip
                formatter={(v, name) => [`${fmtNum(Number(v), digits)} ${selected.series.unit}`, name]}
                itemSorter={(item) => -Number(item.dataKey)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-gray-700">{v}</span>} />
              {lines.map((l) => (
                <Line
                  key={l.year}
                  dataKey={String(l.year)}
                  stroke={colorOf(l.year)}
                  strokeWidth={l.year === years[years.length - 1] ? 3 : 2}
                  dot={{ r: 2.5, strokeWidth: 0, fill: colorOf(l.year) }}
                  activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  connectNulls={!selected.series.summable}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <table className="sr-only">
            <thead>
              <tr>
                <th>Monat</th>
                {lines.map((l) => (
                  <th key={l.year}>{l.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((m, i) => (
                <tr key={m}>
                  <th>{m}</th>
                  {lines.map((l) => (
                    <td key={l.year}>{l.values[i] == null ? '–' : fmtNum(l.values[i]!, digits)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}
      <p className="text-xs text-gray-500">
        {years[0]}–{years[years.length - 1]}, das gewählte Jahr am dunkelsten. Aus den Daten auf diesem Gerät.
      </p>
    </section>
  )
}
