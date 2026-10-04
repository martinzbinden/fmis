// Maschinenliste (schema/0015_machines.sql, 0016_machine_details.sql):
// Fassgrösse bzw. Ladevolumen und Arbeitsbreite — für den Arbeitsplan (Anzahl
// Fässer) und die GPS-Spur (Breite der befahrenen Fläche); Typenschild,
// Traktoren mit Standard-Zuordnung je Anbaugerät, Bilder und Anleitungen.

import type { PGlite } from '@electric-sql/pglite'
import { num } from './format'
import type { DuengungUnit, Machine, MachineKind } from '../types'

export const MACHINE_KIND_LABEL: Record<MachineKind, string> = {
  traktor: 'Traktor',
  hoflader: 'Hoflader',
  ladergeraet: 'Anbaugerät Hoflader',
  guellefass: 'Güllefass',
  miststreuer: 'Miststreuer',
  duengerstreuer: 'Düngerstreuer',
  pflug: 'Pflug',
  kreiselegge: 'Kreiselegge',
  saatkombination: 'Saatkombination',
  saemaschine: 'Sämaschine',
  maehwerk: 'Mähwerk',
  zettwender: 'Zettwender',
  schwader: 'Schwader',
  ladewagen: 'Ladewagen',
  aufbereiter: 'Aufbereiter',
  motormaeher: 'Motormäher',
  viehanhaenger: 'Viehanhänger',
  verschlauchung: 'Gülle-Verschlauchung',
  auto: 'Auto',
  striegel: 'Striegel',
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
    weight_kg: num(r.weight_kg),
    power_hp: num(r.power_hp),
    year_built: num(r.year_built),
    flow_m3_min: num(r.flow_m3_min),
  }))
}

const UNIT: Record<DuengungUnit, string> = { m3: 'm³', t: 't', kg: 'kg' }

/** "Güllefass Fliegl 6.5 m³ · 7 m" bzw. "John Deere 5100R · 100 PS" */
export function machineSummary(m: Machine): string {
  const parts = [m.name]
  if (m.capacity != null && m.capacity_unit && !m.name.includes(String(m.capacity))) parts.push(`${m.capacity} ${UNIT[m.capacity_unit]}`)
  if (m.width_m != null) parts.push(`${m.width_m} m`)
  if (m.power_hp != null) parts.push(`${m.power_hp} PS`)
  return parts.join(' · ')
}

/** Anzahl Fahrten/Fässer für eine Menge, wenn Einheit und Fassgrösse passen. */
export function loadsFor(amount: number | null, unit: DuengungUnit | null, machine: Machine | null | undefined): number | null {
  if (amount == null || !machine?.capacity || machine.capacity_unit !== unit) return null
  return Math.ceil(amount / machine.capacity - 1e-9)
}

/** Träger, an die Geräte angehängt/angebaut werden: Traktoren und Hoflader. */
export const isTractor = (m: Pick<Machine, 'kind'>) => m.kind === 'traktor' || m.kind === 'hoflader'
/** Fährt selbst, braucht keinen Träger. */
export const isSelfPropelled = (m: Pick<Machine, 'kind'>) => m.kind === 'motormaeher' || m.kind === 'auto'

/** Träger-Vorschlag für ein Gerät: der hinterlegte Standard-Träger, sonst
 * der erste passende der Liste (Hoflader-Anbaugeräte → Hoflader, alles
 * andere → Traktor). Ohne Gerät oder selbstfahrend: kein Vorschlag. */
export function suggestTractor(implement: Machine | null | undefined, machines: Machine[]): Machine | null {
  if (!implement || isTractor(implement) || isSelfPropelled(implement)) return null
  const carriers = machines.filter((m) => isTractor(m) && m.active)
  const wanted = implement.kind === 'ladergeraet' ? 'hoflader' : 'traktor'
  return carriers.find((t) => t.id === implement.tractor_id) ?? carriers.find((t) => t.kind === wanted) ?? null
}

/** Anzeigename einer Kombination für tracks.machine: "Güllefass … + John Deere 5100R". */
export function comboName(implement: Machine | null, tractor: Machine | null): string | null {
  const names = [implement?.name, tractor?.name].filter(Boolean)
  return names.length ? names.join(' + ') : null
}
