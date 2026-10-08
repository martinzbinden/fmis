// «Strukturierte Daten einfügen» für das Maschinen-Wartungsjournal und
// Pendenzen: Maschine über den Namen, Plausibilität (Datum, Kosten,
// Zählerstand) und Doppelerfassungen (gleiche Maschine, Tag, Art, Titel).

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { readDate, readNumber, readText, unknownFields, type CheckedRow, type PasteField, type PasteImporter } from '@fmis/core/pasteImport'
import { upsertRows } from '../db/write'
import { fmtDate, isoDate, num, todayIso } from './format'
import type { MaintenanceEntryType } from '../types'

const TYPES: MaintenanceEntryType[] = ['wartung', 'reparatur', 'kontrolle', 'beobachtung', 'schaden', 'zaehlerstand']
const PRIORITIES = ['hoch', 'normal', 'tief'] as const

export const MAINTENANCE_FIELDS: PasteField[] = [
  { name: 'maschine', required: true, type: 'Text', description: 'Name der Maschine wie in FMIS (Teil des Namens genügt, wenn eindeutig)' },
  { name: 'datum', required: true, type: 'Datum JJJJ-MM-TT', description: 'Datum der Arbeit bzw. Feststellung' },
  { name: 'art', type: 'Text', description: `${TYPES.join(', ')} oder pendenz (nur offene Aufgabe); Standard reparatur` },
  { name: 'titel', type: 'Text', description: 'was gemacht/festgestellt wurde (Pflicht ausser bei zaehlerstand)' },
  { name: 'zaehlerstand', type: 'Zahl', description: 'Stunden bzw. km' },
  { name: 'kosten_chf', type: 'Zahl', description: 'Kosten in CHF' },
  { name: 'material', type: 'Text', description: 'Ersatzteile, Öl …' },
  { name: 'erledigt_von', type: 'Text', description: 'selbst, Werkstatt …' },
  { name: 'notiz', type: 'Text', description: '' },
  { name: 'pendenz', type: 'Text', description: 'zusätzlich offene Pendenz anlegen (was noch zu tun ist)' },
  { name: 'pendenz_bis', type: 'Datum JJJJ-MM-TT', description: 'Termin der Pendenz' },
  { name: 'pendenz_prioritaet', type: 'Text', description: 'hoch, normal (Standard), tief' },
]

interface MachineRow {
  id: string
  name: string
}
interface LogRow {
  machine_id: string
  done_date: unknown
  entry_type: string
  title: string | null
  counter: unknown
}
interface TodoRow {
  machine_id: string
  title: string
  status: string
}

