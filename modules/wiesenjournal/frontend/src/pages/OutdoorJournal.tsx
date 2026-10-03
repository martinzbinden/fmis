import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import CounterBadge from '../components/CounterBadge'
import { fmtDate, todayIso } from '../lib/format'
import { loadHerdData, setLaufhof } from '../lib/herds'
import { compositionAt, compositionText } from '../lib/herdModel'
import { accessIndex, ACCESS_LABEL, daysInMonth, isWinterMonth, monthCounter, RAUS_SUMMER_WEIDE_DAYS, RAUS_WINTER_ACCESS_DAYS } from '../lib/outdoorAccess'

const CELL: Record<string, { text: string; cls: string }> = {
  weide: { text: 'W', cls: 'bg-emerald-100 text-emerald-800' },
  laufhof: { text: 'L', cls: 'bg-sky-200 text-sky-900' },
  laufhof_staendig: { text: 'L', cls: 'bg-sky-50 font-normal text-sky-400' },
}

const shiftMonth = (month: string, by: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

/** Auslaufjournal (RAUS) je Monat: Gruppen × Tage aus Weide, Laufhof und
 * ständigem Laufhof; Laufhofgänge per Tipp in der Zelle. Druckbar. */
export default function OutdoorJournal() {
  const today = todayIso()
  const [month, setMonth] = useState(today.slice(0, 7))
  const { data, loading, refresh } = useQuery((pg) => loadHerdData(pg), [])
  const canWrite = useHasPermission('wiesenjournal:weide:write')
  const [busy, setBusy] = useState(false)
  const idx = useMemo(() => (data ? accessIndex(data) : null), [data])

  const days = useMemo(() => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`), [month])
  const rows = useMemo(() => {
    if (!data || !idx) return []
    return data.groups
      .map((g) => ({ g, cells: days.map((d) => (d <= today ? idx.groupDay(g.id, d) : null)) }))
      .filter((r) => r.cells.some((c) => c && c.animals > 0))
  }, [data, idx, days, today])

  async function toggle(groupId: string, date: string, on: boolean) {
    if (!data) return
    setBusy(true)
    try {
      await setLaufhof(data, groupId, date, on)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const winter = isWinterMonth(month)
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })
  const lastDay = days[days.length - 1]

  return (
    <div className="space-y-3 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Auslaufjournal {monthLabel}</h1>
        <div className="flex items-center gap-2 print:hidden">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded border border-gray-300 px-2 py-1 text-sm">
            ‹
          </button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-sm" />
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded border border-gray-300 px-2 py-1 text-sm">
            ›
          </button>
          <button type="button" onClick={() => window.print()} className="rounded border border-gray-300 px-2 py-1 text-sm">
            🖨
          </button>
          <Link to="../herden" className="text-sm text-brand-700">
            Herden
          </Link>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {winter
          ? `Winter: mindestens ${RAUS_WINTER_ACCESS_DAYS} Auslauftage im Monat (Weide oder Laufhof).`
          : `Sommer: mindestens ${RAUS_SUMMER_WEIDE_DAYS} Weidetage im Monat; Laufhof zählt nicht.`}{' '}
        Vorgabe anteilig, wenn eine Gruppe nicht den ganzen Monat Tiere hat. <b>W</b> Weide · <b>L</b> Laufhof · <span className="text-sky-400">L</span> Laufhof ständig zugänglich.
        {canWrite && ' Tipp auf eine Zelle bei Gruppen in Ställen mit zeitweisem Laufhof setzt oder entfernt den Laufhofgang.'}
      </p>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && rows.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-gray-500 shadow-sm">Keine Gruppen mit Tieren in diesem Monat.</p>}

      {rows.length > 0 && idx && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="border-collapse text-xs">
            <thead>
              <tr className="text-gray-500">
                <th className="sticky left-0 z-10 bg-white p-1 text-left font-medium">Gruppe</th>
                {days.map((d) => {
                  const dow = new Date(`${d}T12:00:00`).getDay()
                  return (
                    <th key={d} className={`w-6 min-w-6 p-0.5 text-center font-normal ${dow === 0 || dow === 6 ? 'text-gray-400' : ''} ${d === today ? 'text-brand-700 underline' : ''}`}>
                      {Number(d.slice(8))}
                    </th>
                  )
                })}
                <th className="p-1 text-left font-medium">Tage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ g, cells }) => {
                const counter = monthCounter(idx, g.id, month, today)
                const compDate = today < lastDay ? (today < days[0] ? days[0] : today) : lastDay
                const comp = compositionAt(g.id, data!.members, data!.counts, compDate)
                return (
                  <tr key={g.id} className="border-t">
                    <td className="sticky left-0 z-10 max-w-40 bg-white p-1">
                      <span className="block truncate font-medium text-gray-800">{g.name}</span>
                      <span className="block truncate text-[10px] text-gray-500">{comp.total ? `${comp.total}: ${compositionText(comp)}` : '—'}</span>
                    </td>
                    {cells.map((c, i) => {
                      const d = days[i]
                      if (!c || c.animals <= 0) return <td key={d} className="border-l border-gray-100 bg-gray-50" />
                      const look = c.kind ? CELL[c.kind] : null
                      const togglable = canWrite && c.kind !== 'weide' && c.stallLaufhof !== 'staendig'
                      return (
                        <td key={d} className="border-l border-gray-100 p-0">
                          <button
                            type="button"
                            disabled={!togglable || busy}
                            title={`${d}: ${c.kind ? ACCESS_LABEL[c.kind] : 'kein Auslauf'} (${c.animals} Tiere)`}
                            onClick={() => void toggle(g.id, d, !c.laufhofEntry)}
                            className={`block h-7 w-6 text-center font-semibold ${look?.cls ?? (togglable ? 'text-gray-300 hover:bg-sky-50' : '')}`}
                          >
                            {look?.text ?? (togglable ? '·' : '')}
                          </button>
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap p-1">{counter && <CounterBadge c={counter} compact />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-gray-400 print:hidden">Stand {fmtDate(today)}. Laufhof je Ort unter Herden → Orte.</p>
    </div>
  )
}
