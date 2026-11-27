// Wartungsjournal über alle Maschinen (pages/Maintenance.tsx): auch Einträge gelöschter Maschinen bleiben sichtbar
// (mit «(gelöscht)») und zählen bei den Kosten. Reine Teile getestet in machineJournal.test.ts.

import type { PGlite } from '@electric-sql/pglite'
import type { Machine, MaintenanceLog } from '../types'

/** Gelöschte Maschinen (weich gelöscht), damit ihre Journal-Einträge einen Namen haben. */
export async function loadDeletedMachines(pg: PGlite): Promise<Machine[]> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from machines where deleted_at is not null')
  return rows as unknown as Machine[]
}

export interface YearCosts {
  year: string
  /** Eigentümer («eigene» = eigener Betrieb) → Betrag */
  owners: Map<string, number>
  /** davon Maschinen, die inzwischen gelöscht sind */
  deleted: number
}

/** Kosten je Jahr und Eigentümer, neueste Jahre zuerst. Einträge ohne bekannte Maschine zählen als «eigene». */
export function costsByYear(log: Pick<MaintenanceLog, 'machine_id' | 'done_date' | 'cost_chf'>[], machines: Map<string, Pick<Machine, 'owner' | 'deleted_at'>>): YearCosts[] {
  const out = new Map<string, YearCosts>()
  for (const l of log) {
    if (l.cost_chf == null) continue
    const year = l.done_date.slice(0, 4)
    const m = machines.get(l.machine_id)
    const owner = m?.owner ?? 'eigene'
    const y = out.get(year) ?? { year, owners: new Map<string, number>(), deleted: 0 }
    y.owners.set(owner, (y.owners.get(owner) ?? 0) + l.cost_chf)
    if (m?.deleted_at) y.deleted += l.cost_chf
    out.set(year, y)
  }
  return [...out.values()].sort((a, b) => b.year.localeCompare(a.year))
}

/** Anzahl Journal-Einträge einer Maschine (für die Rückfrage beim Löschen). */
export const journalCount = (log: Pick<MaintenanceLog, 'machine_id'>[], machineId: string) => log.filter((l) => l.machine_id === machineId).length
