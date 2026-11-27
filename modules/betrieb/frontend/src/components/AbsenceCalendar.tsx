import { useMemo, useState } from 'react'
import { localToday as todayIso, monthGrid, runsOf } from '../lib/duty'
import { pickDay, type PickMode } from '../lib/absencePick'
import { me, saveAbsence, saveRequest, type DutyData } from '../lib/dutyData'
import type { DutyAbsence, DutyAbsenceKind, DutyPerson, DutyRequest } from '../types'
import VacationPlan from './VacationPlan'
import AbsenceGaps from './AbsenceGaps'

const KIND_LABEL: Record<DutyAbsenceKind, string> = { ferien: 'Ferien', frei: 'frei', krank: 'krank', kurs: 'Kurs', schule: 'Schule', andere: 'abwesend' }
const KIND_COLOR: Record<DutyAbsenceKind, string> = { ferien: '#0284c7', frei: '#059669', krank: '#dc2626', kurs: '#7c3aed', schule: '#d97706', andere: '#6b7280' }
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-sm'
const btn = 'min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm active:bg-gray-100 disabled:opacity-40'

interface DayEntry {
  person: DutyPerson | undefined
  kind: DutyAbsenceKind
  /** beantragt, noch nicht bestätigt */
  pending: boolean
  /** Schultag, der nicht mehr im Stundenplan steht */
  missing?: boolean
  /** der Eintrag selbst (nicht bei Anträgen): antippen zum Ändern */
  absence?: DutyAbsence
}

const short = (name: string | undefined) => (name ?? '?').replace(/^TEST\s+/, '').split(/\s+/).slice(-1)[0]

/** Abwesenheiten als Monatskalender und Jahresübersicht. Tage antippen, Art wählen, «Speichern».
 * Büro trägt für alle direkt ein. Mitarbeitende: «krank» gilt sofort, Ferien/Frei/Kurs werden
 * beantragt (das Büro bestätigt, bis dahin gestrichelt). */
