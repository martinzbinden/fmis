// «Strukturierte Daten einfügen» für den Dienstplan: ein Arbeitsplan auf Papier
// (Datum × Person × «Kühe»/«Schafe») wird zu Diensten. «Kühe» heisst alle
// Dienste dieser Tierart an dem Tag (ganzer Stalldienst), mit teil nur morgens
// oder abends. Besetzte Plätze werden nie überschrieben.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { readDate, readText, unknownFields, type CheckedRow, type PasteField, type PasteImporter } from '@fmis/core/pasteImport'
import { writeBatch } from '../db/write'
import { shiftId, slotsOn, timeOn, typeLabel } from './duty'
import { fmtDate, isoDate } from './format'
import type { DutyPerson, DutyShift, DutyType } from '../types'

const PARTS = ['ganz', 'morgens', 'abends'] as const
type Part = (typeof PARTS)[number]

export const DUTY_FIELDS: PasteField[] = [
  { name: 'datum', required: true, type: 'Datum JJJJ-MM-TT', description: 'Tag des Dienstes' },
  { name: 'person', required: true, type: 'Text', description: 'Name wie im Dienstplan (Teil genügt, wenn eindeutig); unbekannte Namen werden als Person ohne Konto angelegt' },
  { name: 'dienst', required: true, type: 'Text', description: 'Tierart (z.B. Kühe, Schafe) = alle Dienste dieser Tierart an dem Tag, oder ein einzelner Dienst «Kühe · Melken morgens»' },
  { name: 'teil', type: 'Text', description: 'ganz (Standard), morgens (Beginn vor 12 Uhr) oder abends' },
  { name: 'hilfe', type: 'Text', description: 'wer hilft — steht als Hinweis am Dienst («Hilfe: …»)' },
  { name: 'notiz', type: 'Text', description: 'Hinweis am Dienst' },
]

