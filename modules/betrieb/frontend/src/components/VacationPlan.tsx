import { useMemo, useState } from 'react'
import { localToday } from '../lib/duty'
import { absenceUnits, dayOfYear, daysInYear, overlaps, planEntries, vacationDays, type Overlap, type PlanEntry } from '../lib/vacationPlan'
import type { DutyAbsence, DutyAbsenceKind, DutyPerson, DutyRequest } from '../types'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
const span = (a: string, b: string) => (a === b ? dm(a) : `${dm(a)}–${dm(b)}`)
// Ein Tag ist am Handy unter 1 px breit: Balken mindestens so breit, dass man sie sieht und antippen kann
const MIN_BAR = 8

/** Ferienplan eines Jahres: je Person eine Zeile mit Balken (Farbe = Art, gestrichelt = Wunsch), darüber eine Zeile
 * «Überschneidung» (rot: mindestens zwei Personen weg). Darunter die Überschneidungen als Liste und die Ferientage je
 * Person. Einen Balken antippen zeigt die Einzelheiten. */
export default function VacationPlan({
  year,
  people,
  absences,
  requests,
  kindLabel,
  kindColor,
}: {
  year: number
  people: DutyPerson[]
  absences: DutyAbsence[]
  requests: DutyRequest[]
  kindLabel: Record<DutyAbsenceKind, string>
  kindColor: Record<DutyAbsenceKind, string>
}) {
  const [withSchool, setWithSchool] = useState(true)
  const [picked, setPicked] = useState<PlanEntry | null>(null)
  const [pickedClash, setPickedClash] = useState<Overlap | null>(null)
  const entries = useMemo(() => planEntries(absences, requests, year, new Set(people.filter((p) => !p.deleted_at).map((p) => p.id))), [absences, requests, year, people])
  const unitOf = useMemo(() => absenceUnits(people), [people])
  const clash = useMemo(() => overlaps(entries, { withSchool, unitOf }), [entries, withSchool, unitOf])
  const total = daysInYear(year)
  const pct = (iso: string) => `${(dayOfYear(iso) / total) * 100}%`
  const width = (a: string, b: string) => `${((dayOfYear(b) - dayOfYear(a) + 1) / total) * 100}%`
  const today = localToday()
  const name = (id: string) => (people.find((p) => p.id === id)?.name ?? '?').replace(/^TEST\s+/, '')
  // aktive Personen und alle, die im Jahr etwas eingetragen haben
  const rows = useMemo(() => people.filter((p) => p.active || entries.some((e) => e.personId === p.id)), [people, entries])
  const monthStarts = MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`)

  const grid = (
    <>
      {monthStarts.map((m, i) => (
        <span key={m} className={`absolute inset-y-0 border-l ${i === 0 ? 'border-transparent' : 'border-gray-200'}`} style={{ left: pct(m) }} />
      ))}
      {today.slice(0, 4) === String(year) && <span className="absolute inset-y-0 z-10 border-l-2 border-brand-600" style={{ left: pct(today) }} title="heute" />}
    </>
  )

  return (
    <div className="space-y-3">
      <div className="text-xs">
        {/* Kopf: Monate */}
        <div className="flex">
          <div className="w-20 shrink-0 sm:w-28" />
          <div className="relative h-4 flex-1">
            {monthStarts.map((m, i) => (
              <span key={m} className="absolute top-0 text-[10px] text-gray-500" style={{ left: pct(m) }}>
                <span className="sm:hidden">{MONTHS[i][0]}</span>
                <span className="hidden sm:inline">{MONTHS[i]}</span>
              </span>
            ))}
          </div>
        </div>
        {/* Überschneidungen */}
        <div className="flex items-center border-b border-gray-200 py-0.5">
          <div className="w-20 shrink-0 truncate pr-1 font-semibold text-red-800 sm:w-28">Überschneidung</div>
          <div className="relative h-6 flex-1 rounded bg-gray-50">
            {grid}
            {clash.map((o) => {
              const text = `${span(o.from, o.to)}: ${o.who.map((w) => `${name(w.personId)} (${kindLabel[w.kind]}${w.pending ? ', Wunsch' : ''})`).join(', ')}`
              return (
                <button
                  key={o.from}
                  type="button"
                  onClick={() => {
                    setPickedClash(pickedClash?.from === o.from ? null : o)
                    setPicked(null)
                  }}
                  className={`absolute inset-y-0 rounded-sm bg-red-500 ${pickedClash?.from === o.from ? 'ring-2 ring-gray-900' : ''}`}
                  style={{ left: pct(o.from), width: width(o.from, o.to), minWidth: MIN_BAR }}
                  title={text}
                  aria-label={`Überschneidung ${text}`}
                />
              )
            })}
          </div>
        </div>
        {rows.map((p) => (
          <div key={p.id} className="flex items-center border-b border-gray-100 py-0.5">
            <div className="w-20 shrink-0 truncate pr-1 font-medium text-gray-800 sm:w-28" title={p.name}>
              {name(p.id)}
            </div>
            <div className="relative h-6 flex-1">
              {grid}
              {entries
                .filter((e) => e.personId === p.id)
                .map((e, i) => (
                  <button
                    key={`${e.from}${i}`}
                    type="button"
                    onClick={() => {
                      setPicked(picked === e ? null : e)
                      setPickedClash(null)
                    }}
                    className={`absolute inset-y-0.5 rounded-sm ${picked === e ? 'ring-2 ring-gray-900' : ''}`}
                    style={{
                      left: pct(e.from),
                      width: width(e.from, e.to),
                      minWidth: MIN_BAR,
                      ...(e.pending ? { border: `1.5px dashed ${kindColor[e.kind]}`, background: 'white' } : { background: kindColor[e.kind] }),
                    }}
                    title={`${p.name}: ${kindLabel[e.kind]} ${span(e.from, e.to)}${e.pending ? ' (Wunsch, nicht bestätigt)' : ''}${e.notes ? ` · ${e.notes}` : ''}`}
                    aria-label={`${p.name}: ${kindLabel[e.kind]} ${span(e.from, e.to)}${e.pending ? ', Wunsch' : ''}`}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>

      {pickedClash && (
        <p className="rounded-lg bg-red-50 px-2 py-1.5 text-sm text-red-900">
          <span className="font-semibold">Überschneidung {span(pickedClash.from, pickedClash.to)}</span>:{' '}
          {pickedClash.who.map((w) => `${name(w.personId)} (${kindLabel[w.kind]}${w.pending ? ', Wunsch' : ''})`).join(', ')}
        </p>
      )}
      {picked && (
        <p className="rounded-lg bg-gray-50 px-2 py-1.5 text-sm text-gray-800">
          <span className="font-semibold">{name(picked.personId)}</span>: {kindLabel[picked.kind]} {span(picked.from, picked.to)}
          {picked.from.slice(0, 4)}
          {picked.pending ? ' · Wunsch, noch nicht bestätigt' : ''}
          {picked.notes ? ` · ${picked.notes}` : ''}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <section>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-800">Überschneidungen {year}</h3>
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={withSchool} onChange={(e) => setWithSchool(e.target.checked)} />
              Schultage mitzählen
            </label>
          </div>
          {clash.length === 0 ? (
            <p className="text-sm text-gray-600">Nie mehr als eine Person gleichzeitig weg.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {clash.map((o) => (
                <li key={o.from} className="flex gap-2 px-2 py-1">
                  <span className="w-24 shrink-0 tabular-nums text-gray-600">{span(o.from, o.to)}</span>
                  <span className="min-w-0 flex-1 text-gray-900">
                    {o.who.map((w, i) => (
                      <span key={w.personId}>
                        {i > 0 && ', '}
                        {name(w.personId)} <span className="text-gray-600">({kindLabel[w.kind]}{w.pending ? ', Wunsch' : ''})</span>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {people.some((p) => p.absence_with) && (
            <p className="mt-1 text-xs text-gray-500">
              Gemeinsam weg, keine Überschneidung:{' '}
              {people
                .filter((p) => p.absence_with && people.some((q) => q.id === p.absence_with))
                .map((p) => `${name(p.id)} + ${name(p.absence_with!)}`)
                .join(', ')}{' '}
              (Einstellungen → Personen).
            </p>
          )}
        </section>
        <section>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Ferientage {year}</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {rows.map((p) => {
              const v = vacationDays(entries, p.id)
              if (!v.days && !v.pendingDays) return null
              return (
                <li key={p.id} className="flex justify-between gap-2 px-2 py-1">
                  <span className="font-medium text-gray-900">{name(p.id)}</span>
                  <span className="tabular-nums text-gray-800">
                    {v.workdays} Arbeitstage <span className="text-gray-500">({v.days} Tage)</span>
                    {v.pendingDays > 0 && <span className="text-gray-500"> + {v.pendingDays} T. Wunsch</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-xs text-gray-500">Nur Art «Ferien»; Arbeitstage = Mo–Fr, Feiertage nicht abgezogen.</p>
        </section>
      </div>
    </div>
  )
}
