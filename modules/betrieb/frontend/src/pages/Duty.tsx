import { useMemo, useState } from 'react'
import { API_URL, getToken } from '@fmis/core/auth'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { useStored } from '../components/DriveAssist'
import { addDays, localToday as todayIso, conflictsFor, copyFromPrevious, DEFAULT_SUMMER, endTime, groupTypes, hasConflict, hhmm, isoWeek, mondayOf, parseTimes, slotsFor, stringifyTimes, suggest, typeLabel, weekDates, type DayTime, type SeasonTimes, type Slot } from '../lib/duty'
import TimeStrip, { TimeAxis } from '../components/TimeStrip'
import Planning, { OfficeBar } from '../components/DutyPlanning'
import { GENERATE_AHEAD_WEEKS, weekStates } from '../lib/dutyPlan'
import { getSyncedDb } from '../db/access'
import { adjustWeek, setWeekStatus, assignSlots, checkRequest, decideRequest, deleteAbsence, deletePerson, deleteType, loadDuty, me, saveAbsence, savePerson, saveRequest, saveType, setSkill, withdrawRequest, type DutyData } from '../lib/dutyData'
import type { DutyAbsenceKind, DutyPerson, DutyRequest, DutyRequestStatus, DutyType } from '../types'

type Tab = 'woche' | 'meine' | 'antraege' | 'abwesend' | 'planung' | 'einstellungen'
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const KIND: Record<DutyAbsenceKind, string> = { ferien: 'Ferien', frei: 'frei', krank: 'krank', kurs: 'Kurs', andere: 'abwesend' }
const SEEN_KEY = 'wiesenjournal_duty_changes_seen'
const dm = (iso: string) => `${DAYS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7]} ${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`
const field = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm'
const btn = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm active:bg-gray-100 disabled:opacity-40'

/** Dienstname mit der Tierart voran, in der Farbe des Dienstes. */
function TypeName({ t }: { t: Pick<DutyType, 'name' | 'animal' | 'color'> }) {
  return (
    <>
      {t.animal?.trim() && (
        <b className="mr-1" style={{ color: t.color ?? undefined }}>
          {t.animal.trim()} ·
        </b>
      )}
      {t.name}
    </>
  )
}

function personName(d: DutyData, id: string | null | undefined) {
  return d.people.find((p) => p.id === id)?.name ?? '–'
}

