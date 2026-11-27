// Verlauf (pages/History.tsx): Bereichsnamen und Kurzbeschreibung je Eintrag aus dem gespeicherten Stand.
// Ergänzt die Namen aus core/undo.ts (TABLE_LABELS) um die Tabellen dieses Moduls. Getestet in historyLabels.test.ts.

import type { DataHistory } from '../types'

export const TABLE_LABEL: Record<string, string> = {
  machines: 'Maschine',
  machine_files: 'Maschinen-Datei',
  maintenance_tasks: 'Wartungsplan',
  maintenance_log: 'Wartungsjournal',
  machine_todos: 'Pendenz',
  tracks: 'Spur',
  tank_events: 'Fass',
  duty_people: 'Person',
  duty_types: 'Dienst',
  duty_skills: 'Fähigkeit',
  duty_absences: 'Abwesenheit',
  duty_shifts: 'Einteilung',
  duty_changes: 'Diensttausch',
  duty_requests: 'Dienst-Antrag',
  duty_templates: 'Standardplan',
  duty_template_slots: 'Standardplan-Platz',
  duty_weeks: 'Dienstwoche',
  work_assignments: 'Arbeit zugeteilt',
  machine_settings: 'Geräteeinstellung',
  work_tasks: 'Arbeit (Plan)',
  farm_journal: 'Betriebsjournal',
  photos: 'Foto',
  handover_items: 'Übergabe',
  handover_checks: 'Übergabe erledigt',
}

const STATUS_LABEL: Record<string, string> = { offen: 'offen', erledigt: 'erledigt', abgesagt: 'abgesagt' }
const PHOTO_REF: Record<string, string> = { work_task: 'Arbeit', farm_journal: 'Betriebsjournal' }

/** ISO-Datum (auch mit Zeit) als TT.MM.JJJJ. */
function day(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null
}

const short = (v: string, n = 80) => (v.length > n ? `${v.slice(0, n - 1)}…` : v)

export function describeEntry(entry: Pick<DataHistory, 'table_name' | 'row_id' | 'snapshot'>): string {
  let snap: Record<string, unknown> = {}
  try {
    snap = JSON.parse(entry.snapshot)
  } catch {
    // Snapshot ist immer valides JSON (schreibt nur write.ts).
  }
  const s = (v: unknown) => (v == null || v === '' ? null : String(v))
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(' · ')

  switch (entry.table_name) {
    case 'machines':
    case 'duty_people':
    case 'duty_types':
      return s(snap.name) ?? entry.row_id
    case 'maintenance_tasks':
    case 'machine_todos':
    case 'maintenance_log':
      return `${s(snap.title) ?? s(snap.entry_type) ?? '?'}${snap.done_date ? ` (${s(snap.done_date)})` : ''}`
    case 'tracks':
      return s(snap.label) ?? s(snap.work_type) ?? `${s(snap.point_count) ?? '?'} Punkte`
    case 'duty_shifts':
    case 'duty_changes':
      return s(snap.date) ?? entry.row_id
    case 'duty_requests':
      return `${s(snap.kind) ?? '?'} ${s(snap.date) ?? s(snap.from_date) ?? ''} (${s(snap.status) ?? '?'})`
    case 'duty_absences':
      return `${s(snap.kind) ?? '?'} ${s(snap.from_date) ?? ''}–${s(snap.to_date) ?? ''}`
    case 'machine_settings':
      return s(snap.crop) ?? s(snap.set_at) ?? entry.row_id
    case 'work_tasks': {
      const status = s(snap.status)
      const when = status === 'erledigt' ? day(snap.done_date) : day(snap.planned_date)
      return join(s(snap.title) ?? 'Arbeit', status ? (STATUS_LABEL[status] ?? status) : null, when)
    }
    case 'farm_journal': {
      const qty = s(snap.quantity)
      return join(s(snap.title) ?? 'Eintrag', day(snap.entry_date), qty ? `${qty} ${s(snap.unit) ?? ''}`.trim() : null)
    }
    case 'photos': {
      const kind = s(snap.ref_kind)
      return join(`Foto zu ${kind ? (PHOTO_REF[kind] ?? kind) : 'Eintrag'}`, day(snap.taken_at), s(snap.caption))
    }
    case 'handover_items':
      return join(short(s(snap.text) ?? 'Übergabe'), day(snap.from_date), snap.closed_at ? 'abgeschlossen' : null)
    case 'handover_checks':
      return join(`Erledigt ${day(snap.date) ?? ''}`.trim(), s(snap.done_by), s(snap.note) ? short(String(snap.note)) : null)
    default:
      return entry.row_id
  }
}
