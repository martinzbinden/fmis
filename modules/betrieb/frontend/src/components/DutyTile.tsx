import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { getSyncedDb as getDb } from '../db/access'
import { subscribeDataChanged } from '../db/write'
import { addDays, localToday as todayIso, slotsFor, timeText, typeLabel } from '../lib/duty'
import { loadDuty, me } from '../lib/dutyData'

interface TileData {
  today: { time: string; name: string; person: string | null; color: string | null; mine: boolean }[]
  open7: number
}

/** Kachel auf der Übersicht: heute im Dienst und offene Dienste der nächsten 7 Tage. */
export default function DutyTile() {
  const canRead = useHasPermission('betrieb:dienste:read')
  const [d, setD] = useState<TileData | null>(null)
  useEffect(() => {
    if (!canRead) return
    let alive = true
    const load = () =>
      getDb()
        .then((pg) => loadDuty(pg, todayIso(), addDays(todayIso(), 7)))
        .then((data) => {
          const self = me(data.people)
          const dates = Array.from({ length: 7 }, (_, i) => addDays(todayIso(), i))
          const slots = slotsFor(data.types, data.shifts, dates)
          const name = (id: string | null | undefined) => data.people.find((p) => p.id === id)?.name ?? null
          if (alive)
            setD({
              today: slots
                .filter((s) => s.date === todayIso())
                .map((s) => ({ time: timeText(s.type), name: typeLabel(s.type), person: name(s.shift?.person_id), color: s.type.color, mine: !!self && s.shift?.person_id === self.id })),
              open7: slots.filter((s) => !s.shift?.person_id).length,
            })
        })
        .catch((e) => {
          console.error('Dienstplan-Kachel', e)
          if (alive) setD(null)
        })
    void load()
    const off = subscribeDataChanged(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [canRead])
  if (!canRead || !d || (d.today.length === 0 && d.open7 === 0)) return null
  return (
    <Link to="/betrieb/dienste" className="mt-3 block rounded-xl first:mt-0 bg-white p-4 text-sm shadow-sm active:bg-gray-100">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-gray-800">👥 Heute im Dienst</span>
        {d.open7 > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{d.open7} offen (7 Tage)</span>}
      </div>
      <ul className="space-y-0.5">
        {d.today.map((t, i) => (
          <li key={i} className={`flex items-center gap-2 ${t.mine ? 'font-semibold' : ''}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color ?? '#64748b' }} />
            <span className="w-24 text-xs tabular-nums text-gray-500">{t.time}</span>
            <span className="flex-1 text-gray-700">{t.name}</span>
            <span className={t.person ? 'text-gray-900' : 'text-red-700'}>{t.person ?? 'offen'}</span>
          </li>
        ))}
      </ul>
    </Link>
  )
}
