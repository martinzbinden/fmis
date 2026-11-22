import { useEffect, useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { hasConflict, timeText, typeLabel, type Conflict } from '../lib/duty'
import { assignSlots, type DutyData } from '../lib/dutyData'
import { dateRange, findGaps, GAP_MAX_DAYS, type Gap } from '../lib/dutyGaps'
import { isoDate } from '../lib/format'
import type { DutyAbsence, DutyShift } from '../types'

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const dm = (iso: string) => `${DAYS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7]} ${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`
const btn = 'min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm active:bg-gray-100 disabled:opacity-40'

const KIND_TEXT: Record<string, string> = { ferien: 'Ferien', frei: 'frei', krank: 'krank', kurs: 'Kurs', schule: 'Schule', andere: 'abwesend' }

/** Warum jemand nicht einspringen kann (kurz). */
function conflictText(c: Conflict): string {
  if (c.absent) return KIND_TEXT[c.absent.kind] ?? 'abwesend'
  if (c.overlap.length) return `gleichzeitig ${c.overlap[0]}`
  if (c.unskilled) return 'nicht befähigt'
  return ''
}

/** Dienste und Abwesenheiten des Zeitraums (kann ausserhalb des geladenen Dienstplans liegen). */
async function loadRange(pg: PGlite, from: string, to: string) {
  const [shifts, absences] = await Promise.all([
    pg.query<DutyShift>('select * from duty_shifts where deleted_at is null and date between $1 and $2', [from, to]),
    pg.query<DutyAbsence>('select * from duty_absences where deleted_at is null and to_date >= $1 and from_date <= $2', [from, to]),
  ])
  return {
    shifts: shifts.rows.map((s) => ({ ...s, date: isoDate(s.date), slot: Number(s.slot) })),
    absences: absences.rows.map((a) => ({ ...a, from_date: isoDate(a.from_date), to_date: isoDate(a.to_date) })),
  }
}

/** Lücken durch eine Abwesenheit: Dienste der Person laut Dienstplan oder Standardplan, mit Ersatz zum Einsetzen.
 * Erscheint nach dem Eintragen von Ferien und nach dem Bestätigen eines Antrags (Büro), und auf Wunsch bei jeder
 * Abwesenheit in der Liste. */
export default function AbsenceGaps({ d, personId, from, to, onClose }: { d: DutyData; personId: string; from: string; to: string; onClose?: () => void }) {
  const dates = dateRange(from, to)
  const last = dates[dates.length - 1] ?? to
  const { data } = useQuery((pg) => loadRange(pg, from, last), [from, last])
  const gaps = useMemo(
    () =>
      data
        ? findGaps({ personId, from, to: last, types: d.types, shifts: data.shifts, templates: d.templates, templateSlots: d.templateSlots, people: d.people, skills: d.skills, absences: data.absences })
        : null,
    [data, d, personId, from, last],
  )
  // gewählter Ersatz je Platz (Vorgabe: Vorschlag)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => setPick({}), [personId, from, to])
  const name = (id: string | null | undefined) => d.people.find((p) => p.id === id)?.name ?? '?'
  const who = name(personId)
  const reason = data?.absences.find((a) => a.person_id === personId && a.from_date <= from && a.to_date >= from)?.kind
  const reasonText = reason ? (KIND_TEXT[reason] ?? 'abwesend') : 'abwesend'
  const chosen = (g: Gap) => pick[g.slot.id] ?? g.suggestion ?? ''
  const pending = (gaps ?? []).filter((g) => {
    const c = chosen(g)
    return c && c !== (g.slot.shift?.person_id ?? null)
  })
  const open = (gaps ?? []).filter((g) => g.state !== 'ersetzt')

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const note = `Ersatz für ${who} (${reasonText})`
      await assignSlots(pending.map((g) => ({ slot: g.slot, personId: chosen(g), kind: g.slot.shift?.person_id ? 'tausch' : 'einteilen', notes: note, shiftNote: note })))
      setMsg(`${pending.length} ${pending.length === 1 ? 'Dienst' : 'Dienste'} neu besetzt.`)
      setPick({})
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold text-amber-950">
          Lücken durch «{who}» {reasonText} {dm(from)}
          {to !== from ? `–${dm(to)}` : ''}
        </h3>
        {onClose && (
          <button type="button" className={btn} onClick={onClose} aria-label="Lücken schliessen">
            ✕
          </button>
        )}
      </div>
      {dates.length >= GAP_MAX_DAYS && <p className="text-xs text-amber-900">Gezeigt sind die ersten {GAP_MAX_DAYS} Tage; spätere Wochen teilt «Fehlende Wochen erzeugen» mit Ersatz ein.</p>}
      {!gaps ? (
        <p className="text-gray-600">Lädt…</p>
      ) : gaps.length === 0 ? (
        <p className="text-gray-700">Keine Dienste betroffen: {who} ist im Zeitraum weder im Dienstplan noch im Standardplan eingeteilt.</p>
      ) : (
        <>
          <p className="text-xs text-amber-900">
            {open.length} {open.length === 1 ? 'Dienst' : 'Dienste'} von {who} laut Dienstplan oder Standardplan
            {gaps.length > open.length ? `, ${gaps.length - open.length} schon ersetzt` : ''}. Vorgeschlagen ist, wer befähigt und frei ist, zuerst wer unter dem Pensum liegt.
          </p>
          <ul className="divide-y rounded-lg border bg-white">
            {gaps.map((g) => {
              const c = chosen(g)
              const cand = g.candidates.find((x) => x.personId === c)
              const warn = cand && hasConflict(cand.conflict)
              return (
                <li key={g.slot.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-gray-900">
                      {dm(g.slot.date)} {timeText(g.slot.type)}
                    </span>{' '}
                    <span className="text-gray-700">{typeLabel(g.slot.type)}</span>
                    <span className="block text-xs text-gray-600">
                      {g.state === 'eingeteilt' ? `eingeteilt: ${who}` : g.state === 'standard' ? `Standardplan: ${who} (Woche noch nicht eingeteilt)` : `ersetzt durch ${name(g.current)}`}
                    </span>
                  </span>
                  <select
                    value={c}
                    onChange={(e) => setPick((p) => ({ ...p, [g.slot.id]: e.target.value }))}
                    aria-label={`Ersatz für ${dm(g.slot.date)} ${typeLabel(g.slot.type)}`}
                    className={`min-h-11 max-w-[14rem] rounded-lg border px-2 text-sm ${!c ? 'border-red-400 bg-red-50' : warn ? 'border-amber-500 bg-amber-50' : 'border-gray-300'}`}
                  >
                    <option value="">{g.state === 'ersetzt' ? '—' : 'niemand frei – wählen'}</option>
                    {g.candidates.map((x) => (
                      <option key={x.personId} value={x.personId} disabled={!!x.conflict.absent || x.conflict.overlap.length > 0}>
                        {name(x.personId)}
                        {hasConflict(x.conflict) ? ` (${conflictText(x.conflict)})` : ''}
                      </option>
                    ))}
                  </select>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-40" disabled={busy || pending.length === 0} onClick={() => void save()}>
              {pending.length > 0 ? `${pending.length} ${pending.length === 1 ? 'Dienst' : 'Dienste'} so besetzen` : 'Nichts zu ändern'}
            </button>
            {Object.keys(pick).length > 0 && (
              <button type="button" className={btn} onClick={() => setPick({})}>
                Vorschlag wiederherstellen
              </button>
            )}
            {msg && <span className="text-emerald-800">{msg}</span>}
          </div>
        </>
      )}
    </section>
  )
}