export default function AbsenceCalendar({
  d,
  canWrite,
  absences,
  refresh,
  onPick,
  initialFilter = '',
}: {
  d: DutyData
  canWrite: boolean
  absences: DutyAbsence[]
  refresh: () => void
  /** Balken antippen: Eintrag ändern/löschen (nur für Einträge, die man ändern darf; sonst null) */
  onPick?: (a: DutyAbsence) => (() => void) | null
  initialFilter?: string
}) {
  const today = todayIso()
  const self = useMemo(() => me(d.people), [d.people])
  const [view, setView] = useState<'monat' | 'jahr' | 'plan'>('monat')
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }))
  const [filter, setFilter] = useState<string>(initialFilter)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [person, setPerson] = useState<string>(canWrite ? '' : (self?.id ?? ''))
  const [kind, setKind] = useState<DutyAbsenceKind>('ferien')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // nach dem Eintragen durchs Büro: Lücken im Dienstplan gegenüber dem Standardplan zeigen
  const [gapRuns, setGapRuns] = useState<{ personId: string; from: string; to: string }[]>([])
  const canEnter = canWrite || !!self
  const who = canWrite ? person : (self?.id ?? '')

  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>()
    const add = (from: string, to: string, e: DayEntry) => {
      for (let day = from; day <= to; day = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10))
        map.set(day, [...(map.get(day) ?? []), e])
    }
    for (const a of absences) if (!filter || a.person_id === filter) add(a.from_date, a.to_date, { person: (d.allPeople ?? d.people).find((p) => p.id === a.person_id), kind: a.kind, pending: false, missing: !!a.missing_since, absence: a })
    for (const r of d.requests as DutyRequest[])
      if (r.kind === 'wunsch' && r.status === 'offen' && r.from_date && r.to_date && (!filter || r.person_id === filter))
        add(r.from_date, r.to_date, { person: d.people.find((p) => p.id === r.person_id), kind: r.absence_kind ?? 'frei', pending: true })
    return map
  }, [absences, d.requests, d.people, filter])

  // «von–bis»: erster Tipp = Anfang, zweiter = Ende (lib/absencePick.ts); Shift-Klick: Zeitraum ab dem zuletzt angetippten Tag
  const [mode, setMode] = useState<PickMode>('bereich')
  const [anchor, setAnchor] = useState<string | null>(null)
  const [start, setStart] = useState<string | null>(null)
  const toggle = (day: string, shift: boolean) => {
    if (!canEnter) return
    const next = pickDay({ sel, anchor, start }, day, mode, shift)
    setSel(next.sel)
    setAnchor(next.anchor)
    setStart(next.start)
  }
  const clearSel = () => {
    setSel(new Set())
    setStart(null)
  }
  const direct = canWrite || kind === 'krank'
  async function save() {
    if (!who || sel.size === 0) return
    setBusy(true)
    try {
      const runs = runsOf(sel)
      for (const [from, to] of runs) {
        if (direct) await saveAbsence({ id: crypto.randomUUID(), person_id: who, from_date: from, to_date: to, kind, notes: notes.trim() || null })
        else await saveRequest({ kind: 'wunsch', person_id: who, from_date: from, to_date: to, absence_kind: kind, notes: notes.trim() || null })
      }
      if (direct && canWrite && kind !== 'schule') setGapRuns(runs.map(([from, to]) => ({ personId: who, from, to })))
      setMsg(direct ? `${runs.length} ${runs.length === 1 ? 'Eintrag' : 'Einträge'} gespeichert.` : `${runs.length} ${runs.length === 1 ? 'Antrag' : 'Anträge'} gestellt, das Büro bestätigt.`)
      clearSel()
      setNotes('')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const shift = (n: number) => setYm(({ y, m }) => ({ y: y + Math.floor((m - 1 + n) / 12), m: ((((m - 1 + n) % 12) + 12) % 12) + 1 }))

  return (
    <section className="space-y-2 rounded-xl border bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => (view === 'monat' ? shift(-1) : setYm({ ...ym, y: ym.y - 1 }))} aria-label="zurück">
            ‹
          </button>
          <button type="button" className={`${btn} font-semibold`} onClick={() => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) })}>
            {view === 'monat' ? `${MONTHS[ym.m - 1]} ${ym.y}` : ym.y}
          </button>
          <button type="button" className={btn} onClick={() => (view === 'monat' ? shift(1) : setYm({ ...ym, y: ym.y + 1 }))} aria-label="weiter">
            ›
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {view !== 'plan' && <select className={`${field} min-w-0`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Person anzeigen">
            <option value="">alle Personen</option>
            {d.people.filter((p) => p.active || p.id === filter).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>}
          <span className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
            {(['monat', 'jahr', 'plan'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`min-h-10 px-2 py-1 ${view === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}>
                {v === 'monat' ? 'Monat' : v === 'jahr' ? 'Jahr' : 'Ferienplan'}
              </button>
            ))}
          </span>
        </div>
      </div>

      {view === 'plan' ? (
        <VacationPlan year={ym.y} people={d.people} absences={absences} requests={d.requests as DutyRequest[]} kindLabel={KIND_LABEL} kindColor={KIND_COLOR} />
      ) : view === 'monat' ? (
        <div>
          <div className="grid grid-cols-7 gap-px text-center text-xs font-semibold text-gray-500">
            {DAYS.map((x) => (
              <div key={x}>{x}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px rounded-lg bg-gray-200 p-px">
            {monthGrid(ym.y, ym.m).flat().map((day, i) =>
              day ? (
                // Tag wählen = Knopf über die ganze Zelle; die Balken liegen als eigene Knöpfe darüber (nicht verschachtelt)
                <div key={day} className={`relative min-h-16 bg-white ${sel.has(day) ? 'ring-2 ring-inset ring-indigo-500 !bg-indigo-50' : ''} ${day === start ? '!bg-indigo-100' : ''} ${i % 7 >= 5 ? 'bg-gray-50' : ''}`}>
                  <button
                    type="button"
                    onClick={(e) => toggle(day, e.shiftKey)}
                    className="absolute inset-0 h-full w-full"
                    aria-pressed={sel.has(day)}
                    aria-label={`${Number(day.slice(8))}. ${MONTHS[ym.m - 1]}`}
                  />
                  <div className="pointer-events-none relative p-0.5 text-left">
                    <span className={`block text-xs ${day === today ? 'font-bold text-brand-700' : 'text-gray-600'}`}>{Number(day.slice(8))}</span>
                    {(byDay.get(day) ?? []).slice(0, 4).map((e, k) => {
                      const label = `${e.person?.name ?? '?'}: ${KIND_LABEL[e.kind]}${e.pending ? ' (beantragt)' : ''}${e.missing ? ' (nicht mehr im Stundenplan)' : ''}`
                      const cls = `mt-px block w-full truncate rounded px-0.5 text-left text-[10px] leading-tight text-white ${e.missing ? 'line-through opacity-60' : ''}`
                      const style = e.pending ? { color: KIND_COLOR[e.kind], border: `1px dashed ${KIND_COLOR[e.kind]}`, background: 'white' } : { background: KIND_COLOR[e.kind] }
                      const open = e.absence && onPick ? onPick(e.absence) : null
                      return open ? (
                        <button key={k} type="button" onClick={open} className={`${cls} pointer-events-auto min-h-4 py-0.5`} style={style} aria-label={`${label}: ändern`}>
                          {short(e.person?.name)}
                        </button>
                      ) : (
                        <span key={k} className={cls} style={style} title={label}>
                          {short(e.person?.name)}
                        </span>
                      )
                    })}
                    {(byDay.get(day)?.length ?? 0) > 4 && <span className="block text-[10px] text-gray-500">+{byDay.get(day)!.length - 4}</span>}
                  </div>
                </div>
              ) : (
                <div key={`x${i}`} className="bg-gray-50" />
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {MONTHS.map((name, mi) => (
            <button key={name} type="button" className="rounded-lg border p-1 text-left hover:border-gray-400" onClick={() => {
              setYm({ y: ym.y, m: mi + 1 })
              setView('monat')
            }}>
              <div className="mb-0.5 text-xs font-semibold text-gray-700">{name}</div>
              <div className="grid grid-cols-7 gap-px">
                {monthGrid(ym.y, mi + 1).flat().map((day, i) => {
                  const es = day ? (byDay.get(day) ?? []) : []
                  const first = es.find((e) => !e.pending) ?? es[0]
                  return (
                    <span
                      key={day ?? `x${i}`}
                      className={`h-3.5 rounded-sm text-center text-[8px] leading-[14px] ${day ? 'text-gray-500' : ''}`}
                      style={first ? (first.pending ? { border: `1px dashed ${KIND_COLOR[first.kind]}` } : { background: KIND_COLOR[first.kind], color: 'white', opacity: es.length > 1 ? 1 : 0.8 }) : day ? { background: '#f3f4f6' } : undefined}
                      title={day && es.length ? es.map((e) => `${e.person?.name ?? '?'}: ${KIND_LABEL[e.kind]}${e.pending ? ' (beantragt)' : ''}`).join(', ') : undefined}
                    >
                      {day ? Number(day.slice(8)) : ''}
                    </span>
                  )
                })}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(KIND_LABEL) as DutyAbsenceKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-gray-500" /> beantragt
        </span>
      </div>

      {canEnter && view === 'monat' && (
        <div className={`space-y-2 rounded-lg p-2 ${sel.size ? 'bg-indigo-50' : 'bg-gray-50'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex shrink-0 overflow-hidden rounded-lg border border-gray-300 text-xs" role="group" aria-label="Tage wählen">
              {(['bereich', 'einzeln'] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setMode(m); setStart(null) }} aria-pressed={mode === m} className={`min-h-10 whitespace-nowrap px-3 ${mode === m ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}>
                  {m === 'bereich' ? 'von–bis' : 'einzelne Tage'}
                </button>
              ))}
            </span>
            <p className="min-w-[10rem] flex-1 text-xs text-gray-600">
              {start
                ? `Anfang ${Number(start.slice(8))}.${Number(start.slice(5, 7))}. gewählt – jetzt den letzten Tag antippen.`
                : sel.size
                  ? `${sel.size} ${sel.size === 1 ? 'Tag' : 'Tage'} gewählt.`
                  : mode === 'bereich'
                    ? 'Ersten und letzten Tag antippen, dann Art wählen und speichern.'
                    : 'Tage einzeln antippen (Shift-Klick: ganzer Zeitraum), dann Art wählen und speichern.'}
            </p>
          </div>
          {onPick && <p className="text-xs text-gray-500">Einen Eintrag ändern oder löschen: farbigen Balken antippen.</p>}
          <div className="flex flex-wrap gap-2">
            {canWrite ? (
              <select className={field} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
                <option value="">— Person —</option>
                {d.people.filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="self-center font-medium">{self?.name}</span>
            )}
            <select className={field} value={kind} onChange={(e) => setKind(e.target.value as DutyAbsenceKind)} aria-label="Art">
              {(Object.keys(KIND_LABEL) as DutyAbsenceKind[]).filter((k) => canWrite || k !== 'schule').map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input className={`${field} min-w-0 flex-1`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bemerkung (optional)" />
            <button type="button" className="min-h-11 rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40" disabled={busy || !sel.size || !who} onClick={() => void save()}>
              {direct ? 'Speichern' : 'Beantragen'}
            </button>
            {sel.size > 0 && (
              <button type="button" className={btn} onClick={clearSel}>
                Auswahl löschen
              </button>
            )}
          </div>
          {!canWrite && <p className="text-xs text-gray-500">«krank» gilt sofort. Ferien, Frei und Kurs gehen als Antrag ans Büro und erscheinen bis zur Bestätigung gestrichelt.</p>}
        </div>
      )}
      {!canEnter && <p className="text-xs text-amber-900">Dein Konto ist noch keiner Person zugeordnet. Das Büro trägt bei deiner Person die E-Mail deines FMIS-Kontos ein.</p>}
      {msg && <p className="rounded bg-sky-50 px-2 py-1 text-sky-900">{msg}</p>}
      {gapRuns.map((g) => (
        <AbsenceGaps key={`${g.personId}${g.from}`} d={d} personId={g.personId} from={g.from} to={g.to} onClose={() => setGapRuns((r) => r.filter((x) => x !== g))} />
      ))}
    </section>
  )
}
