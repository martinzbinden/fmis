// Wartungsjournal laden und schreiben (schema/0020); Berechnungen in
// lib/maintenance.ts.

import type { PGlite } from '@electric-sql/pglite'
import { softDeleteRow, upsertRow, upsertRows } from '../db/write'
import { isoDate, num } from './format'
import { loadMachines } from './machines'
import { tasksFromTemplate, type TrackSpan } from './maintenance'
import type { Machine, MaintenanceLog, MaintenanceTask } from '../types'

export interface MaintenanceData {
  machines: Machine[]
  tasks: MaintenanceTask[]
  log: MaintenanceLog[]
  /** GPS-Fahrten je Maschine (als Gerät oder als Zugfahrzeug) */
  tracksByMachine: Map<string, TrackSpan[]>
}

export async function loadMaintenanceData(pg: PGlite): Promise<MaintenanceData> {
  const [machines, tasks, log, tracks] = await Promise.all([
    loadMachines(pg, false),
    pg.query<Record<string, unknown>>('select * from maintenance_tasks where deleted_at is null order by sort_order, title'),
    pg.query<Record<string, unknown>>('select * from maintenance_log where deleted_at is null order by done_date desc'),
    pg.query<{ machine_id: string | null; tractor_id: string | null; started_at: unknown; ended_at: unknown }>(
      'select machine_id, tractor_id, started_at, ended_at from tracks where deleted_at is null and ended_at is not null',
    ),
  ])
  const tracksByMachine = new Map<string, TrackSpan[]>()
  for (const t of tracks.rows) {
    const span = { started_at: new Date(t.started_at as string).toISOString(), ended_at: new Date(t.ended_at as string).toISOString() }
    for (const id of [t.machine_id, t.tractor_id]) if (id) tracksByMachine.set(id, [...(tracksByMachine.get(id) ?? []), span])
  }
  return {
    machines,
    tasks: tasks.rows.map((t) => ({ ...(t as unknown as MaintenanceTask), interval_count: num(t.interval_count), interval_months: num(t.interval_months) })),
    log: log.rows.map((l) => ({ ...(l as unknown as MaintenanceLog), done_date: isoDate(l.done_date), counter: num(l.counter), cost_chf: num(l.cost_chf) })),
    tracksByMachine,
  }
}

export const saveTask = (t: MaintenanceTask) => upsertRow('maintenance_tasks', t as never)
export const deleteTask = (id: string) => softDeleteRow('maintenance_tasks', id)
export const saveEntry = (e: MaintenanceLog) => upsertRow('maintenance_log', e as never)
export const deleteEntry = (id: string) => softDeleteRow('maintenance_log', id)

/** Standard-Wartungspläne übernehmen (nur fehlende Vorlagen-Aufgaben), alle
 * in einer Transaktion. */
export async function applyTemplates(machines: Machine[], existing: MaintenanceTask[]): Promise<number> {
  const add = machines.flatMap((m) => tasksFromTemplate(m, existing, () => crypto.randomUUID()))
  await upsertRows('maintenance_tasks', add as never)
  return add.length
}

export const applyTemplate = (machine: Machine, existing: MaintenanceTask[]) => applyTemplates([machine], existing)