/** Ein Platz im Wochenplan: Zeit, Dienst, Person (nur Befähigte), Warnungen. */
function SlotRow({ s, d, all, canWrite }: { s: Slot; d: DutyData; all: Slot[]; canWrite: boolean }) {
  const pid = s.shift?.person_id ?? null
  const c = pid ? conflictsFor(pid, s, all, d.skills, d.absences) : null
  const skilled = d.people.filter((p) => p.active && d.skills.some((k) => k.person_id === p.id && k.type_id === s.type.id))
  const options = pid && !skilled.some((p) => p.id === pid) ? [...skilled, d.people.find((p) => p.id === pid)!].filter(Boolean) : skilled
  return (
    <li className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 ${!pid ? 'bg-red-50' : ''}`}>
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.type.color ?? '#64748b' }} />
      <span className="w-24 shrink-0 text-xs tabular-nums text-gray-500">
        {s.type.start_time}–{endTime(s.type)}
      </span>
      <span className="min-w-0 flex-1 text-sm text-gray-800">
        <TypeName t={s.type} />
      </span>
      {canWrite ? (
        <select
          value={pid ?? ''}
          onChange={(e) => void assignSlots([{ slot: s, personId: e.target.value || null }])}
          className={`${field} max-w-[11rem] ${!pid ? 'border-red-400 text-red-700' : c && hasConflict(c) ? 'border-amber-500' : ''}`}
        >
          <option value="">— offen —</option>
          {options.map((p) => {
            const cc = conflictsFor(p.id, s, all, d.skills, d.absences)
            const why = cc.absent ? ` (${KIND[cc.absent.kind]})` : cc.overlap.length ? ' (gleichzeitig)' : ''
            return (
              <option key={p.id} value={p.id}>
                {p.name}
                {why}
              </option>
            )
          })}
        </select>
      ) : (
        <span className={`text-sm font-medium ${pid ? 'text-gray-800' : 'text-red-700'}`}>{pid ? personName(d, pid) : 'offen'}</span>
      )}
      {d.requests.some((r) => r.status === 'offen' && (r.shift_id === s.id || r.other_shift_id === s.id)) && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Antrag offen</span>
      )}
      {c && hasConflict(c) && (
        <span className="w-full pl-5 text-xs text-amber-800">
          ⚠ {[c.absent && `${personName(d, pid)} ist ${KIND[c.absent.kind]}`, c.overlap.length && `gleichzeitig: ${c.overlap.join(', ')}`, c.unskilled && 'nicht als befähigt eingetragen'].filter(Boolean).join(' · ')}
        </span>
      )}
    </li>
  )
}

/** Ein Platz in der Kalenderansicht: Person (Büro: Auswahl), rot = offen, gelb = Konflikt. */
function SlotCell({ s, d, all, canWrite }: { s: Slot; d: DutyData; all: Slot[]; canWrite: boolean }) {
  const pid = s.shift?.person_id ?? null
  const c = pid ? conflictsFor(pid, s, all, d.skills, d.absences) : null
  const warn = !!c && hasConflict(c)
  const why = c && warn ? [c.absent && `${personName(d, pid)} ist ${KIND[c.absent.kind]}`, c.overlap.length && `gleichzeitig: ${c.overlap.join(', ')}`, c.unskilled && 'nicht befähigt'].filter(Boolean).join(' · ') : ''
  const pending = d.requests.some((r) => r.status === 'offen' && (r.shift_id === s.id || r.other_shift_id === s.id))
  const tone = !pid ? 'border-red-300 bg-red-50 text-red-800' : warn ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white'
  const skilled = d.people.filter((p) => p.active && d.skills.some((k) => k.person_id === p.id && k.type_id === s.type.id))
  const options = pid && !skilled.some((p) => p.id === pid) ? [...skilled, ...d.people.filter((p) => p.id === pid)] : skilled
  return (
    <div className={`rounded border px-1 py-0.5 ${tone}`} title={[why, s.shift?.notes].filter(Boolean).join(' · ') || undefined}>
      {canWrite ? (
        <select value={pid ?? ''} onChange={(e) => void assignSlots([{ slot: s, personId: e.target.value || null }])} className="w-full bg-transparent text-xs" aria-label={`${typeLabel(s.type)} ${dm(s.date)}`}>
          <option value="">— offen —</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <span className={`block truncate text-xs ${pid ? 'font-medium text-gray-800' : ''}`}>{pid ? personName(d, pid) : 'offen'}</span>
      )}
      {(s.shift?.notes || pending || warn) && (
        <span className="block truncate text-[10px] leading-tight text-amber-800">{[pending && 'Antrag offen', warn && '⚠', s.shift?.notes].filter(Boolean).join(' · ')}</span>
      )}
    </div>
  )
}

/** Wochenkalender: Dienste (nach Tierart) × Wochentage. */
function WeekGrid({ d, dates, slots, canWrite }: { d: DutyData; dates: string[]; slots: Slot[]; canWrite: boolean }) {
  const rows = groupTypes(d.types)
    .flatMap((g) => g.types)
    .filter((t) => slots.some((s) => s.type.id === t.id))
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[42rem] table-fixed text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 z-10 w-32 bg-gray-50 px-2 py-1 text-left text-xs font-semibold text-gray-500">Dienst</th>
            {dates.map((date) => (
              <th key={date} className={`px-1 py-1 text-xs font-semibold ${date === todayIso() ? 'text-brand-700' : 'text-gray-700'}`}>
                {dm(date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t align-top">
              <td className="sticky left-0 z-10 bg-white px-2 py-1 text-xs leading-tight">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: t.color ?? '#64748b' }} />
                <TypeName t={t} />
              </td>
              {dates.map((date) => {
                const here = slots.filter((s) => s.type.id === t.id && s.date === date)
                return (
                  <td key={date} className={`px-0.5 py-0.5 ${date === todayIso() ? 'bg-brand-50' : ''}`}>
                    {here.length ? (
                      <div className="space-y-0.5">
                        <div className="text-[10px] tabular-nums text-gray-500">{here[0].type.start_time}–{endTime(here[0].type)}</div>
                        {here.map((s) => (
                          <SlotCell key={s.id} s={s} d={d} all={slots} canWrite={canWrite} />
                        ))}
                      </div>
                    ) : (
                      <span className="block text-center text-xs text-gray-300">–</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="border-t bg-gray-50 align-top">
            <td className="sticky left-0 z-10 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-500">Abwesend</td>
            {dates.map((date) => (
              <td key={date} className="px-1 py-1 text-[11px] leading-tight text-gray-600">
                {d.absences
                  .filter((a) => a.from_date <= date && date <= a.to_date)
                  .map((a) => `${personName(d, a.person_id)} (${KIND[a.kind]})`)
                  .join(', ')}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Week({ d, monday, setMonday, canWrite, refresh }: { d: DutyData; monday: string; setMonday: (m: string) => void; canWrite: boolean; refresh: () => void }) {
  const dates = weekDates(monday)
  const slots = useMemo(() => slotsFor(d.types, d.shifts, dates), [d, monday])
  const prevSlots = useMemo(() => slotsFor(d.types, d.shifts, weekDates(addDays(monday, -7))), [d, monday])
  const open = slots.filter((s) => !s.shift?.person_id).length
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (items: { slot: Slot; personId: string }[], what: string) => {
    if (!items.length) {
      setMsg(`${what}: nichts einzuteilen (keine passende Person frei).`)
      return
    }
    setBusy(true)
    await assignSlots(items.map((i) => ({ slot: i.slot, personId: i.personId, kind: 'einteilen' })))
    setBusy(false)
    setMsg(`${what}: ${items.length} Dienste eingeteilt.`)
    refresh()
  }
  const lastSeen = (() => {
    try {
      return localStorage.getItem(SEEN_KEY) ?? ''
    } catch {
      return ''
    }
  })()
  const unseen = d.changes.filter((c) => c.changed_at > lastSeen)
  const [showChanges, setShowChanges] = useState(false)
  const weekRow = d.weeks.find((w) => w.week_start === monday) ?? null
  const [view, setView] = useStored<'kalender' | 'liste'>('betrieb_duty_view', 'kalender')
  const typeName = (id: string) => {
    const t = d.types.find((x) => x.id === id)
    return t ? typeLabel(t) : 'Dienst'
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => setMonday(addDays(monday, -7))} aria-label="Vorwoche">
            ‹
          </button>
          <button type="button" className={`${btn} font-semibold`} onClick={() => setMonday(mondayOf(todayIso()))}>
            KW {isoWeek(monday)} · {dm(monday)}–{dm(addDays(monday, 6))}
          </button>
          <button type="button" className={btn} onClick={() => setMonday(addDays(monday, 7))} aria-label="Nächste Woche">
            ›
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${open ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
            {open ? `${open} offen` : 'alles abgedeckt'}
          </span>
          <span className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
            {(['kalender', 'liste'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`px-2 py-1 ${view === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}>
                {v === 'kalender' ? 'Kalender' : 'Liste'}
              </button>
            ))}
          </span>
        </div>
      </div>
      {weekRow && (
        <p className={`rounded-lg px-2 py-1 text-sm ${weekRow.status === 'bestaetigt' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
          {weekRow.status === 'bestaetigt' ? '✓ Woche bestätigt' : 'Vorläufig: diese Woche ist noch nicht vom Büro bestätigt.'}
        </p>
      )}
      {canWrite && (
        <OfficeBar>
          <button type="button" className={btn} disabled={busy || open === 0} onClick={() => void run(copyFromPrevious(slots, prevSlots, d.skills, d.absences), 'Wie Vorwoche')}>
            Wie Vorwoche
          </button>
          <button type="button" className={btn} disabled={busy || open === 0} onClick={() => void run(suggest(slots, d.people, d.skills, d.absences), 'Vorschlag')}>
            Offene vorschlagen
          </button>
          {d.templates.length > 0 && (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void getSyncedDb()
                  .then((pg) => adjustWeek(pg, d, monday))
                  .then((r) => setMsg(`An Standardplan und Abwesenheiten angepasst: ${r.changed} Dienste.${r.unfilled.length ? ` Offen: ${r.unfilled.join(' · ')}` : ''}`))
                  .finally(() => {
                    setBusy(false)
                    refresh()
                  })
              }}
            >
              Standardplan/Abwesenheiten anwenden
            </button>
          )}
          {weekRow?.status === 'bestaetigt' ? (
            <button type="button" className={btn} disabled={busy} onClick={() => void setWeekStatus(d, monday, 'entwurf').then(refresh)}>
              Zurück auf Entwurf
            </button>
          ) : (
            <button type="button" className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy} onClick={() => void setWeekStatus(d, monday, 'bestaetigt').then(refresh)}>
              Woche bestätigen
            </button>
          )}
        </OfficeBar>
      )}
      {msg && <p className="rounded bg-sky-50 px-2 py-1 text-sm text-sky-900">{msg}</p>}

      {d.changes.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left font-medium text-amber-900"
            onClick={() => {
              setShowChanges(!showChanges)
              try {
                localStorage.setItem(SEEN_KEY, new Date().toISOString())
              } catch {
                // egal
              }
            }}
          >
            Änderungen (30 Tage){unseen.length ? ` · ${unseen.length} neu` : ''}
            <span>{showChanges ? '▴' : '▾'}</span>
          </button>
          {showChanges && (
            <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
              {d.changes.slice(0, 40).map((c) => (
                <li key={c.id}>
                  {dm(c.date)} {typeName(c.type_id)}: {c.from_person ? personName(d, c.from_person) : 'offen'} → {c.to_person ? personName(d, c.to_person) : 'offen'}
                  {c.kind === 'tausch' || c.kind === 'abgabe' ? ` (${c.kind})` : ''} · {c.changed_by ?? ''}
                  {c.notes ? ` · «${c.notes}»` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'kalender' && <WeekGrid d={d} dates={dates} slots={slots} canWrite={canWrite} />}
      {view === 'liste' && dates.map((date) => {
        const day = slots.filter((s) => s.date === date)
        const away = d.absences.filter((a) => a.from_date <= date && date <= a.to_date)
        return (
          <section key={date} className={`overflow-hidden rounded-xl border bg-white ${date === todayIso() ? 'border-brand-500' : ''}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 bg-gray-50 px-2 py-1">
              <span className="font-semibold text-gray-800">{dm(date)}</span>
              {away.length > 0 && (
                <span className="text-xs text-gray-600">
                  weg: {away.map((a) => `${personName(d, a.person_id)} (${KIND[a.kind]})`).join(', ')}
                </span>
              )}
            </div>
            {day.length ? (
              <ul className="divide-y">
                {day.map((s) => (
                  <SlotRow key={s.id} s={s} d={d} all={slots} canWrite={canWrite} />
                ))}
              </ul>
            ) : (
              <p className="px-2 py-1.5 text-xs text-gray-500">keine Dienste</p>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Eigene Dienste der nächsten 3 Wochen: abgeben oder tauschen. */
function Mine({ d, canWrite, canPropose, refresh }: { d: DutyData; canWrite: boolean; canPropose: boolean; refresh: () => void }) {
  const self = me(d.people)
  const today = todayIso()
  const dates = Array.from({ length: 21 }, (_, i) => addDays(today, i))
  const slots = useMemo(() => slotsFor(d.types, d.shifts, dates), [d, today])
  const [openId, setOpenId] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [back, setBack] = useState('')
  const [note, setNote] = useState('')
  if (!self) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Dein Konto ist noch keiner Person zugeordnet. Unter «Einstellungen» bei deiner Person die E-Mail deines FMIS-Kontos eintragen.</p>
  const mine = slots.filter((s) => s.shift?.person_id === self.id)
  // Wer den Plan nicht führt, schlägt nur vor; das Büro bestätigt (Tab «Anträge»)
  const propose = !canWrite && canPropose
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        Dienste von <b>{self.name}</b>, nächste 3 Wochen.
      </p>
      {mine.length === 0 && <p className="text-sm text-gray-500">Keine Dienste eingeteilt.</p>}
      <ul className="divide-y rounded-xl border bg-white">
        {mine.map((s) => {
          const candidates = d.people.filter((p) => p.active && p.id !== self.id && d.skills.some((k) => k.person_id === p.id && k.type_id === s.type.id))
          const pending = d.requests.find((r) => r.status === 'offen' && r.shift_id === s.id)
          const theirs = to ? slots.filter((o) => o.shift?.person_id === to && o.date >= today && d.skills.some((k) => k.person_id === self.id && k.type_id === o.type.id)) : []
          return (
            <li key={s.id} className="space-y-2 p-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: s.type.color ?? '#64748b' }} />
                <span className="w-28 text-sm font-medium">{dm(s.date)}</span>
                <span className="flex-1 text-sm">
                  {s.type.start_time} · {typeLabel(s.type)}
                </span>
                {pending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Antrag offen</span>}
                {(canWrite || propose) && !pending && (
                  <button
                    type="button"
                    className={btn}
                    onClick={() => {
                      setOpenId(openId === s.id ? null : s.id)
                      setTo('')
                      setBack('')
                      setNote('')
                    }}
                  >
                    {propose ? 'Vorschlagen' : 'Tauschen / abgeben'}
                  </button>
                )}
              </div>
              {openId === s.id && (
                <div className="space-y-2 rounded-lg bg-gray-50 p-2 text-sm">
                  <label className="flex flex-wrap items-center gap-2">
                    an
                    <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value="">{propose ? '— offen lassen —' : '— Person wählen —'}</option>
                      {candidates.map((p) => {
                        const cc = conflictsFor(p.id, s, slots, d.skills, d.absences)
                        return (
                          <option key={p.id} value={p.id} disabled={!!cc.absent}>
                            {p.name}
                            {cc.absent ? ` (${KIND[cc.absent.kind]})` : cc.overlap.length ? ' (gleichzeitig eingeteilt)' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  {to && (
                    <label className="flex flex-wrap items-center gap-2">
                      dafür übernehme ich
                      <select className={field} value={back} onChange={(e) => setBack(e.target.value)}>
                        <option value="">nichts (nur abgeben)</option>
                        {theirs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {dm(o.date)} {o.type.start_time} {typeLabel(o.type)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <input className={`${field} w-full`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bemerkung (optional)" />
                  <button
                    type="button"
                    disabled={propose ? !!back && !to : !to}
                    className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
                    onClick={() => {
                      const other = theirs.find((o) => o.id === back)
                      if (propose) {
                        void saveRequest({
                          kind: other ? 'tausch' : 'abgabe',
                          person_id: self.id,
                          shift_id: s.id,
                          date: s.date,
                          type_id: s.type.id,
                          to_person: to || null,
                          other_shift_id: other?.id ?? null,
                          other_date: other?.date ?? null,
                          other_type_id: other?.type.id ?? null,
                          notes: note || null,
                        }).then(() => {
                          setOpenId(null)
                          refresh()
                        })
                        return
                      }
                      void assignSlots([
                        { slot: s, personId: to, kind: other ? 'tausch' : 'abgabe', notes: note || null },
                        ...(other ? [{ slot: other, personId: self.id, kind: 'tausch' as const, notes: note || null }] : []),
                      ]).then(() => {
                        setOpenId(null)
                        refresh()
                      })
                    }}
                  >
                    {propose ? (back ? 'Tausch vorschlagen' : 'Abgabe vorschlagen') : back ? 'Tauschen' : 'Abgeben'}
                  </button>
                  <p className="text-xs text-gray-500">
                    {propose ? 'Das ist ein Vorschlag. Der Plan ändert sich erst, wenn das Büro bestätigt.' : 'Wird sofort übernommen und erscheint für alle unter «Änderungen».'}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const STATUS_LABEL: Record<DutyRequestStatus, string> = { offen: 'offen', bestaetigt: 'bestätigt', abgelehnt: 'abgelehnt', zurueckgezogen: 'zurückgezogen' }
const STATUS_CLASS: Record<DutyRequestStatus, string> = {
  offen: 'bg-amber-100 text-amber-900',
  bestaetigt: 'bg-emerald-100 text-emerald-800',
  abgelehnt: 'bg-red-100 text-red-800',
  zurueckgezogen: 'bg-gray-100 text-gray-600',
}

/** Antrag in einem Satz. */
function describeRequest(d: DutyData, r: DutyRequest): string {
  const name = personName(d, r.person_id)
  const dutyName = (typeId: string | null) => {
    const t = d.types.find((x) => x.id === typeId)
    return t ? typeLabel(t) : 'Dienst'
  }
  const range = r.from_date && r.to_date ? `${dm(r.from_date)}${r.to_date !== r.from_date ? `–${dm(r.to_date)}` : ''}` : ''
  if (r.kind === 'wunsch') return `${name} wünscht frei: ${range}`
  const mine = `${r.date ? dm(r.date) : ''} ${dutyName(r.type_id)}`
  if (r.kind === 'abgabe') return `${name} gibt ab: ${mine}${r.to_person ? ` → ${personName(d, r.to_person)}` : ' (an wen auch immer)'}`
  return `${name} tauscht: ${mine} ↔ ${personName(d, r.to_person)}: ${r.other_date ? dm(r.other_date) : ''} ${dutyName(r.other_type_id)}`
}

/** Freiwünsche und Vorschläge. Mitarbeitende stellen sie und ziehen sie zurück;
 * das Büro bestätigt oder lehnt ab, erst die Bestätigung ändert den Plan. */
function Requests({ d, canWrite, canPropose, refresh }: { d: DutyData; canWrite: boolean; canPropose: boolean; refresh: () => void }) {
  const self = me(d.people)
  const today = todayIso()
  const [f, setF] = useState({ from_date: today, to_date: today, notes: '' })
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const visible = d.requests.filter((r) => canWrite || r.person_id === self?.id)
  const open = visible.filter((r) => r.status === 'offen')
  const done = visible.filter((r) => r.status !== 'offen')
  const run = (job: Promise<unknown>) => {
    setErr(null)
    job.then(refresh).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
  }
  return (
    <div className="space-y-3">
      {canPropose && !canWrite && (
        <section className="space-y-2 rounded-xl border bg-white p-3 text-sm">
          <h3 className="font-semibold text-gray-700">Freiwunsch eintragen</h3>
          {!self ? (
            <p className="text-amber-900">Dein Konto ist noch keiner Person zugeordnet. Das Büro trägt bei deiner Person die E-Mail deines FMIS-Kontos ein.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <input type="date" className={field} value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: e.target.value > f.to_date ? e.target.value : f.to_date })} />
                <span className="self-center">bis</span>
                <input type="date" className={field} value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} />
                <input className={`${field} min-w-0 flex-1`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Bemerkung (optional)" />
                <button
                  type="button"
                  className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
                  disabled={f.to_date < f.from_date}
                  onClick={() => run(saveRequest({ kind: 'wunsch', person_id: self.id, from_date: f.from_date, to_date: f.to_date, notes: f.notes.trim() || null }).then(() => setF({ ...f, notes: '' })))}
                >
                  Wunsch eintragen
                </button>
              </div>
              <p className="text-xs text-gray-500">Das Büro bestätigt. Bestätigte Wünsche erscheinen als Abwesenheit und werden beim Einteilen berücksichtigt. Tausch oder Abgabe eines Dienstes schlägst du unter «Meine Dienste» vor.</p>
            </>
          )}
        </section>
      )}
      {err && <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">{err}</p>}
      <section className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-700">{canWrite ? 'Offene Anträge' : 'Meine offenen Anträge'}</h3>
        <ul className="divide-y rounded-xl border bg-white text-sm">
          {open.map((r) => {
            const check = checkRequest(d, r)
            return (
              <li key={r.id} className="space-y-1.5 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">{describeRequest(d, r)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
                {r.notes && <p className="text-xs text-gray-600">«{r.notes}»</p>}
                {canWrite && check.notes.length > 0 && <p className="text-xs text-amber-800">⚠ {check.notes.join(' ')}</p>}
                {canWrite ? (
                  rejectId === r.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input className={`${field} min-w-0 flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund (optional)" />
                      <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white" onClick={() => { setRejectId(null); run(decideRequest(d, r, 'abgelehnt', reason)) }}>
                        Ablehnen
                      </button>
                      <button type="button" className={btn} onClick={() => setRejectId(null)}>
                        Abbrechen
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40" disabled={!check.ok} onClick={() => run(decideRequest(d, r, 'bestaetigt'))}>
                        Bestätigen
                      </button>
                      <button type="button" className={btn} onClick={() => { setRejectId(r.id); setReason('') }}>
                        Ablehnen
                      </button>
                    </div>
                  )
                ) : (
                  <button type="button" className={btn} onClick={() => run(withdrawRequest(r))}>
                    Zurückziehen
                  </button>
                )}
              </li>
            )
          })}
          {open.length === 0 && <li className="px-3 py-2 text-gray-500">Keine offenen Anträge.</li>}
        </ul>
      </section>
      {done.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-semibold text-gray-700">Entschieden (30 Tage)</h3>
          <ul className="divide-y rounded-xl border bg-white text-sm">
            {done.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  {describeRequest(d, r)}
                  {r.decision_note ? ` · «${r.decision_note}»` : ''}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Absences({ d, canWrite }: { d: DutyData; canWrite: boolean }) {
  const self = me(d.people)
  const [f, setF] = useState({ person_id: self?.id ?? '', from_date: todayIso(), to_date: todayIso(), kind: 'ferien' as DutyAbsenceKind, notes: '' })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const list = d.absences.filter((a) => a.to_date >= todayIso())
  return (
    <div className="space-y-3">
      {canWrite && (
        <section className="space-y-2 rounded-xl border bg-white p-3 text-sm">
          <h3 className="font-semibold text-gray-700">Abwesenheit eintragen</h3>
          <div className="flex flex-wrap gap-2">
            <select className={field} value={f.person_id} onChange={(e) => setF({ ...f, person_id: e.target.value })}>
              <option value="">— Person —</option>
              {d.people.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DutyAbsenceKind })}>
              {Object.entries(KIND).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input type="date" className={field} value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: e.target.value > f.to_date ? e.target.value : f.to_date })} />
            <span className="self-center">bis</span>
            <input type="date" className={field} value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} />
            <input className={`${field} min-w-0 flex-1`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Bemerkung" />
            <button
              type="button"
              className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
              disabled={!f.person_id || f.to_date < f.from_date}
              onClick={() => void saveAbsence({ id: crypto.randomUUID(), person_id: f.person_id, from_date: f.from_date, to_date: f.to_date, kind: f.kind, notes: f.notes.trim() || null }).then(() => setF({ ...f, notes: '' }))}
            >
              Eintragen
            </button>
          </div>
          <p className="text-xs text-gray-500">Wer abwesend ist, wird beim Einteilen gewarnt und vom Vorschlag ausgelassen.</p>
        </section>
      )}
      <ul className="divide-y rounded-xl border bg-white text-sm">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2">
            <span className="flex-1">
              <b>{personName(d, a.person_id)}</b> · {KIND[a.kind]} · {dm(a.from_date)}
              {a.to_date !== a.from_date ? `–${dm(a.to_date)}` : ''}
              {a.notes ? ` · ${a.notes}` : ''}
            </span>
            {canWrite &&
              (confirmId === a.id ? (
                <button type="button" className="rounded bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void deleteAbsence(a.id).then(() => setConfirmId(null))}>
                  Wirklich löschen?
                </button>
              ) : (
                <button type="button" className="px-1 text-gray-500" onClick={() => setConfirmId(a.id)} aria-label="Abwesenheit löschen">
                  ×
                </button>
              ))}
          </li>
        ))}
        {list.length === 0 && <li className="px-3 py-2 text-gray-500">Keine kommenden Abwesenheiten.</li>}
      </ul>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Tag und Monat (MM-DD) wählen. */
function MonthDay({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [m, d] = value.split('-').map(Number)
  const set = (mm: number, dd: number) => onChange(`${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)
  return (
    <span className="inline-flex gap-1">
      <select className={field} value={d} onChange={(e) => set(m, Number(e.target.value))} aria-label={`${label}, Tag`}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((x) => (
          <option key={x} value={x}>
            {x}.
          </option>
        ))}
      </select>
      <select className={field} value={m} onChange={(e) => set(Number(e.target.value), d)} aria-label={`${label}, Monat`}>
        {MONTHS.map((x, i) => (
          <option key={x} value={i + 1}>
            {x}
          </option>
        ))}
      </select>
    </span>
  )
}

const minutesOf = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const rangeText = (v: DayTime) => (v ? `${hhmm(v[0])}–${hhmm(Math.min(24 * 60, v[0] + v[1]))}` : '')

function TypeEditor({ t, animals, onDone }: { t: Partial<DutyType>; animals: string[]; onDone: () => void }) {
  const initialTimes = parseTimes(t.times)
  const [f, setF] = useState({
    name: t.name ?? '',
    animal: t.animal ?? '',
    start_time: t.start_time ?? '06:00',
    duration_min: String(t.duration_min ?? 60),
    weekdays: t.weekdays ?? '1111111',
    color: t.color ?? '#2563eb',
    description: t.description ?? '',
    active: t.active ?? true,
    windowOn: !!(t.active_from && t.active_to),
    active_from: t.active_from ?? '03-01',
    active_to: t.active_to ?? '10-31',
    ownTimes: !!initialTimes,
    summer_from: t.summer_from ?? DEFAULT_SUMMER.from,
    summer_to: t.summer_to ?? DEFAULT_SUMMER.to,
  })
  const [times, setTimes] = useState<SeasonTimes>(initialTimes ?? { sommer: Array(7).fill(null), winter: Array(7).fill(null) })
  const [season, setSeason] = useState<'sommer' | 'winter'>('sommer')
  const [confirmDel, setConfirmDel] = useState(false)
  const toggleDay = (i: number) => setF({ ...f, weekdays: f.weekdays.slice(0, i) + (f.weekdays[i] === '0' ? '1' : '0') + f.weekdays.slice(i + 1) })
  const ghost: DayTime = [minutesOf(f.start_time), Number(f.duration_min) || 60]
  const setDay = (sn: 'sommer' | 'winter', i: number, v: DayTime) => setTimes((all) => ({ ...all, [sn]: all[sn].map((x, j) => (j === i ? v : x)) }))
  const setAll = (sn: 'sommer' | 'winter', v: DayTime[]) => setTimes((all) => ({ ...all, [sn]: v }))
  return (
    <div className="space-y-2 rounded-lg bg-gray-50 p-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <input className={`${field} w-28`} list="duty-animals" value={f.animal} onChange={(e) => setF({ ...f, animal: e.target.value })} placeholder="Tierart" aria-label="Tierart" />
        <datalist id="duty-animals">
          {animals.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <input className={`${field} min-w-0 flex-1`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dienst, z.B. Melken abends" />
        <input type="color" className="h-9 w-10 rounded border border-gray-300" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="Farbe" />
      </div>
      <p className="text-xs text-gray-500">Im Plan steht die Tierart vor dem Namen: «{typeLabel({ name: f.name || 'Dienst', animal: f.animal })}».</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-600">Standardzeit</span>
        <input type="time" step={900} className={field} value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} />
        <label className="flex items-center gap-1">
          <input className={`${field} w-20`} inputMode="numeric" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value.replace(/\D/g, '') })} /> min
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {DAYS.map((dd, i) => (
          <button key={dd} type="button" onClick={() => toggleDay(i)} className={`h-9 w-10 rounded-lg text-sm font-semibold ${f.weekdays[i] !== '0' ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-500'}`}>
            {dd}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> aktiv
        </label>
      </div>

      <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.windowOn} onChange={(e) => setF({ ...f, windowOn: e.target.checked })} /> nicht ganzjährig: nur in einem Zeitraum
        </label>
        {f.windowOn && (
          <div className="flex flex-wrap items-center gap-2 pl-6">
            von <MonthDay value={f.active_from} onChange={(v) => setF({ ...f, active_from: v })} label="aktiv von" /> bis{' '}
            <MonthDay value={f.active_to} onChange={(v) => setF({ ...f, active_to: v })} label="aktiv bis" />
            <span className="text-xs text-gray-500">{f.active_from > f.active_to ? 'über den Jahreswechsel' : 'jedes Jahr'}</span>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.ownTimes} onChange={(e) => setF({ ...f, ownTimes: e.target.checked })} /> Zeiten je Wochentag und Jahreszeit (Sommer/Winter)
        </label>
        {f.ownTimes && (
          <>
            <div className="flex flex-wrap items-center gap-2 pl-6">
              Sommer von <MonthDay value={f.summer_from} onChange={(v) => setF({ ...f, summer_from: v })} label="Sommer von" /> bis{' '}
              <MonthDay value={f.summer_to} onChange={(v) => setF({ ...f, summer_to: v })} label="Sommer bis" />
              <span className="text-xs text-gray-500">übrige Zeit = Winter</span>
            </div>
            <div className="flex gap-1">
              {(['sommer', 'winter'] as const).map((sn) => (
                <button key={sn} type="button" onClick={() => setSeason(sn)} className={`rounded-lg px-3 py-1.5 ${season === sn ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
                  {sn === 'sommer' ? '☀️ Sommer' : '❄️ Winter'}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-7 shrink-0" />
                <div className="min-w-0 flex-1">
                  <TimeAxis />
                </div>
                <span className="w-24 shrink-0" />
              </div>
              {DAYS.map((dd, i) => {
                const v = times[season][i]
                return (
                  <div key={dd} className="flex items-center gap-2">
                    <span className="w-7 shrink-0 text-xs font-semibold text-gray-600">{dd}</span>
                    <TimeStrip value={v} ghost={ghost} color={f.color} muted={f.weekdays[i] === '0'} onChange={(x) => setDay(season, i, x)} label={`${dd} ${season === 'sommer' ? 'Sommer' : 'Winter'}`} />
                    <span className="flex w-24 shrink-0 items-center justify-between text-xs tabular-nums text-gray-600">
                      {rangeText(v ?? ghost)}
                      {v ? (
                        <button type="button" className="px-1 text-gray-500" onClick={() => setDay(season, i, null)} aria-label={`${dd}: Standardzeit`} title="Standardzeit">
                          ×
                        </button>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} onClick={() => setAll(season, Array(7).fill(times[season][0] ?? ghost))}>
                Montag auf alle Tage
              </button>
              <button type="button" className={btn} onClick={() => setAll(season === 'sommer' ? 'winter' : 'sommer', [...times[season]])}>
                {season === 'sommer' ? 'Sommer → Winter kopieren' : 'Winter → Sommer kopieren'}
              </button>
            </div>
            <p className="text-xs text-gray-500">Ziehen = Zeit von–bis in 15-Minuten-Schritten, Tippen = 15 Minuten. Blass gestrichelt = Standardzeit. Tage ohne Dienst (grau) stellst du oben ein.</p>
          </>
        )}
      </div>

      <input className={`${field} w-full`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Hinweis für den Kalender, z.B. Füttern, Eier ausnehmen" />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
          disabled={!f.name.trim()}
          onClick={() =>
            void saveType({
              id: t.id ?? crypto.randomUUID(),
              name: f.name.trim(),
              animal: f.animal.trim() || null,
              start_time: f.start_time,
              duration_min: Number(f.duration_min) || 60,
              weekdays: f.weekdays,
              color: f.color,
              description: f.description.trim() || null,
              active: f.active,
              sort_order: t.sort_order ?? 100,
              active_from: f.windowOn ? f.active_from : null,
              active_to: f.windowOn ? f.active_to : null,
              summer_from: f.ownTimes ? f.summer_from : null,
              summer_to: f.ownTimes ? f.summer_to : null,
              times: f.ownTimes ? stringifyTimes(times) : null,
            }).then(onDone)
          }
        >
          Speichern
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Abbrechen
        </button>
        {t.id &&
          (confirmDel ? (
            <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 text-white" onClick={() => void deleteType(t.id!).then(onDone)}>
              Wirklich löschen? Eingeteilte Dienste verschwinden aus dem Plan.
            </button>
          ) : (
            <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-red-700" onClick={() => setConfirmDel(true)}>
              Löschen
            </button>
          ))}
      </div>
      <p className="text-xs text-gray-500">Änderungen gelten auch für schon eingeteilte Dienste (Uhrzeit im Kalender). Ausserhalb des Zeitraums gibt es den Dienst nicht; eingeteilte Personen bleiben gespeichert.</p>
    </div>
  )
}

function Feeds({ d }: { d: DutyData }) {
  const [links, setLinks] = useState<{ token: string; person_id: string | null; path: string }[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Server ${res.status}`)
    return res.json()
  }
  const load = () => call('/betrieb/duty/feed-tokens').then(setLinks).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  const full = (p: string) => (/^https?:/.test(API_URL) ? `${API_URL}${p}` : `${window.location.origin}${API_URL}${p}`)
  return (
    <section className="space-y-2 rounded-xl border bg-white p-3 text-sm">
      <h3 className="font-semibold text-gray-700">Kalender-Abo (Dienste im Handykalender)</h3>
      <p className="text-xs text-gray-600">
        Je Person ein geheimer Link. Im Handy als <b>Kalenderabo</b> hinzufügen: iPhone: Einstellungen → Kalender → Accounts → Kalenderabo hinzufügen. Android: Google
        Kalender im Browser → «Per URL hinzufügen», oder App ICSx⁵. Nextcloud-Kalender: «Neues Abonnement». Wird stündlich aktualisiert. Ein Link kann jederzeit
        gesperrt werden.
      </p>
      {!links ? (
        <button type="button" className={btn} onClick={() => void load()}>
          Links anzeigen
        </button>
      ) : (
        <ul className="divide-y">
          {[...d.people.filter((p) => p.active).map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: 'Alle Dienste (Übersicht)' }].map((p) => {
            const l = links.find((x) => x.person_id === p.id)
            return (
              <li key={p.id ?? 'all'} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-40 font-medium">{p.name}</span>
                {l ? (
                  <>
                    <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-1 text-xs">{full(l.path)}</code>
                    <button
                      type="button"
                      className={btn}
                      onClick={() =>
                        void navigator.clipboard.writeText(full(l.path)).then(
                          () => setCopied(l.token),
                          () => setCopied(null),
                        )
                      }
                    >
                      {copied === l.token ? '✓ kopiert' : 'Kopieren'}
                    </button>
                    <button type="button" className="text-xs text-red-700 underline" onClick={() => void call('/betrieb/duty/feed-token/revoke', { token: l.token }).then(load)}>
                      sperren
                    </button>
                  </>
                ) : (
                  <button type="button" className={btn} onClick={() => void call('/betrieb/duty/feed-token', { person_id: p.id }).then(load)}>
                    Link erzeugen
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {err && <p className="text-xs text-red-700">Geht nur mit Verbindung zum Server: {err}</p>}
    </section>
  )
}

function Settings({ d }: { d: DutyData }) {
  const [editType, setEditType] = useState<Partial<DutyType> | null>(null)
  const [newPerson, setNewPerson] = useState({ name: '', email: '' })
  const [editPerson, setEditPerson] = useState<DutyPerson | null>(null)
  const [confirmP, setConfirmP] = useState<string | null>(null)
  const has = (pid: string, tid: string) => d.skills.some((s) => s.person_id === pid && s.type_id === tid)
  const orderedTypes = groupTypes(d.types).flatMap((g) => g.types)
  const animals = [...new Set(d.types.map((t) => t.animal?.trim()).filter((a): a is string => !!a))]
  const people = d.people
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-xl border bg-white p-3 text-sm">
        <h3 className="font-semibold text-gray-700">Personen</h3>
        <ul className="divide-y">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
              {editPerson?.id === p.id ? (
                <>
                  <input className={field} value={editPerson.name} onChange={(e) => setEditPerson({ ...editPerson, name: e.target.value })} />
                  <input className={`${field} min-w-0 flex-1`} value={editPerson.email ?? ''} onChange={(e) => setEditPerson({ ...editPerson, email: e.target.value })} placeholder="E-Mail des FMIS-Kontos" />
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={editPerson.active} onChange={(e) => setEditPerson({ ...editPerson, active: e.target.checked })} /> aktiv
                  </label>
                  <button type="button" className={btn} onClick={() => void savePerson({ ...editPerson, name: editPerson.name.trim(), email: editPerson.email?.trim() || null }).then(() => setEditPerson(null))}>
                    Speichern
                  </button>
                  {confirmP === p.id ? (
                    <button type="button" className="rounded bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void deletePerson(p.id).then(() => setEditPerson(null))}>
                      Wirklich löschen?
                    </button>
                  ) : (
                    <button type="button" className="text-xs text-red-700 underline" onClick={() => setConfirmP(p.id)}>
                      löschen
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className="flex-1 text-left" onClick={() => setEditPerson(p)}>
                  <b className={p.active ? '' : 'text-gray-500 line-through'}>{p.name}</b> <span className="text-xs text-gray-500">{p.email ?? 'ohne FMIS-Konto'}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input className={field} value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} placeholder="Name" />
          <input className={`${field} min-w-0 flex-1`} value={newPerson.email} onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })} placeholder="E-Mail des FMIS-Kontos (optional)" />
          <button
            type="button"
            className={btn}
            disabled={!newPerson.name.trim()}
            onClick={() =>
              void savePerson({ id: crypto.randomUUID(), name: newPerson.name.trim(), email: newPerson.email.trim() || null, color: null, active: true, sort_order: people.length * 10, notes: null }).then(() =>
                setNewPerson({ name: '', email: '' }),
              )
            }
          >
            + Person
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-3 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-700">Dienste</h3>
          <button type="button" className={btn} onClick={() => setEditType({})}>
            + Dienst
          </button>
        </div>
        {editType && !editType.id && <TypeEditor t={editType} animals={animals} onDone={() => setEditType(null)} />}
        <div className="space-y-2">
          {groupTypes(d.types).map((g) => (
            <div key={g.animal ?? '–'}>
              <div className="mb-0.5 flex items-center gap-2 border-b pb-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500" style={{ borderColor: g.color ?? undefined }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color ?? '#64748b' }} />
                {g.animal ?? 'Übrige'}
              </div>
              <ul className="divide-y">
                {g.types.map((t) => (
                  <li key={t.id} className="py-1.5">
                    {editType?.id === t.id ? (
                      <TypeEditor t={t} animals={animals} onDone={() => setEditType(null)} />
                    ) : (
                      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setEditType(t)}>
                        <span className="h-3 w-3 rounded-full" style={{ background: t.color ?? '#64748b' }} />
                        <span className={`flex-1 ${t.active ? '' : 'text-gray-500 line-through'}`}>{t.name}</span>
                        <span className="text-right text-xs tabular-nums text-gray-500">
                          {t.start_time}–{endTime(t)} · {DAYS.filter((_, i) => t.weekdays[i] !== '0').join(' ')}
                          {t.active_from && t.active_to ? ` · ${t.active_from.slice(3)}.${t.active_from.slice(0, 2)}.–${t.active_to.slice(3)}.${t.active_to.slice(0, 2)}.` : ''}
                          {t.times ? ' · Sommer/Winter' : ''}
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-3 text-sm">
        <h3 className="font-semibold text-gray-700">Wer kann welchen Dienst?</h3>
        {people.length === 0 ? (
          <p className="text-gray-500">Zuerst Personen erfassen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th />
                  {groupTypes(d.types).map((g) => (
                    <th key={g.animal ?? '–'} colSpan={g.types.length} className="border-l px-1 pb-0.5 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: g.color ?? undefined, borderColor: g.color ?? undefined }}>
                      {g.animal ?? 'Übrige'}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th />
                  {orderedTypes.map((t) => (
                    <th key={t.id} className="border-l px-1 pb-1 align-bottom font-medium text-gray-600" style={{ borderColor: t.color ?? undefined }}>
                      <span className="block max-w-[5.5rem] leading-tight">{t.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.filter((p) => p.active).map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1 pr-2 font-medium">{p.name}</td>
                    {orderedTypes.map((t) => (
                      <td key={t.id} className="text-center">
                        <input type="checkbox" className="h-5 w-5" checked={has(p.id, t.id)} onChange={(e) => void setSkill(d.skills, p.id, t.id, e.target.checked)} aria-label={`${p.name}: ${typeLabel(t)}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Feeds d={d} />
    </div>
  )
}

/** Dienstplan: Wochenplan mit offenen Diensten und Warnungen, eigene Dienste
 * tauschen/abgeben, Abwesenheiten, Einstellungen (Personen, Dienste,
 * Fähigkeiten, Kalender-Abo). */
export default function Duty() {
  const canRead = useHasPermission('betrieb:dienste:read')
  const canWrite = useHasPermission('betrieb:dienste:write')
  const canPropose = useHasPermission('betrieb:wuensche:write')
  const [tab, setTab] = useStored<Tab>('wiesenjournal_duty_tab', 'woche')
  const [monday, setMonday] = useState(() => mondayOf(todayIso()))
  const from = addDays(monday < todayIso() ? monday : todayIso(), -7)
  const near = addDays(monday > todayIso() ? monday : todayIso(), 28)
  // Planung zeigt die Wochen bis zur Erzeugungsgrenze
  const far = addDays(mondayOf(todayIso()), GENERATE_AHEAD_WEEKS * 7 + 6)
  const to = tab === 'planung' && far > near ? far : near
  const { data, refresh } = useQuery((pg) => loadDuty(pg, from, to), [from, to])
  const overdue = data && canWrite ? weekStates(data.weeks, todayIso()).filter((w) => w.overdue).length : 0
  if (!canRead) return <p className="p-4 text-sm text-gray-600">Keine Berechtigung für den Dienstplan.</p>
  const tabs: [Tab, string][] = [
    ['woche', 'Woche'],
    ['meine', 'Meine Dienste'],
    ...(canWrite || canPropose ? ([['antraege', `Anträge${canWrite && data?.requests.some((r) => r.status === 'offen') ? ` (${data.requests.filter((r) => r.status === 'offen').length})` : ''}`]] as [Tab, string][]) : []),
    ['abwesend', 'Abwesend'],
    ...(canWrite
      ? ([
          ['planung', `Planung${overdue ? ` (${overdue} fällig)` : ''}`],
          ['einstellungen', 'Einstellungen'],
        ] as [Tab, string][])
      : []),
  ]
  // Reiter ohne Recht (z.B. auf einem geteilten Gerät gespeichert) zeigen die Woche
  const shown: Tab = !canWrite && (tab === 'planung' || tab === 'einstellungen') ? 'woche' : tab
  return (
    <div className={`mx-auto space-y-3 p-4 pb-24 ${shown === 'woche' ? 'max-w-6xl' : 'max-w-3xl'}`}>
      <h1 className="text-xl font-bold text-gray-800">Dienstplan</h1>
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${shown === k ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
            {l}
          </button>
        ))}
      </div>
      {!data ? (
        <p className="text-sm text-gray-500">Lädt…</p>
      ) : shown === 'woche' ? (
        <Week d={data} monday={monday} setMonday={setMonday} canWrite={canWrite} refresh={refresh} />
      ) : shown === 'meine' ? (
        <Mine d={data} canWrite={canWrite} canPropose={canPropose} refresh={refresh} />
      ) : shown === 'antraege' ? (
        <Requests d={data} canWrite={canWrite} canPropose={canPropose} refresh={refresh} />
      ) : shown === 'abwesend' ? (
        <Absences d={data} canWrite={canWrite} />
      ) : shown === 'planung' ? (
        <Planning
          d={data}
          refresh={refresh}
          openWeek={(m) => {
            setMonday(m)
            setTab('woche')
          }}
        />
      ) : (
        <Settings d={data} />
      )}
    </div>
  )
}
