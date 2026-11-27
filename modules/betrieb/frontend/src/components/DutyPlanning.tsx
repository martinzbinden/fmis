import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getSyncedDb as getDb } from '../db/access'
import { addDays, canDo, groupTypes, isoWeek, localToday as todayIso, mondayOf, overlaps, slotsFor, timeRange, typeLabel, weekDates } from '../lib/duty'
import { adjustWeek, copyTemplate, deleteTemplate, generateWeeks, saveTemplate, setTemplateSlot, setWeekStatus, templateFromWeek, type DutyData } from '../lib/dutyData'
import { confirmDeadline, GENERATE_AHEAD_WEEKS, templateOn, templateSlotsFromWeek, weekStates } from '../lib/dutyPlan'
import type { DutyTemplate, DutyType } from '../types'
import { errorText } from '@fmis/core/toast'
import { fmtHours, loadFulltimeHours, saveFulltimeHours, targetMinutes } from '../lib/workload'
import NumberInput from '@fmis/core/NumberInput'

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const field = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm'
const btn = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm active:bg-gray-100 disabled:opacity-40'
const dmy = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`

/** Abgehobene Leiste für Bedienelemente des Büros (betrieb:dienste:write). */
export function OfficeBar({ children, title = 'Büro' }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50 p-2">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-800">🗂 {title}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

const STATUS: Record<'entwurf' | 'bestaetigt' | 'fehlt', string> = { entwurf: 'Entwurf', bestaetigt: 'bestätigt', fehlt: 'nicht erzeugt' }

/** Planung (Büro): Wochen aus dem Standardplan erzeugen, an Abwesenheiten anpassen und bestätigen
 * (spätestens 2 Monate im Voraus); Standardpläne mit Versionen. */
export default function Planning({ d, refresh, openWeek }: { d: DutyData; refresh: () => void; openWeek: (monday: string) => void }) {
  const today = todayIso()
  const states = useMemo(() => weekStates(d.weeks, today), [d.weeks, today])
  const overdue = states.filter((s) => s.overdue)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const generated = useRef(false)

  const run = async (job: () => Promise<string | null>) => {
    setBusy(true)
    try {
      setMsg(await job())
    } catch (e) {
      setMsg(`Fehler: ${errorText(e)}`)
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const generate = () =>
    run(async () => {
      const r = await generateWeeks(await getDb(), d, mondayOf(today), addDays(mondayOf(today), GENERATE_AHEAD_WEEKS * 7))
      if (!r.created) return null
      return `${r.created} ${r.created === 1 ? 'Woche' : 'Wochen'} als Entwurf erzeugt.${r.unfilled.length ? ` Offen geblieben: ${r.unfilled.join(' · ')}` : ''}`
    })

  // Beim Öffnen der Planung fehlende Wochen aus dem Standardplan erzeugen (gleiche Woche = gleiche Zeilen
  // auf jedem Gerät). Nur beim Öffnen, nicht sobald eine neue Vorlage entsteht: die ist dann noch leer.
  useEffect(() => {
    if (generated.current) return
    generated.current = true
    if (d.templates.length > 0) void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCount = (monday: string) => slotsFor(d.types, d.shifts, weekDates(monday)).filter((s) => !s.shift?.person_id).length
  // Pensum der Angestellten je Woche: eingeteilte Minuten gegen das Soll (lib/workload.ts)
  const fulltime = loadFulltimeHours()
  const employed = d.people.filter((p) => p.active && !p.deleted_at && p.employment_pct != null)
  const pensum = (monday: string) => {
    const min = new Map<string, number>()
    for (const s of slotsFor(d.types, d.shifts, weekDates(monday))) if (s.shift?.person_id) min.set(s.shift.person_id, (min.get(s.shift.person_id) ?? 0) + Math.max(0, s.type.duration_min))
    return employed.map((p) => {
      const soll = targetMinutes(p, fulltime) ?? 0
      const have = min.get(p.id) ?? 0
      return { p, have, soll, off: soll > 0 && Math.abs(have - soll) / soll > 0.15 }
    })
  }
  const editing = d.templates.find((t) => t.id === editId) ?? null

  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-900">
          {overdue.length} {overdue.length === 1 ? 'Woche ist' : 'Wochen sind'} noch nicht bestätigt, obwohl sie bis {dmy(confirmDeadline(today))} beginnen (Frist 2 Monate).
        </p>
      )}
      {d.templates.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Noch kein Standardplan. Lege unten einen an (leer oder aus einer eingeteilten Woche); danach erzeugt FMIS die Wochen als Entwurf.</p>
      )}
      {msg && <p className="rounded bg-sky-50 px-2 py-1 text-sm text-sky-900">{msg}</p>}

      <section className="space-y-2">
        <OfficeBar title="Wochen">
          <button type="button" className={btn} disabled={busy || d.templates.length === 0} onClick={() => void generate()}>
            Fehlende Wochen erzeugen
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || d.templates.length === 0 || !states.some((s) => s.status === 'entwurf')}
            onClick={() =>
              void run(async () => {
                const pg = await getDb()
                let changed = 0
                const unfilled: string[] = []
                for (const s of states.filter((x) => x.status === 'entwurf')) {
                  const r = await adjustWeek(pg, d, s.monday)
                  changed += r.changed
                  unfilled.push(...r.unfilled)
                }
                return `Entwürfe angepasst: ${changed} Dienste.${unfilled.length ? ` Offen: ${unfilled.join(' · ')}` : ''}`
              })
            }
          >
            Alle Entwürfe anpassen
          </button>
          {overdue.some((s) => s.status === 'entwurf') &&
            (confirmAll ? (
              <button
                type="button"
                className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const due = overdue.filter((s) => s.status === 'entwurf')
                    for (const s of due) await setWeekStatus(d, s.monday, 'bestaetigt')
                    setConfirmAll(false)
                    return `${due.length} Wochen bestätigt.`
                  })
                }
              >
                Wirklich {overdue.filter((s) => s.status === 'entwurf').length} Wochen bestätigen?
              </button>
            ) : (
              <button type="button" className={btn} onClick={() => setConfirmAll(true)}>
                Alle fälligen bestätigen
              </button>
            ))}
        </OfficeBar>
        <ul className="divide-y rounded-xl border bg-white text-sm">
          {states.map((s) => {
            const n = openCount(s.monday)
            const tpl = templateOn(d.templates, s.monday)
            return (
              <li key={s.monday} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openWeek(s.monday)}>
                  <span className="font-semibold">KW {isoWeek(s.monday)}</span> <span className="text-gray-600">{dm(s.monday)}–{dm(addDays(s.monday, 6))}</span>
                  <span className="block text-xs text-gray-500">
                    {tpl ? tpl.name : 'kein Standardplan'}
                    {n ? ` · ${n} offen` : ''}
                  </span>
                  {employed.length > 0 && (
                    <span className="block text-xs text-gray-600" title="Eingeteilte Stunden / Soll aus Anstellung − Schule/ÜK (Einstellungen → Personen)">
                      {pensum(s.monday).map((x, i) => (
                        <span key={x.p.id} className={x.off ? 'font-semibold text-amber-800' : ''}>
                          {i > 0 ? ' · ' : ''}
                          {x.p.name.split(/\s+/).slice(-1)[0]} {fmtHours(x.have)}/{fmtHours(x.soll)} h
                        </span>
                      ))}
                    </span>
                  )}
                </button>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    s.status === 'bestaetigt' ? 'bg-emerald-100 text-emerald-800' : s.overdue ? 'bg-red-100 text-red-800' : s.status === 'entwurf' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {STATUS[s.status]}
                  {s.overdue ? ' · fällig' : ''}
                </span>
                {s.status === 'entwurf' && (
                  <>
                    <button type="button" className={btn} disabled={busy} onClick={() => void run(async () => {
                      const r = await adjustWeek(await getDb(), d, s.monday)
                      return `KW ${isoWeek(s.monday)}: ${r.changed} Dienste angepasst.${r.unfilled.length ? ` Offen: ${r.unfilled.join(' · ')}` : ''}`
                    })}>
                      Anpassen
                    </button>
                    <button type="button" className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy} onClick={() => void run(async () => {
                      await setWeekStatus(d, s.monday, 'bestaetigt')
                      return null
                    })}>
                      Bestätigen
                    </button>
                  </>
                )}
                {s.status === 'fehlt' && (
                  <button type="button" className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy} onClick={() => void run(async () => {
                    await setWeekStatus(d, s.monday, 'bestaetigt')
                    return null
                  })}>
                    Bestätigen
                  </button>
                )}
                {s.status === 'bestaetigt' && (
                  <button type="button" className={btn} disabled={busy} onClick={() => void run(async () => {
                    await setWeekStatus(d, s.monday, 'entwurf')
                    return null
                  })}>
                    Zurück auf Entwurf
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-gray-500">
          «Anpassen» füllt offene Plätze aus dem Standardplan und ersetzt Personen, die laut Abwesenheiten fehlen. Mitarbeitende sehen Entwürfe als «vorläufig». Bestätigte Wochen
          ändert FMIS nicht mehr von selbst.
        </p>
      </section>

      <Templates d={d} editing={editing} setEditId={setEditId} />
    </div>
  )
}

function Templates({ d, editing, setEditId }: { d: DutyData; editing: DutyTemplate | null; setEditId: (id: string | null) => void }) {
  const today = todayIso()
  const [form, setForm] = useState<{ mode: 'copy' | 'week' | 'empty'; name: string; valid_from: string; source: string; week: string } | null>(null)
  const sorted = [...d.templates].sort((a, b) => b.valid_from.localeCompare(a.valid_from))
  const current = templateOn(d.templates, today)
  const until = (t: DutyTemplate) => {
    const next = d.templates.filter((x) => x.valid_from > t.valid_from).sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0]
    return next ? `bis ${dmy(addDays(next.valid_from, -1))}` : 'ohne Ende'
  }
  const weekOptions = Array.from({ length: 6 }, (_, i) => addDays(mondayOf(today), (i - 4) * 7))
  return (
    <section className="space-y-2">
      <OfficeBar title="Standardpläne (Vorlagen)">
        <button type="button" className={btn} onClick={() => setForm({ mode: current ? 'copy' : 'empty', name: '', valid_from: addDays(mondayOf(today), 7), source: current?.id ?? '', week: mondayOf(today) })}>
          + Neue Version ab Datum
        </button>
        <button type="button" className={btn} onClick={() => setForm({ mode: 'week', name: '', valid_from: addDays(mondayOf(today), 7), source: '', week: mondayOf(today) })}>
          + Aus eingeteilter Woche
        </button>
      </OfficeBar>
      {form && (
        <div className="space-y-2 rounded-xl border bg-white p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <input className={`${field} min-w-0 flex-1`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name, z.B. Winter 2026/27" />
            <label className="flex items-center gap-1">
              gilt ab <input type="date" className={field} value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
            </label>
          </div>
          {form.mode !== 'week' ? (
            <label className="flex flex-wrap items-center gap-2">
              Inhalt
              <select className={field} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value, mode: e.target.value ? 'copy' : 'empty' })}>
                <option value="">leer beginnen</option>
                {sorted.map((t) => (
                  <option key={t.id} value={t.id}>
                    Kopie von «{t.name}» (ab {dmy(t.valid_from)})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-wrap items-center gap-2">
              Einteilung der Woche
              <select className={field} value={form.week} onChange={(e) => setForm({ ...form, week: e.target.value })}>
                {weekOptions.map((m) => (
                  <option key={m} value={m}>
                    KW {isoWeek(m)} · {dm(m)}–{dm(addDays(m, 6))}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-indigo-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
              disabled={!form.name.trim() || !form.valid_from}
              onClick={() => {
                const job =
                  form.mode === 'week'
                    ? templateFromWeek(templateSlotsFromWeek(slotsFor(d.types, d.shifts, weekDates(form.week)), form.week), form.name.trim(), form.valid_from)
                    : copyTemplate(d, form.source || null, form.name.trim(), form.valid_from)
                void job.then((id) => {
                  setForm(null)
                  setEditId(id)
                })
              }}
            >
              Anlegen
            </button>
            <button type="button" className={btn} onClick={() => setForm(null)}>
              Abbrechen
            </button>
          </div>
          <p className="text-xs text-gray-500">Der bisherige Plan bleibt erhalten und gilt bis zum Vortag. Schon erzeugte Wochen ab diesem Datum passt «Anpassen» nur bei offenen Plätzen an.</p>
        </div>
      )}
      <ul className="divide-y rounded-xl border bg-white text-sm">
        {sorted.map((t) => (
          <li key={t.id} className="px-3 py-2">
            <button type="button" className="flex w-full flex-wrap items-baseline gap-2 text-left" onClick={() => setEditId(editing?.id === t.id ? null : t.id)}>
              <span className="font-semibold">{t.name}</span>
              <span className="text-xs text-gray-600">
                ab {dmy(t.valid_from)} {until(t)}
                {t.cycle_weeks > 1 ? ` · ${t.cycle_weeks}-Wochen-Rhythmus` : ''}
              </span>
              {current?.id === t.id && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">gilt jetzt</span>}
            </button>
            {editing?.id === t.id && <TemplateEditor d={d} t={t} onClose={() => setEditId(null)} />}
          </li>
        ))}
        {sorted.length === 0 && <li className="px-3 py-2 text-gray-500">Noch keine Standardpläne.</li>}
      </ul>
    </section>
  )
}

/** Raster eines Standardplans: Dienste (nach Tierart) × Wochentage, je Platz eine Person. */
function TemplateEditor({ d, t, onClose }: { d: DutyData; t: DutyTemplate; onClose: () => void }) {
  const [weekNo, setWeekNo] = useState(0)
  const [mode, setMode] = useState<'dienst' | 'person'>('dienst')
  const [fulltime, setFulltime] = useState(loadFulltimeHours)
  const [who, setWho] = useState<string>(() => d.people.find((p) => p.active && !p.companion)?.id ?? '')
  const [meta, setMeta] = useState({ name: t.name, valid_from: t.valid_from, cycle_weeks: t.cycle_weeks })
  const [confirmDel, setConfirmDel] = useState(false)
  const types = groupTypes(d.types.filter((x) => x.active)).flatMap((g) => g.types)
  const slotsOf = (ty: DutyType) => Math.max(0, ...ty.weekdays.split('').map(Number).filter(Number.isFinite))
  const cell = (ty: DutyType, wd: number, slot: number) =>
    d.templateSlots.find((s) => s.template_id === t.id && s.week_no === weekNo && s.weekday === wd && s.type_id === ty.id && s.slot === slot)?.person_id ?? null
  // gleiche Person zur gleichen Zeit am selben Wochentag?
  const clash = (ty: DutyType, wd: number, pid: string | null) =>
    !!pid &&
    types.some(
      (o) =>
        o.id !== ty.id &&
        Array.from({ length: slotsOf(o) }, (_, k) => k).some((k) => cell(o, wd, k) === pid) &&
        overlaps(timeRange(ty), timeRange(o)),
    )
  const people = d.people.filter((p) => p.active)
  // Pensum laut Standardplan (diese Woche des Zyklus): Dauer der Dienste je Person (Grundzeit, ohne Sommer/Winter)
  const tplMinutes = new Map<string, number>()
  for (const ty of types)
    for (let wd = 0; wd < 7; wd++)
      for (let k = 0; k < Number(ty.weekdays[wd] ?? 0); k++) {
        const pid = cell(ty, wd, k)
        if (pid) tplMinutes.set(pid, (tplMinutes.get(pid) ?? 0) + Math.max(0, ty.duration_min))
      }
  const dirty = meta.name !== t.name || meta.valid_from !== t.valid_from || meta.cycle_weeks !== t.cycle_weeks
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2">
        <input className={`${field} min-w-0 flex-1`} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} aria-label="Name" />
        <label className="flex items-center gap-1">
          ab <input type="date" className={field} value={meta.valid_from} onChange={(e) => setMeta({ ...meta, valid_from: e.target.value })} />
        </label>
        <label className="flex items-center gap-1">
          Rhythmus
          <select className={field} value={meta.cycle_weeks} onChange={(e) => setMeta({ ...meta, cycle_weeks: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'jede Woche gleich' : `${n} Wochen`}
              </option>
            ))}
          </select>
        </label>
        {dirty && (
          <button type="button" className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => void saveTemplate({ id: t.id, name: meta.name.trim() || t.name, valid_from: meta.valid_from, cycle_weeks: meta.cycle_weeks, notes: t.notes })}>
            Speichern
          </button>
        )}
      </div>
      {t.cycle_weeks > 1 && (
        <div className="flex gap-1">
          {Array.from({ length: t.cycle_weeks }, (_, i) => (
            <button key={i} type="button" onClick={() => setWeekNo(i)} className={`rounded-lg px-3 py-1 text-sm ${weekNo === i ? 'bg-indigo-700 text-white' : 'border border-gray-300 bg-white'}`}>
              Woche {String.fromCharCode(65 + i)}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
          {(['dienst', 'person'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`px-2 py-1 ${mode === m ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}>
              {m === 'dienst' ? 'nach Dienst' : 'nach Person'}
            </button>
          ))}
        </span>
        {mode === 'person' && (
          <select className={field} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {mode === 'person' ? (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white" />
                {DAYS.map((x) => (
                  <th key={x} className="px-1 pb-1 font-semibold text-gray-600">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {types.map((ty) => (
                <tr key={ty.id} className="border-t">
                  <td className="sticky left-0 max-w-[10rem] bg-white py-1 pr-2 leading-tight">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: ty.color ?? '#64748b' }} />
                    {typeLabel(ty)}
                    <span className="block text-[10px] text-gray-500">
                      {ty.start_time} · {fmtHours(ty.duration_min)} h
                    </span>
                  </td>
                  {DAYS.map((_, wd) => {
                    const n = Number(ty.weekdays[wd] ?? 0)
                    if (n === 0) return <td key={wd} className="text-center text-gray-300">–</td>
                    const ks = Array.from({ length: n }, (_, k) => k)
                    const mine = ks.filter((k) => cell(ty, wd, k) === who)
                    const free = ks.find((k) => !cell(ty, wd, k))
                    const others = ks.map((k) => cell(ty, wd, k)).filter((x): x is string => !!x && x !== who)
                    const skilled = canDo(who, ty.id, d.skills)
                    const on = mine.length > 0
                    const blocked = !on && (free == null || !skilled)
                    const warn = on && (clash(ty, wd, who) || !skilled)
                    const otherNames = others.map((id) => d.people.find((p) => p.id === id)?.name.split(/\s+/).slice(-1)[0] ?? '?').join(', ')
                    return (
                      <td key={wd} className="px-0.5 py-0.5 text-center">
                        <label
                          className={`flex min-h-11 min-w-11 flex-col items-center justify-center rounded border ${on ? (warn ? 'border-amber-500 bg-amber-50' : 'border-indigo-600 bg-indigo-50') : blocked ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-300'}`}
                          title={!skilled ? 'nicht befähigt (Einstellungen → «Wer kann welchen Dienst?»)' : free == null && !on ? `besetzt: ${otherNames}` : warn ? 'gleichzeitig eingeteilt' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={blocked || !who}
                            onChange={(e) => {
                              if (e.target.checked && free != null) void setTemplateSlot(t.id, weekNo, wd, ty.id, free, who)
                              else for (const k of mine) void setTemplateSlot(t.id, weekNo, wd, ty.id, k, null)
                            }}
                            aria-label={`${typeLabel(ty)} ${DAYS[wd]}`}
                          />
                          {otherNames && <span className="max-w-[3.5rem] truncate text-[9px] leading-tight text-gray-500">{otherNames}</span>}
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white" />
              {DAYS.map((x) => (
                <th key={x} className="px-1 pb-1 font-semibold text-gray-600">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.flatMap((ty) =>
              Array.from({ length: slotsOf(ty) }, (_, slot) => (
                <tr key={`${ty.id}-${slot}`} className="border-t">
                  <td className="sticky left-0 max-w-[9rem] bg-white py-1 pr-2 leading-tight">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: ty.color ?? '#64748b' }} />
                    {typeLabel(ty)}
                    {slotsOf(ty) > 1 ? ` (${slot + 1})` : ''}
                  </td>
                  {DAYS.map((_, wd) => {
                    const exists = Number(ty.weekdays[wd] ?? 0) > slot
                    if (!exists) return <td key={wd} className="text-center text-gray-300">–</td>
                    const pid = cell(ty, wd, slot)
                    const skilled = people.filter((p) => canDo(p.id, ty.id, d.skills))
                    const options = pid && !skilled.some((p) => p.id === pid) ? [...skilled, ...people.filter((p) => p.id === pid)] : skilled
                    const warn = clash(ty, wd, pid) || (pid && !canDo(pid, ty.id, d.skills))
                    return (
                      <td key={wd} className="px-0.5 py-0.5">
                        <select
                          value={pid ?? ''}
                          onChange={(e) => void setTemplateSlot(t.id, weekNo, wd, ty.id, slot, e.target.value || null)}
                          className={`w-[5.5rem] rounded border px-1 py-1 text-xs ${!pid ? 'border-red-300 bg-red-50' : warn ? 'border-amber-500 bg-amber-50' : 'border-gray-300'}`}
                          aria-label={`${typeLabel(ty)} ${DAYS[wd]}`}
                          title={warn ? 'gleichzeitig eingeteilt oder nicht befähigt' : undefined}
                        >
                          <option value="">— offen —</option>
                          {options.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      )}
      <div className="rounded-lg bg-gray-50 p-2 text-xs">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-700">Pensum laut Standardplan{t.cycle_weeks > 1 ? ` (Woche ${String.fromCharCode(65 + weekNo)})` : ''}</span>
          <label className="flex items-center gap-1 text-gray-600">
            Vollzeit
            <NumberInput
              step={1}
              className={`${field} w-16`}
              value={fulltime || ''}
              aria-label="Vollzeit in Stunden je Woche"
              onChange={(e) => {
                const v = Number(e.target.value)
                setFulltime(v)
                if (v >= 10 && v <= 80) saveFulltimeHours(v)
              }}
            />
            h/Woche
          </label>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
          {people
            .filter((p) => tplMinutes.has(p.id) || p.employment_pct != null)
            .map((p) => {
              const have = tplMinutes.get(p.id) ?? 0
              const soll = targetMinutes(p, fulltime)
              const off = soll != null && soll > 0 && Math.abs(have - soll) / soll > 0.15
              return (
                <li key={p.id} className={off ? 'font-semibold text-amber-800' : 'text-gray-800'}>
                  {p.name}: {fmtHours(have)} h{soll != null ? ` / Soll ${fmtHours(soll)} h` : ''}
                </li>
              )
            })}
        </ul>
        <p className="mt-1 text-gray-500">Soll = (Anstellung − Schule/ÜK) × Vollzeit. Beim Einteilen kommen zuerst Angestellte unter dem Soll, dann Personen ohne Anstellung, zuletzt solche über dem Soll.</p>
      </div>
      <p className="text-xs text-gray-500">Änderungen werden sofort gespeichert. Auswahl nur unter Personen, die den Dienst können (Einstellungen → «Wer kann welchen Dienst?»). Gelb = gleichzeitig eingeteilt oder nicht befähigt.</p>
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={onClose}>
          Schliessen
        </button>
        {confirmDel ? (
          <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white" onClick={() => void deleteTemplate(t.id).then(onClose)}>
            Wirklich löschen? Schon erzeugte Wochen bleiben.
          </button>
        ) : (
          <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700" onClick={() => setConfirmDel(true)}>
            Löschen
          </button>
        )}
      </div>
    </div>
  )
}
