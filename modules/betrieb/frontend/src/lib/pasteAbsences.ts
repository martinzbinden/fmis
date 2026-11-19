// «Strukturierte Daten einfügen» für Abwesenheiten (Ferienplan): je Zeile Person, von, bis, Art. Bestätigt wird
// direkt eine Abwesenheit, mit «unsicher» ein offener Wunsch (gestrichelt, das Büro bestätigt später).
// «Anna+Beat» = zwei Personen, sofern es keine Person mit genau diesem Namen gibt.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { readDate, readText, unknownFields, type CheckedRow, type PasteField, type PasteImporter } from '@fmis/core/pasteImport'
import { writeBatch } from '../db/write'
import { fmtDate, isoDate } from './format'
import type { DutyAbsence, DutyAbsenceKind, DutyPerson, DutyRequest } from '../types'

const KINDS: DutyAbsenceKind[] = ['ferien', 'frei', 'kurs', 'andere']

export const ABSENCE_FIELDS: PasteField[] = [
  { name: 'person', required: true, type: 'Text', description: 'Name wie im Dienstplan (Teil genügt, wenn eindeutig); «A+B» = beide; unbekannte Namen werden als Person ohne Konto angelegt' },
  { name: 'von', required: true, type: 'Datum JJJJ-MM-TT', description: 'erster Tag' },
  { name: 'bis', type: 'Datum JJJJ-MM-TT', description: 'letzter Tag (leer = nur ein Tag)' },
  { name: 'art', type: 'Text', description: 'ferien (Standard), frei, kurs oder andere' },
  { name: 'notiz', type: 'Text', description: 'Bemerkung, z.B. «Holzerkurs»' },
  { name: 'unsicher', type: 'ja/nein', description: 'ja = als offener Wunsch eintragen (gestrichelt, noch nicht bestätigt)' },
]