export interface DutyPasteValue {
  date: string
  personId: string | null
  /** neu anzulegen, wenn personId null */
  personName: string
  note: string | null
  slots: { id: string; type_id: string; slot: number }[]
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const startMin = (t: DutyType, date: string) => {
  const [h, m] = timeOn(t, date).start_time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function checkDuty(rows: Record<string, unknown>[], people: DutyPerson[], types: DutyType[], shifts: DutyShift[]): CheckedRow[] {
  const taken = new Map(shifts.filter((s) => !s.deleted_at && s.person_id).map((s) => [s.id, s.person_id!]))
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '?'
  const planned = new Map<string, number>() // Platz -> Datensatz in diesem Text
  const live = types.filter((t) => !t.deleted_at)
  return rows.map((row, index) => {
    const problems: string[] = []
    const warnings: string[] = []
    const extra = unknownFields(row, DUTY_FIELDS)
    if (extra.length) warnings.push(`unbekannte Felder ignoriert: ${extra.join(', ')}`)

    const date = readDate(row.datum)
    if (date.error) problems.push(date.error)
    else if (!date.value) problems.push('datum fehlt')

    const pName = readText(row.person)
    let person: DutyPerson | undefined
    if (!pName) problems.push('person fehlt')
    else {
      person = people.find((p) => norm(p.name) === norm(pName))
      if (!person) {
        const hits = people.filter((p) => norm(p.name).split(' ').includes(norm(pName)) || norm(p.name).includes(norm(pName)))
        if (hits.length === 1) {
          person = hits[0]
          warnings.push(`zugeordnet zu «${person.name}»`)
        } else if (hits.length > 1) problems.push(`«${pName}» passt auf mehrere: ${hits.map((h) => h.name).join(', ')}`)
        else warnings.push(`«${pName}» gibt es im Dienstplan nicht — wird als Person ohne Konto angelegt`)
      }
    }

    const dienst = readText(row.dienst)
    const part = (readText(row.teil) ?? 'ganz').toLowerCase() as Part
    if (!PARTS.includes(part)) problems.push(`teil «${part}» unbekannt (ganz, morgens, abends)`)
    let matched: DutyType[] = []
    if (!dienst) problems.push('dienst fehlt')
    else {
      const single = live.filter((t) => norm(typeLabel(t)) === norm(dienst) || norm(t.name) === norm(dienst))
      matched = single.length ? single : live.filter((t) => norm(t.animal) === norm(dienst))
      if (!matched.length) problems.push(`Dienst «${dienst}» gibt es nicht (Tierarten: ${[...new Set(live.map((t) => t.animal).filter(Boolean))].join(', ')})`)
    }

    const slots: DutyPasteValue['slots'] = []
    const labels: string[] = []
    let already = 0
    if (date.value && matched.length && PARTS.includes(part)) {
      const d = date.value
      const day = matched
        .filter((t) => slotsOn(t, d) > 0)
        .filter((t) => part === 'ganz' || (part === 'morgens') === startMin(t, d) < 12 * 60)
        .sort((a, b) => startMin(a, d) - startMin(b, d))
      if (!day.length) problems.push(`am ${fmtDate(d)} gibt es keinen Dienst «${dienst}»${part === 'ganz' ? '' : ` ${part}`}`)
      for (const t of day) {
        const ids = Array.from({ length: slotsOn(t, d) }, (_, i) => ({ id: shiftId(t.id, d, i), slot: i }))
        if (person && ids.some((s) => taken.get(s.id) === person!.id)) {
          already++
          continue
        }
        const free = ids.find((s) => !taken.has(s.id) && !planned.has(s.id))
        if (free) {
          slots.push({ id: free.id, type_id: t.id, slot: free.slot })
          labels.push(`${timeOn(t, d).start_time} ${typeLabel(t)}`)
          continue
        }
        const inText = ids.map((s) => planned.get(s.id)).find((n) => n != null)
        problems.push(
          inText != null
            ? `${typeLabel(t)}: gleicher Platz wie Datensatz ${inText + 1} in diesem Text`
            : `${typeLabel(t)} ist schon besetzt (${ids.map((s) => nameOf(taken.get(s.id)!)).join(', ')}) — wird nicht überschrieben`,
        )
      }
    }

    const help = readText(row.hilfe)
    const note = [help ? `Hilfe: ${help}` : null, readText(row.notiz)].filter(Boolean).join(' · ') || null
    let status: CheckedRow['status'] = problems.length ? 'fehler' : 'neu'
    if (status === 'neu' && !slots.length && already) {
      status = 'doppelt'
      problems.push('schon so eingeteilt')
    }
    if (status === 'neu') for (const s of slots) planned.set(s.id, index)
    if (status === 'neu' && already) warnings.push(`${already} Dienst(e) schon so eingeteilt, der Rest wird ergänzt`)

    const value: DutyPasteValue = { date: date.value ?? '', personId: person?.id ?? null, personName: person?.name ?? pName ?? '', note, slots }
    return {
      index,
      status,
      title: `${date.value ? fmtDate(date.value) : '?'} · ${person?.name ?? pName ?? '?'} · ${dienst ?? '?'}${part !== 'ganz' ? ` ${part}` : ''}`,
      detail: [labels.join(', '), note].filter(Boolean).join(' · '),
      problems,
      warnings,
      value,
    }
  })
}

async function loadForCheck(db: PGlite) {
  const [people, types, shifts] = await Promise.all([
    db.query<DutyPerson>('select * from duty_people where deleted_at is null order by sort_order, name'),
    db.query<DutyType>('select * from duty_types where deleted_at is null order by sort_order, start_time, name'),
    db.query<DutyShift>('select * from duty_shifts where deleted_at is null and person_id is not null'),
  ])
  return {
    people: people.rows,
    types: types.rows.map((t) => ({ ...t, duration_min: Number(t.duration_min) })),
    shifts: shifts.rows.map((s) => ({ ...s, date: isoDate(s.date) ?? '', slot: Number(s.slot) })),
  }
}

export const dutyPasteImporter: PasteImporter = {
  area: 'dienstplan',
  label: 'Dienstplan: Einteilung aus einem Arbeitsplan',
  description:
    'Je Zeile Datum, Person und Tierart («Kühe» = alle Kühe-Dienste des Tages, mit teil nur morgens oder abends). ' +
    'Besetzte Plätze werden nicht überschrieben; unbekannte Personen werden ohne Konto angelegt und für die Dienste als befähigt eingetragen. «Frei» nicht aufführen.',
  permission: 'betrieb:dienste:write',
  fields: DUTY_FIELDS,
  example: [
    { datum: '2026-11-07', person: 'Eymann', dienst: 'Schafe' },
    { datum: '2026-11-07', person: 'F+V', dienst: 'Kühe', teil: 'morgens' },
    { datum: '2026-11-08', person: 'Lambert', dienst: 'Kühe', hilfe: 'M+M' },
  ],
  check: async (db, rows) => {
    const { people, types, shifts } = await loadForCheck(db)
    return checkDuty(rows, people, types, shifts)
  },
  apply: async (db, rows) => {
    // gegen den aktuellen Stand: inzwischen Eingeteiltes nicht überschreiben
    const { people, shifts } = await loadForCheck(db)
    const taken = new Set(shifts.map((s) => s.id))
    const { rows: skillRows } = await db.query<{ person_id: string; type_id: string }>('select person_id, type_id from duty_skills where deleted_at is null')
    const skills = new Set(skillRows.map((s) => `${s.person_id}|${s.type_id}`))
    const me = getCurrentUserEmail()
    const created = new Map<string, string>() // Name -> neue id
    let maxSort = Math.max(0, ...people.map((p) => Number(p.sort_order) || 0))
    let n = 0
    await writeBatch(async (w) => {
      for (const r of rows) {
        const v = r.value as DutyPasteValue
        let personId = v.personId ?? people.find((p) => norm(p.name) === norm(v.personName))?.id ?? created.get(norm(v.personName)) ?? null
        if (!personId) {
          personId = crypto.randomUUID()
          created.set(norm(v.personName), personId)
          await w.upsert('duty_people', { id: personId, name: v.personName, email: null, color: null, active: true, sort_order: ++maxSort, notes: 'aus Arbeitsplan (Einfügen)', school_class: null, school_half: null, deleted_at: null })
        }
        for (const s of v.slots) {
          if (taken.has(s.id)) continue
          taken.add(s.id)
          await w.upsert('duty_shifts', { id: s.id, type_id: s.type_id, date: v.date, slot: s.slot, person_id: personId, notes: v.note, assigned_by: me, deleted_at: null })
          if (!skills.has(`${personId}|${s.type_id}`)) {
            skills.add(`${personId}|${s.type_id}`)
            await w.upsert('duty_skills', { id: crypto.randomUUID(), person_id: personId, type_id: s.type_id, deleted_at: null })
          }
          n++
        }
      }
    })
    return n
  },
}
