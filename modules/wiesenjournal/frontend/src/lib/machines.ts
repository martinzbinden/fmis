// Maschinenliste (schema/0015_machines.sql): Fassgrösse bzw. Ladevolumen und
// Arbeitsbreite — für den Arbeitsplan (Anzahl Fässer) und die GPS-Spur
// (Breite der befahrenen Fläche).

import type { PGlite } from '@electric-sql/pglite'
import { num } from './format'
import type { DuengungUnit, Machine, MachineKind } from '../types'

export const MACHINE_KIND_LABEL: Record<MachineKind, string> = {
  guellefass: 'Güllefass',
  miststreuer: 'Miststreuer',
  duengerstreuer: 'Düngerstreuer',
  maehwerk: 'Mähwerk',
  zettwender: 'Zettwender',
  schwader: 'Schwader',
  ladewagen: 'Ladewagen',
  saemaschine: 'Sämaschine',
  traktor: 'Traktor',
  andere: 'andere',
}

export async function loadMachines(pg: PGlite, activeOnly = true): Promise<Machine[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select * from machines where deleted_at is null ${activeOnly ? 'and active' : ''} order by sort_order, name`,
  )
  return rows.map((r) => ({
    ...(r as unknown as Machine),
    capacity: num(r.capacity),
    width_m: num(r.width_m),
    capacity_unit: (r.capacity_unit as DuengungUnit | null) ?? null,
  }))
}

const UNIT: Record<DuengungUnit, string> = { m3: 'm³', t: 't', kg: 'kg' }

/** "Güllefass Fliegl 6.5 m³ · 7 m" */
export function machineSummary(m: Machine): string {
  const parts = [m.name]
  if (m.capacity != null && m.capacity_unit && !m.name.includes(String(m.capacity))) parts.push(`${m.capacity} ${UNIT[m.capacity_unit]}`)
  if (m.width_m != null) parts.push(`${m.width_m} m`)
  return parts.join(' · ')
}

/** Anzahl Fahrten/Fässer für eine Menge, wenn Einheit und Fassgrösse passen. */
export function loadsFor(amount: number | null, unit: DuengungUnit | null, machine: Machine | null | undefined): number | null {
  if (amount == null || !machine?.capacity || machine.capacity_unit !== unit) return null
  return Math.ceil(amount / machine.capacity - 1e-9)
}