export interface AbsencePasteValue {
  /** je Person: id oder null = neu anlegen unter name */
  persons: { id: string | null; name: string }[]
  from: string
  to: string
  kind: DutyAbsenceKind
  notes: string | null
  pending: boolean
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const yes = (v: unknown) => v === true || ['ja', 'yes', 'true', '1', 'x'].includes(norm(String(v ?? '')))

function findPerson(name: string, people: DutyPerson[]): { person?: DutyPerson; problem?: string; warning?: string } {
  const exact = people.find((p) => norm(p.name) === norm(name) || norm(p.name).replace(/^test /, '') === norm(name))
  if (exact) return { person: exact }
  const hits = people.filter((p) => norm(p.name).split(' ').includes(norm(name)) || norm(p.name).includes(norm(name)))
  if (hits.length === 1) return { person: hits[0], warning: `«${name}» zugeordnet zu «${hits[0].name}»` }
  if (hits.length > 1) return { problem: `«${name}» passt auf mehrere: ${hits.map((h) => h.name).join(', ')}` }
  return { warning: `«${name}» gibt es im Dienstplan nicht — wird als Person ohne Konto angelegt` }
}

export function checkAbsences(rows: Record<string, unknown>[], people: DutyPerson[], absences: DutyAbsence[], requests: DutyRequest[]): CheckedRow[] {
  const live = people.filter((p) => !p.deleted_at)
  return rows.map((row, index) => {
    const problems: string[] = []
    const warnings: string[] = []
    const extra = unknownFields(row, ABSENCE_FIELDS)
    if (extra.length) warnings.push(`unbekannte Felder ignoriert: ${extra.join(', ')}`)

    const from = readDate(row.von)
    if (from.error) problems.push(from.error)
    else if (!from.value) problems.push('von fehlt')
    const to = readDate(row.bis)
    if (to.error) problems.push(to.error)
    const end = to.value ?? from.value ?? ''
    if (from.value && end < from.value) problems.push('«bis» liegt vor «von»')

    const kind = (norm(readText(row.art)) || 'ferien') as DutyAbsenceKind
    if (!KINDS.includes(kind)) problems.push(`art «${kind}» unbekannt (${KINDS.join(', ')})`)
    const pending = yes(row.unsicher)

    const pName = readText(row.person)
    const persons: AbsencePasteValue['persons'] = []
    if (!pName) problems.push('person fehlt')
    else {
      const whole = findPerson(pName, live)
      const parts = pName.split('+').map((x) => x.trim()).filter(Boolean)
      if (whole.person || parts.length < 2) {
        if (whole.problem) problems.push(whole.problem)
        if (whole.warning) warnings.push(whole.warning)
        if (!whole.problem) persons.push({ id: whole.person?.id ?? null, name: whole.person?.name ?? pName })
      } else
        for (const part of parts) {
          const r = findPerson(part, live)
          if (r.problem) problems.push(r.problem)
          else {
            if (r.warning) warnings.push(r.warning)
            persons.push({ id: r.person?.id ?? null, name: r.person?.name ?? part })
          }
        }
    }

    // schon eingetragen: gleiche Person, gleicher Zeitraum, gleiche Art (bestätigt oder offener Wunsch)
    const dup = (id: string) =>
      absences.some((a) => !a.deleted_at && a.person_id === id && a.from_date === from.value && a.to_date === end && a.kind === kind) ||
      requests.some((r) => !r.deleted_at && r.kind === 'wunsch' && r.status === 'offen' && r.person_id === id && r.from_date === from.value && r.to_date === end && (r.absence_kind ?? 'frei') === kind)
    const known = persons.filter((p) => p.id && dup(p.id))
    let status: CheckedRow['status'] = problems.length ? 'fehler' : 'neu'
    if (status === 'neu' && known.length === persons.length && persons.length > 0) {
      status = 'doppelt'
      problems.push('schon eingetragen')
    } else if (status === 'neu' && known.length) warnings.push(`${known.map((p) => p.name).join(', ')}: schon eingetragen, wird übersprungen`)

    const notes = readText(row.notiz)
    const value: AbsencePasteValue = { persons: persons.filter((p) => !known.includes(p)), from: from.value ?? '', to: end, kind, notes, pending }
    return {
      index,
      status,
      title: `${persons.map((p) => p.name).join(' + ') || pName || '?'} · ${from.value ? fmtDate(from.value) : '?'}${end && end !== from.value ? `–${fmtDate(end)}` : ''}`,
      detail: [kind, pending ? 'Wunsch (unsicher)' : null, notes].filter(Boolean).join(' · '),
      problems,
      warnings,
      value,
    }
  })
}

async function loadForCheck(db: PGlite) {
  const [people, absences, requests] = await Promise.all([
    db.query<DutyPerson>('select * from duty_people where deleted_at is null order by sort_order, name'),
    db.query<DutyAbsence>('select * from duty_absences where deleted_at is null'),
    db.query<DutyRequest>("select * from duty_requests where deleted_at is null and kind = 'wunsch'"),
  ])
  return {
    people: people.rows,
    absences: absences.rows.map((a) => ({ ...a, from_date: isoDate(a.from_date) ?? '', to_date: isoDate(a.to_date) ?? '' })),
    requests: requests.rows.map((r) => ({ ...r, from_date: isoDate(r.from_date), to_date: isoDate(r.to_date) })),
  }
}

export const absencePasteImporter: PasteImporter = {
  area: 'abwesenheiten',
  label: 'Dienstplan: Ferien und Abwesenheiten (Ferienplan)',
  description:
    'Je Zeile Person, von, bis und Art (ferien, frei, kurs, andere). Mit unsicher = ja als offener Wunsch (gestrichelt). ' +
    '«A+B» trägt beide ein. Schon Eingetragenes wird übersprungen; unbekannte Personen werden ohne Konto angelegt.',
  permission: 'betrieb:dienste:write',
  fields: ABSENCE_FIELDS,
  example: [
    { person: 'Anna', von: '2027-03-01', bis: '2027-03-07' },
    { person: 'Beat', von: '2027-03-01', bis: '2027-03-05', art: 'kurs', notiz: 'Holzerkurs' },
    { person: 'Beat', von: '2027-06-01', bis: '2027-06-30', art: 'kurs', notiz: '1 Woche, Datum noch offen', unsicher: 'ja' },
  ],
  check: async (db, rows) => {
    const { people, absences, requests } = await loadForCheck(db)
    return checkAbsences(rows, people, absences as DutyAbsence[], requests as DutyRequest[])
  },
  apply: async (db, rows) => {
    const { people } = await loadForCheck(db)
    const me = getCurrentUserEmail()
    const created = new Map<string, string>()
    let maxSort = Math.max(0, ...people.map((p) => Number(p.sort_order) || 0))
    let n = 0
    await writeBatch(async (w) => {
      for (const r of rows) {
        const v = r.value as AbsencePasteValue
        for (const p of v.persons) {
          let id = p.id ?? people.find((x) => norm(x.name) === norm(p.name))?.id ?? created.get(norm(p.name)) ?? null
          if (!id) {
            id = crypto.randomUUID()
            created.set(norm(p.name), id)
            await w.upsert('duty_people', { id, name: p.name, email: null, color: null, active: true, sort_order: ++maxSort, notes: 'aus Ferienplan (Einfügen)', school_class: null, school_half: null, companion: false, deleted_at: null })
          }
          if (v.pending)
            await w.upsert('duty_requests', {
              id: crypto.randomUUID(), kind: 'wunsch', person_id: id, shift_id: null, date: null, type_id: null, to_person: null,
              other_shift_id: null, other_date: null, other_type_id: null, from_date: v.from, to_date: v.to, notes: v.notes,
              status: 'offen', decided_by: null, decided_at: null, decision_note: null, created_by: me, deleted_at: null,
              absence_kind: v.kind, counter_status: null, counter_at: null,
            })
          else
            await w.upsert('duty_absences', {
              id: crypto.randomUUID(), person_id: id, from_date: v.from, to_date: v.to, kind: v.kind, notes: v.notes,
              created_by: me, source: null, import_key: null, missing_since: null, deleted_at: null,
            })
          n++
        }
      }
    })
    return n
  },
}
