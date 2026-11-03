import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtNum, type YearBars } from './yearSummary'

const BAR = 'var(--brand-600)'
const AXIS = { fontSize: 11, fill: '#6b7280' }

/** Ein Balkendiagramm der Jahresübersicht: Monate (senkrecht) oder Rangliste
 * (waagrecht, grösste zuerst). Eine Reihe, eine Farbe — der Titel benennt sie. */
export default function YearBarsChart({ chart }: { chart: YearBars }) {
  const digits = chart.data.some((d) => !Number.isInteger(d.value)) ? 1 : 0
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'rgba(0,0,0,0.05)' }}
      formatter={(v) => [`${fmtNum(Number(v), digits)} ${chart.unit}`, '']}
      separator=""
      contentStyle={{ fontSize: 12, borderRadius: 8 }}
    />
  )
  const empty = chart.data.every((d) => d.value === 0)
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs font-semibold text-gray-600">
        {chart.title} <span className="font-normal text-gray-400">({chart.unit})</span>
      </figcaption>
      {empty ? (
        <p className="py-4 text-center text-xs text-gray-400">Keine Einträge</p>
      ) : chart.kind === 'months' ? (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chart.data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="#eef0f2" />
            <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} tickFormatter={(m: string) => m.slice(0, 1)} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={digits > 0} width={44} />
            {tooltip}
            <Bar dataKey="value" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(60, chart.data.length * 26 + 10)}>
          <BarChart data={chart.data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={130} />
            {tooltip}
            <Bar
              dataKey="value"
              fill={BAR}
              radius={[0, 4, 4, 0]}
              barSize={16}
              isAnimationActive={false}
              label={{ position: 'right', fontSize: 11, fill: '#374151', formatter: (v: unknown) => fmtNum(Number(v), digits) }}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
      {/* Tabelle für Screenreader */}
      <table className="sr-only">
        <tbody>
          {chart.data.map((d) => (
            <tr key={d.name}>
              <th>{d.name}</th>
              <td>
                {fmtNum(d.value, digits)} {chart.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
