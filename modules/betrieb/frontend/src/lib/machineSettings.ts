// Geräteeinstellungen (schema/0003): je Maschine frei definierbare
// Einstellgrössen (machines.settings_def) und ein Protokoll der Werte je
// Einsatz (machine_settings) — z.B. Saatmengenschieber und Abstreifer der
// Sämaschine, Planierblech und Schardruck der Kreiselegge.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow } from '../db/write'
import type { Machine, MachineKind } from '../types'

export interface SettingDef {
  key: string
  label: string
  unit: string
  /** Bauteil einer Kombination, z.B. «Sämaschine» */
  part?: string
}

export interface MachineSetting {
  id: string
  machine_id: string
  track_id: string | null
  set_at: string
  settings: Record<string, number>
  crop: string | null
  measured_kg_ha: number | null
  notes: string | null
  created_by: string | null
}

const SEEDER: SettingDef[] = [
  { part: 'Sämaschine', key: 'saatmengenschieber', label: 'Saatmengenschieber', unit: 'cm' },
  { part: 'Sämaschine', key: 'abstreifer', label: 'Abstreifer', unit: 'cm' },
]
const HARROW: SettingDef[] = [
  { part: 'Kreiselegge', key: 'planierblech', label: 'Höhe Planierblech', unit: 'cm' },
  { part: 'Kreiselegge', key: 'schardruck', label: 'Schardruck', unit: 'cm' },
]

/** Vorschlag je Maschinenart — wird im Formular übernommen und kann
 * angepasst werden. */
export const SUGGESTED_DEFS: Partial<Record<MachineKind, SettingDef[]>> = {
  saatkombination: [...SEEDER, ...HARROW],
  saemaschine: SEEDER.map(({ part: _part, ...d }) => d),
  kreiselegge: HARROW.map(({ part: _part, ...d }) => d),
}

export function parseDefs(text: string | null | undefined): SettingDef[] {
  if (!text) return []
  try {
    const v = JSON.parse(text) as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter((d): d is SettingDef => !!d && typeof d === 'object' && typeof (d as SettingDef).key === 'string' && typeof (d as SettingDef).label === 'string')
      .map((d) => ({ key: d.key, label: d.label, unit: typeof d.unit === 'string' ? d.unit : '', ...(d.part ? { part: String(d.part) } : {}) }))
  } catch {
    return []
  }
}

/** Schlüssel aus der Bezeichnung (Umlaute ausgeschrieben), eindeutig
 * innerhalb der Liste. */
export function keyFor(label: string, part: string | undefined, taken: Set<string>): string {
  const base =
    `${part ? `${part}_` : ''}${label}`
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'wert'
  let key = base
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`
  return key
}

function parseValues(text: unknown): Record<string, number> {
  try {
    const v = typeof text === 'string' ? (JSON.parse(text) as Record<string, unknown>) : {}
    const out: Record<string, number> = {}
    for (const [k, x] of Object.entries(v ?? {})) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x
    return out
  } catch {
    return {}
  }
}

function fromRow(r: Record<string, unknown>): MachineSetting {
  const at = r.set_at instanceof Date ? r.set_at.toISOString() : String(r.set_at)
  return {
    id: String(r.id),
    machine_id: String(r.machine_id),
    track_id: (r.track_id as string) ?? null,
    set_at: at,
    settings: parseValues(r.settings),
    crop: (r.crop as string) ?? null,
    measured_kg_ha: r.measured_kg_ha == null ? null : Number(r.measured_kg_ha),
    notes: (r.notes as string) ?? null,
    created_by: (r.created_by as string) ?? null,
  }
}

/** Protokoll einer Maschine, neueste zuerst. */
export async function loadSettings(pg: PGlite, machineId: string, limit = 50): Promise<MachineSetting[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    'select * from machine_settings where deleted_at is null and machine_id = $1 order by set_at desc limit $2',
    [machineId, limit],
  )
  return rows.map(fromRow)
}

export async function saveSetting(input: {
  id?: string
  machine_id: string
  track_id: string | null
  set_at?: string
  settings: Record<string, number>
  crop: string | null
  measured_kg_ha: number | null
  notes: string | null
}): Promise<string> {
  const id = input.id ?? crypto.randomUUID()
  await upsertRow('machine_settings', {
    id,
    machine_id: input.machine_id,
    track_id: input.track_id,
    set_at: input.set_at ?? new Date().toISOString(),
    settings: JSON.stringify(input.settings),
    crop: input.crop,
    measured_kg_ha: input.measured_kg_ha,
    notes: input.notes,
    created_by: getCurrentUserEmail(),
  } as never)
  return id
}

/** «Saatmengenschieber 3.5 cm · Abstreifer 2 cm» — nur gesetzte Werte, in
 * der Reihenfolge der Definition (unbekannte Schlüssel am Schluss). */
export function formatSetting(defs: SettingDef[], values: Record<string, number>): string {
  const known = defs.filter((d) => values[d.key] != null).map((d) => `${d.label} ${values[d.key].toLocaleString('de-CH')}${d.unit ? ` ${d.unit}` : ''}`)
  const extra = Object.keys(values)
    .filter((k) => !defs.some((d) => d.key === k))
    .map((k) => `${k} ${values[k].toLocaleString('de-CH')}`)
  return [...known, ...extra].join(' · ')
}

function dayBounds(date: string): [string, string] {
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [start.toISOString(), end.toISOString()]
}

/** Für andere Module (z.B. Saat-Eintrag im Wiesenjournal): Einstellungen,
 * die an einem Tag protokolliert wurden, als lesbare Zeilen. */
export async function settingsOnDate(date: string): Promise<{ machine: string; text: string; crop: string | null; measured_kg_ha: number | null }[]> {
  const { getSyncedDb } = await import('../db/access')
  const pg = await getSyncedDb()
  const { rows } = await pg.query<Record<string, unknown> & { machine_name: string; settings_def: string | null }>(
    `select s.*, m.name as machine_name, m.settings_def
     from machine_settings s join machines m on m.id = s.machine_id
     where s.deleted_at is null and s.set_at >= $1 and s.set_at < $2
     order by s.set_at`,
    // Tag in lokaler Zeit
    dayBounds(date),
  )
  return rows.map((r) => {
    const s = fromRow(r)
    return { machine: r.machine_name, text: formatSetting(parseDefs(r.settings_def), s.settings), crop: s.crop, measured_kg_ha: s.measured_kg_ha }
  })
}

export const machineDefs = (m: Pick<Machine, 'settings_def'> | null | undefined) => parseDefs(m?.settings_def)
