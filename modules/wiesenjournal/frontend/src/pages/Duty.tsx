import { useMemo, useState } from 'react'
import { API_URL, getToken } from '@fmis/core/auth'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { useStored } from '../components/DriveAssist'
import { addDays, localToday as todayIso, conflictsFor, copyFromPrevious, endTime, hasConflict, isoWeek, mondayOf, slotsFor, suggest, weekDates, type Slot } from '../lib/duty'
import { assignSlots, deleteAbsence, deletePerson, deleteType, loadDuty, me, saveAbsence, savePerson, saveType, setSkill, type DutyData } from '../lib/dutyData'
import type { DutyAbsenceKind, DutyPerson, DutyType } from '../types'

type Tab = 'woche' | 'meine' | 'abwesend' | 'einstellungen'
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const KIND: Record<DutyAbsenceKind, string> = { ferien: 'Ferien', frei: 'frei', krank: 'krank', kurs: 'Kurs', andere: 'abwesend' }
const SEEN_KEY = 'wiesenjournal_duty_changes_seen'
const dm = (iso: string) => `${DAYS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7]} ${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`
const field = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm'
const btn = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm active:bg-gray-100 disabled:opacity-40'

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
      <span className="min-w-0 flex-1 text-sm text-gray-800">{s.type.name}</span>
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
      {c && hasConflict(c) && (
        <span className="w-full pl-5 text-xs text-amber-800">
          ⚠ {[c.absent && `${personName(d, pid)} ist ${KIND[c.absent.kind]}`, c.overlap.length && `gleichzeitig: ${c.overlap.join(', ')}`, c.unskilled && 'nicht als befähigt eingetragen'].filter(Boolean).join(' · ')}
        </span>
      )}
    </li>
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
  const typeName = (id: string) => d.types.find((t) => t.id === id)?.name ?? 'Dienst'

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
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${open ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
          {open ? `${open} offen` : 'alles abgedeckt'}
        </span>
      </div>
      {canWrite && open > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={busy} onClick={() => void run(copyFromPrevious(slots, prevSlots, d.skills, d.absences), 'Wie Vorwoche')}>
            Wie Vorwoche
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => void run(suggest(slots, d.people, d.skills, d.absences), 'Vorschlag')}>
            Offene vorschlagen
          </button>
        </div>
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

      {dates.map((date) => {
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
              <p className="px-2 py-1.5 text-xs text-gray-400">keine Dienste</p>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Eigene Dienste der nächsten 3 Wochen: abgeben oder tauschen. */
function Mine({ d, canWrite, refresh }: { d: DutyData; canWrite: boolean; refresh: () => void }) {
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
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        Dienste von <b>{self.name}</b>, nächste 3 Wochen.
      </p>
      {mine.length === 0 && <p className="text-sm text-gray-500">Keine Dienste eingeteilt.</p>}
      <ul className="divide-y rounded-xl border bg-white">
        {mine.map((s) => {
          const candidates = d.people.filter((p) => p.active && p.id !== self.id && d.skills.some((k) => k.person_id === p.id && k.type_id === s.type.id))
          const theirs = to ? slots.filter((o) => o.shift?.person_id === to && o.date >= today && d.skills.some((k) => k.person_id === self.id && k.type_id === o.type.id)) : []
          return (
            <li key={s.id} className="space-y-2 p-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: s.type.color ?? '#64748b' }} />
                <span className="w-28 text-sm font-medium">{dm(s.date)}</span>
                <span className="flex-1 text-sm">
                  {s.type.start_time} · {s.type.name}
                </span>
                {canWrite && (
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
                    Tauschen / abgeben
                  </button>
                )}
              </div>
              {openId === s.id && (
                <div className="space-y-2 rounded-lg bg-gray-50 p-2 text-sm">
                  <label className="flex flex-wrap items-center gap-2">
                    an
                    <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value="">— Person wählen —</option>
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
                            {dm(o.date)} {o.type.start_time} {o.type.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <input className={`${field} w-full`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bemerkung (optional)" />
                  <button
                    type="button"
                    disabled={!to}
                    className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
                    onClick={() => {
                      const other = theirs.find((o) => o.id === back)
                      void assignSlots([
                        { slot: s, personId: to, kind: other ? 'tausch' : 'abgabe', notes: note || null },
                        ...(other ? [{ slot: other, personId: self.id, kind: 'tausch' as const, notes: note || null }] : []),
                      ]).then(() => {
                        setOpenId(null)
                        refresh()
                      })
                    }}
                  >
                    {back ? 'Tauschen' : 'Abgeben'}
                  </button>
                  <p className="text-xs text-gray-500">Wird sofort übernommen und erscheint für alle unter «Änderungen».</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
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
                <button type="button" className="px-1 text-gray-400" onClick={() => setConfirmId(a.id)} aria-label="Abwesenheit löschen">
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

function TypeEditor({ t, onDone }: { t: Partial<DutyType>; onDone: () => void }) {
  const [f, setF] = useState({
    name: t.name ?? '',
    start_time: t.start_time ?? '06:00',
    duration_min: String(t.duration_min ?? 60),
    weekdays: t.weekdays ?? '1111111',
    color: t.color ?? '#2563eb',
    description: t.description ?? '',
    active: t.active ?? true,
  })
  const [confirmDel, setConfirmDel] = useState(false)
  const toggleDay = (i: number) => setF({ ...f, weekdays: f.weekdays.slice(0, i) + (f.weekdays[i] === '0' ? '1' : '0') + f.weekdays.slice(i + 1) })
  return (
    <div className="space-y-2 rounded-lg bg-gray-50 p-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <input className={`${field} min-w-0 flex-1`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name, z.B. Melken Kühe abends" />
        <input type="time" className={field} value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} />
        <label className="flex items-center gap-1">
          <input className={`${field} w-20`} inputMode="numeric" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value.replace(/\D/g, '') })} /> min
        </label>
        <input type="color" className="h-9 w-10 rounded border border-gray-300" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="Farbe" />
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
              start_time: f.start_time,
              duration_min: Number(f.duration_min) || 60,
              weekdays: f.weekdays,
              color: f.color,
              description: f.description.trim() || null,
              active: f.active,
              sort_order: t.sort_order ?? 100,
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
      <p className="text-xs text-gray-500">Änderungen gelten auch für schon eingeteilte Dienste (Uhrzeit im Kalender). Saisonal: «aktiv» abwählen statt löschen.</p>
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
  const load = () => call('/wiesenjournal/duty/feed-tokens').then(setLinks).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
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
                    <button type="button" className="text-xs text-red-700 underline" onClick={() => void call('/wiesenjournal/duty/feed-token/revoke', { token: l.token }).then(load)}>
                      sperren
                    </button>
                  </>
                ) : (
                  <button type="button" className={btn} onClick={() => void call('/wiesenjournal/duty/feed-token', { person_id: p.id }).then(load)}>
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
                  <b className={p.active ? '' : 'text-gray-400 line-through'}>{p.name}</b> <span className="text-xs text-gray-500">{p.email ?? 'ohne FMIS-Konto'}</span>
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
        {editType && !editType.id && <TypeEditor t={editType} onDone={() => setEditType(null)} />}
        <ul className="divide-y">
          {d.types.map((t) => (
            <li key={t.id} className="py-1.5">
              {editType?.id === t.id ? (
                <TypeEditor t={t} onDone={() => setEditType(null)} />
              ) : (
                <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setEditType(t)}>
                  <span className="h-3 w-3 rounded-full" style={{ background: t.color ?? '#64748b' }} />
                  <span className={`flex-1 ${t.active ? '' : 'text-gray-400 line-through'}`}>{t.name}</span>
                  <span className="text-xs tabular-nums text-gray-500">
                    {t.start_time}–{endTime(t)} · {DAYS.filter((_, i) => t.weekdays[i] !== '0').join(' ')}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
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
                  {d.types.map((t) => (
                    <th key={t.id} className="px-1 pb-1 align-bottom font-medium text-gray-600">
                      <span className="block max-w-[5.5rem] leading-tight">{t.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.filter((p) => p.active).map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1 pr-2 font-medium">{p.name}</td>
                    {d.types.map((t) => (
                      <td key={t.id} className="text-center">
                        <input type="checkbox" className="h-5 w-5" checked={has(p.id, t.id)} onChange={(e) => void setSkill(d.skills, p.id, t.id, e.target.checked)} aria-label={`${p.name}: ${t.name}`} />
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
  const canRead = useHasPermission('wiesenjournal:dienste:read')
  const canWrite = useHasPermission('wiesenjournal:dienste:write')
  const [tab, setTab] = useStored<Tab>('wiesenjournal_duty_tab', 'woche')
  const [monday, setMonday] = useState(() => mondayOf(todayIso()))
  const from = addDays(monday < todayIso() ? monday : todayIso(), -7)
  const to = addDays(monday > todayIso() ? monday : todayIso(), 28)
  const { data, refresh } = useQuery((pg) => loadDuty(pg, from, to), [from, to])
  if (!canRead) return <p className="p-4 text-sm text-gray-600">Keine Berechtigung für den Dienstplan.</p>
  const tabs: [Tab, string][] = [
    ['woche', 'Woche'],
    ['meine', 'Meine Dienste'],
    ['abwesend', 'Abwesend'],
    ...(canWrite ? ([['einstellungen', 'Einstellungen']] as [Tab, string][]) : []),
  ]
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Dienstplan</h1>
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${tab === k ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
            {l}
          </button>
        ))}
      </div>
      {!data ? (
        <p className="text-sm text-gray-500">Lädt…</p>
      ) : tab === 'woche' ? (
        <Week d={data} monday={monday} setMonday={setMonday} canWrite={canWrite} refresh={refresh} />
      ) : tab === 'meine' ? (
        <Mine d={data} canWrite={canWrite} refresh={refresh} />
      ) : tab === 'abwesend' ? (
        <Absences d={data} canWrite={canWrite} />
      ) : (
        <Settings d={data} />
      )}
    </div>
  )
}
