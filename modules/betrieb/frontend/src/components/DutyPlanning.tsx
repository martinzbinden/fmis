import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getSyncedDb as getDb } from '../db/access'
import { addDays, canDo, groupTypes, isoWeek, localToday as todayIso, mondayOf, overlaps, slotsFor, timeRange, typeLabel, weekDates } from '../lib/duty'
import { adjustWeek, copyTemplate, deleteTemplate, generateWeeks, saveTemplate, setTemplateSlot, setWeekStatus, templateFromWeek, type DutyData } from '../lib/dutyData'
import { confirmDeadline, GENERATE_AHEAD_WEEKS, templateOn, templateSlotsFromWeek, weekStates } from '../lib/dutyPlan'
import type { DutyTemplate, DutyType } from '../types'

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
      setMsg(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
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
