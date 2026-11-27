import { useState } from 'react'
import { useQuery } from '../hooks/useQuery'
import { addDays, localToday } from '../lib/duty'
import { loadHandoverHistory } from '../lib/handover'

const DAYS = 14
const dmy = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`
const time = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
const dayOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Eingeklappter Verlauf der Übergabe: abgehakte und beendete Punkte der letzten 14 Tage, samt Bemerkungen. */
export default function HandoverHistory({ people }: { people: Map<string, string> }) {
  const [open, setOpen] = useState(false)
  const since = addDays(localToday(), -(DAYS - 1))
  // erst beim Aufklappen laden
  const { data } = useQuery((pg) => (open ? loadHandoverHistory(pg, since) : Promise.resolve(null)), [open, since])
  const who = (email: string | null) => (email ? (people.get(email.toLowerCase()) ?? email.split('@')[0]) : '')
  return (
    <section className="rounded-xl border bg-white text-sm">
      <button type="button" className="flex min-h-11 w-full items-center justify-between px-3 text-left font-medium text-gray-700" aria-expanded={open} onClick={() => setOpen(!open)}>
        Übergabe: Verlauf ({DAYS} Tage)
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open &&
        (!data ? (
          <p className="px-3 pb-2 text-gray-500">Lädt…</p>
        ) : data.length === 0 ? (
          <p className="px-3 pb-2 text-gray-500">Nichts abgehakt oder beendet.</p>
        ) : (
          <ul className="divide-y border-t">
            {data.map(({ item, checks }) => (
              <li key={item.id} className="px-3 py-1.5">
                <div className="font-medium text-gray-900">
                  {item.text}
                  {item.targets.length > 0 && <span className="font-normal text-gray-700"> · {item.targets.map((t) => (t.kind === 'jungtier' ? `prov. ${t.label}` : t.label)).join(', ')}</span>}
                </div>
                <ul className="text-xs text-gray-600">
                  {checks.map((c) => (
                    <li key={c.id}>
                      ✓ {dmy(c.date)} {who(c.done_by)} {time(c.done_at)}
                      {c.note ? <span className="text-gray-900"> – {c.note}</span> : ''}
                    </li>
                  ))}
                  {item.closed_at && <li>{item.recurring ? 'beendet' : 'verworfen'} am {dmy(dayOf(item.closed_at))}</li>}
                </ul>
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}