export interface MaintenanceValue {
  machine_id: string
  log: null | {
    done_date: string
    entry_type: MaintenanceEntryType
    title: string | null
    counter: number | null
    cost_chf: number | null
    material: string | null
    done_by: string | null
    notes: string | null
  }
  todo: null | { title: string; due_date: string | null; priority: (typeof PRIORITIES)[number] }
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export function checkMaintenance(rows: Record<string, unknown>[], machines: MachineRow[], log: LogRow[], todos: TodoRow[], today = todayIso()): CheckedRow[] {
  const seen = new Map<string, number>()
  return rows.map((row, index) => {
    const problems: string[] = []
    const warnings: string[] = []
    const extra = unknownFields(row, MAINTENANCE_FIELDS)
    if (extra.length) warnings.push(`unbekannte Felder ignoriert: ${extra.join(', ')}`)

    const mName = readText(row.maschine)
    let machine: MachineRow | undefined
    if (!mName) problems.push('maschine fehlt')
    else {
      machine = machines.find((m) => norm(m.name) === norm(mName))
      if (!machine) {
        const hits = machines.filter((m) => norm(m.name).includes(norm(mName)) || norm(mName).includes(norm(m.name)))
        if (hits.length === 1) {
          machine = hits[0]
          warnings.push(`zugeordnet zu «${machine.name}»`)
        } else if (hits.length > 1) problems.push(`«${mName}» passt auf mehrere: ${hits.map((h) => h.name).join(', ')}`)
        else problems.push(`Maschine «${mName}» nicht gefunden`)
      }
    }

    const date = readDate(row.datum)
    if (date.error) problems.push(date.error)
    else if (!date.value) problems.push('datum fehlt')
    else if (date.value > today) problems.push('Datum liegt in der Zukunft')
    else if (date.value < '1990-01-01') problems.push('Datum vor 1990')

    const art = (readText(row.art) ?? 'reparatur').toLowerCase()
    const onlyTodo = art === 'pendenz'
    if (!onlyTodo && !TYPES.includes(art as MaintenanceEntryType)) problems.push(`art «${art}» unbekannt`)
    const title = readText(row.titel)
    const counter = readNumber(row.zaehlerstand)
    const cost = readNumber(row.kosten_chf)
    for (const r of [counter, cost]) if (r.error) problems.push(r.error)
    if (art === 'zaehlerstand' && counter.value == null) problems.push('zaehlerstand fehlt')
    if (art !== 'zaehlerstand' && !title) problems.push('titel fehlt')
    if (cost.value != null && cost.value < 0) problems.push('Kosten negativ')
    if (cost.value != null && cost.value > 20000) warnings.push(`Kosten CHF ${cost.value.toLocaleString('de-CH')} — stimmt das?`)
    if (machine && counter.value != null && date.value) {
      const before = log
        .filter((l) => l.machine_id === machine!.id && num(l.counter) != null && (isoDate(l.done_date) ?? '') <= date.value!)
        .sort((a, b) => (isoDate(b.done_date) ?? '').localeCompare(isoDate(a.done_date) ?? ''))[0]
      if (before && num(before.counter)! > counter.value)
        warnings.push(`Zählerstand ${counter.value} kleiner als ${num(before.counter)} am ${fmtDate(isoDate(before.done_date)!)}`)
    }

    const todoTitle = onlyTodo ? title : readText(row.pendenz)
    const due = readDate(row.pendenz_bis)
    if (due.error) problems.push(`pendenz_bis: ${due.error}`)
    const prio = (readText(row.pendenz_prioritaet) ?? 'normal').toLowerCase()
    if (!PRIORITIES.includes(prio as never)) problems.push(`pendenz_prioritaet «${prio}» unbekannt`)

    const key = [machine?.id, date.value, art, norm(title)].join('|')
    let status: CheckedRow['status'] = problems.length ? 'fehler' : 'neu'
    if (status === 'neu' && machine) {
      if (seen.has(key)) {
        status = 'doppelt'
        problems.push(`gleich wie Datensatz ${seen.get(key)! + 1} in diesem Text`)
      } else if (onlyTodo) {
        if (todos.some((t) => t.machine_id === machine!.id && t.status === 'offen' && norm(t.title) === norm(title))) {
          status = 'doppelt'
          problems.push('gleiche offene Pendenz besteht schon')
        }
      } else {
        const sameDay = log.filter((l) => l.machine_id === machine!.id && isoDate(l.done_date) === date.value && l.entry_type === art)
        if (sameDay.some((l) => norm(l.title) === norm(title))) {
          status = 'doppelt'
          problems.push('bereits im Journal')
        } else if (sameDay.length) {
          status = 'aehnlich'
          problems.push(`am selben Tag schon: ${sameDay.map((l) => l.title ?? art).join('; ')}`)
        }
      }
      seen.set(key, index)
    }

    const value: MaintenanceValue = {
      machine_id: machine?.id ?? '',
      log: onlyTodo
        ? null
        : {
            done_date: date.value ?? '',
            entry_type: art as MaintenanceEntryType,
            title,
            counter: counter.value,
            cost_chf: cost.value,
            material: readText(row.material),
            done_by: readText(row.erledigt_von),
            notes: readText(row.notiz),
          },
      todo: todoTitle ? { title: todoTitle, due_date: due.value, priority: prio as (typeof PRIORITIES)[number] } : null,
    }
    return {
      index,
      status,
      title: `${date.value ? fmtDate(date.value) : '?'} · ${machine?.name ?? mName ?? '?'} · ${onlyTodo ? 'Pendenz' : art}${title ? `: ${title}` : ''}`,
      detail: [
        counter.value != null ? `Zähler ${counter.value}` : null,
        cost.value != null ? `CHF ${cost.value.toLocaleString('de-CH', { minimumFractionDigits: 2 })}` : null,
        value.log?.material,
        value.log?.done_by,
        value.todo && !onlyTodo ? `+ Pendenz «${value.todo.title}»` : null,
        value.todo?.due_date ? `bis ${fmtDate(value.todo.due_date)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      problems,
      warnings,
      value,
    }
  })
}

async function loadForCheck(db: PGlite) {
  const [machines, log, todos] = await Promise.all([
    db.query<MachineRow>('select id, name from machines where deleted_at is null'),
    db.query<LogRow>('select machine_id, done_date, entry_type, title, counter from maintenance_log where deleted_at is null'),
    db.query<TodoRow>('select machine_id, title, status from machine_todos where deleted_at is null'),
  ])
  return { machines: machines.rows, log: log.rows, todos: todos.rows }
}

export const maintenancePasteImporter: PasteImporter = {
  area: 'maschinenjournal',
  label: 'Maschinen: Wartungsjournal und Pendenzen',
  description:
    'Wartung, Reparatur, Kontrolle, Beobachtung, Schaden oder Zählerstand je Maschine, optional mit Pendenz; art "pendenz" legt nur eine offene Aufgabe an. ' +
    'Doppelte (gleiche Maschine, Tag, Art, Titel) werden erkannt und übersprungen.',
  permission: 'wiesenjournal:tracking:write',
  fields: MAINTENANCE_FIELDS,
  example: [
    { maschine: 'John Deere 5100R', datum: '2026-03-12', art: 'wartung', titel: 'Motoröl und Filter gewechselt', zaehlerstand: 2410, kosten_chf: 180.5, material: '12 l 15W-40', erledigt_von: 'selbst' },
    { maschine: 'Hoflader', datum: '2026-10-01', art: 'schaden', titel: 'Hydraulikschlauch Kippzylinder undicht', pendenz: 'Schlauch ersetzen', pendenz_prioritaet: 'hoch' },
  ],
  check: async (db, rows) => {
    const { machines, log, todos } = await loadForCheck(db)
    return checkMaintenance(rows, machines, log, todos)
  },
  apply: async (db, rows) => {
    // gegen den aktuellen Stand: inzwischen Erfasstes nicht doppelt
    const { log, todos } = await loadForCheck(db)
    const logRows: Record<string, unknown>[] = []
    const todoRows: Record<string, unknown>[] = []
    for (const r of rows) {
      const v = r.value as MaintenanceValue
      const logId = v.log ? crypto.randomUUID() : null
      if (v.log && log.some((l) => l.machine_id === v.machine_id && isoDate(l.done_date) === v.log!.done_date && l.entry_type === v.log!.entry_type && norm(l.title) === norm(v.log!.title))) continue
      if (v.log) logRows.push({ id: logId, machine_id: v.machine_id, ...v.log, task_ids: null, deleted_at: null })
      if (v.todo && !todos.some((t) => t.machine_id === v.machine_id && t.status === 'offen' && norm(t.title) === norm(v.todo!.title)))
        todoRows.push({
          id: crypto.randomUUID(),
          machine_id: v.machine_id,
          title: v.todo.title,
          notes: null,
          priority: v.todo.priority,
          due_date: v.todo.due_date,
          status: 'offen',
          done_date: null,
          log_id: logId,
          done_log_id: null,
          created_by: getCurrentUserEmail(),
          deleted_at: null,
        })
    }
    if (logRows.length) await upsertRows('maintenance_log', logRows as never)
    if (todoRows.length) await upsertRows('machine_todos', todoRows as never)
    return logRows.length + todoRows.length
  },
}
