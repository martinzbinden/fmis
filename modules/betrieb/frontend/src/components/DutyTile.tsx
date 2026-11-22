import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from '../db/pglite'
import { syncClient } from '../db/sync'
import { subscribeDataChanged } from '../db/write'
import { addDays, localToday as todayIso, slotsFor, timeText, typeLabel } from '../lib/duty'
import { me } from '../lib/dutyData'
import { isoDate } from '../lib/format'
import type { DutyPerson, DutyShift, DutyType } from '../types'
import AppIcon from '@fmis/core/AppIcon'

interface TileData {
  today: { time: string; name: string; person: string | null; color: string | null; mine: boolean }[]
  open7: number
}

// Letzter Stand je Gerät: die Kachel steht sofort da (kein Springen der Übersicht), danach frisch aus der Datenbank
const CACHE_KEY = 'fmis_duty_tile'
function readCache(): TileData | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { date: string; data: TileData } | null
    return c && c.date === todayIso() ? c.data : null
  } catch {
    return null
  }
}
function writeCache(data: TileData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ date: todayIso(), data }))
  } catch {
    // ohne Speicher: beim nächsten Öffnen wieder kurz leer
  }
}

/** Nur was die Kachel braucht (statt des ganzen Dienstplans): Personen, Dienste, eingeteilte Dienste der 7 Tage. */
async function loadTile(pg: PGlite): Promise<TileData> {
  const from = todayIso()
  const to = addDays(from, 7)
  const [people, types, shifts] = await Promise.all([
    pg.query<DutyPerson>('select * from duty_people where deleted_at is null'),
    pg.query<DutyType>('select * from duty_types where deleted_at is null order by sort_order, start_time, name'),
    pg.query<DutyShift>('select * from duty_shifts where deleted_at is null and date between $1 and $2', [from, to]),
  ])
  const typeRows = types.rows.map((t) => ({ ...t, duration_min: Number(t.duration_min) }))
  const shiftRows = shifts.rows.map((x) => ({ ...x, date: isoDate(x.date), slot: Number(x.slot) }))
  const self = me(people.rows)
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const slots = slotsFor(typeRows, shiftRows, dates)
  const name = (id: string | null | undefined) => people.rows.find((p) => p.id === id)?.name ?? null
  return {
    today: slots
      .filter((x) => x.date === from)
      .map((x) => ({ time: timeText(x.type), name: typeLabel(x.type), person: name(x.shift?.person_id), color: x.type.color, mine: !!self && x.shift?.person_id === self.id })),
    open7: slots.filter((x) => !x.shift?.person_id).length,
  }
}

/** Kachel auf der Übersicht: heute im Dienst und offene Dienste der nächsten 7 Tage. */
export default function DutyTile() {
  const canRead = useHasPermission('betrieb:dienste:read')
  const [d, setD] = useState<TileData | null>(readCache)
  useEffect(() => {
    if (!canRead) return
    let alive = true
    const load = () =>
      getDb()
        .then(loadTile)
        .then((data) => {
          if (!alive) return
          setD(data)
          writeCache(data)
        })
        .catch((e) => console.error('Dienstplan-Kachel', e))
    // zuerst lesen, dann erst synchronisieren: der Abgleich belegt die Datenbank sonst vor der Kachel
    void load().then(() => syncClient.startSyncLoop())
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
        <span className="flex items-center gap-2 font-semibold text-gray-800"><AppIcon icon="dienste" size={28} /> Heute im Dienst</span>
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
