// Arbeitsplan aus der Planung im Journal ("Arbeit planen" → is_planned):
// je Tag und Arbeit (z.B. "Rindergülle verdünnt 1:1") die Parzellen mit
// Menge und Fläche. "Ausführung starten" (pages/WorkPlan.tsx) startet die
// GPS-Aufzeichnung auf der Karte mit Maschine und Arbeitsbreite; beim
// Beenden werden die erledigten Parzellen als ausgeführt übernommen
// (completePlan, is_planned → false, Datum = Ausführungstag).

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import { USAGE_TYPE_LABEL, isoDate, num } from './format'
import { loadFertilizerTypes } from './fertilization'
import { computeNutrients } from './nutrients'
import type { DuengungUnit, MachineKind } from '../types'

export interface PlanItem {
  parcel_id: string
  parcel_name: string
  area_a: number | null
  amount: number | null
  unit: DuengungUnit | null
  notes: string | null
  /** GeoJSON der Parzelle (für Karte und "befahren"). */
  geometry: string | null
  fertilization_ids: string[]
  usage_ids: string[]
}

export interface PlanTask {
  key: string
  date: string
  title: string
  /** Arbeitsart für die GPS-Spur, z.B. "Gülle ausbringen". */
  work_type: string
  machine_kinds: MachineKind[]
  unit: DuengungUnit | null
  items: PlanItem[]
}

export interface PlannedFertilization {
  id: string
  entry_date: string
  parcel_id: string | null
  amount: number | null
  unit: DuengungUnit
  notes: string | null
  duengung_code: string
  type_id: string | null
  type_name: string | null
  type_code: string | null
  parcel_name: string | null
  parcel_area: number | null
  parcel_geometry: string | null
  /** Bei Massnahmen über mehrere Parzellen (fertilization_shares). */
  shares: { parcel_id: string; parcel_name: string; area_a: number; geometry: string | null }[]
}

export interface PlannedUsage {
  id: string
  entry_date: string
  parcel_id: string
  usage_type: string
  label: string | null
  notes: string | null
  parcel_name: string
  parcel_area: number | null
  parcel_geometry: string | null
}

const MOW = new Set(['silage', 'eingrasen', 'duerrfutter_bel', 'duerrfutter_unbel', 'saeuberungsschnitt'])

function fertWork(unit: DuengungUnit, code: string | null): { work: string; kinds: MachineKind[] } {
  if (unit === 'm3') return { work: 'Gülle ausbringen', kinds: ['guellefass', 'verschlauchung'] }
  if (unit === 't') return { work: 'Mist ausbringen', kinds: ['miststreuer'] }
  return { work: code === 'K' ? 'Kalk streuen' : 'Kunstdünger streuen', kinds: ['duengerstreuer'] }
}

function usageWork(type: string): { work: string; kinds: MachineKind[] } {
  if (MOW.has(type)) return { work: 'Mähen', kinds: ['maehwerk', 'motormaeher'] }
  if (type === 'striegeln') return { work: 'Striegeln', kinds: ['striegel', 'andere'] }
  if (type === 'pflug') return { work: 'Pflügen', kinds: ['pflug'] }
  if (type === 'saat' || type === 'uebersaat') return { work: 'Säen', kinds: ['saatkombination', 'saemaschine'] }
  return { work: USAGE_TYPE_LABEL[type] ?? type, kinds: [] }
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** Geplante Einträge → Aufgaben je Tag; reine Funktion (getestet). */
export function buildPlan(fertilization: PlannedFertilization[], usage: PlannedUsage[]): PlanTask[] {
  const tasks = new Map<string, PlanTask>()
  const item = (task: PlanTask, parcel_id: string, init: Omit<PlanItem, 'fertilization_ids' | 'usage_ids'>) => {
    let it = task.items.find((i) => i.parcel_id === parcel_id)
    if (!it) {
      it = { ...init, fertilization_ids: [], usage_ids: [] }
      task.items.push(it)
    } else if (init.amount != null) {
      it.amount = round1((it.amount ?? 0) + init.amount)
    }
    return it
  }

  for (const f of fertilization) {
    const typeKey = f.type_id ?? f.duengung_code
    const key = `${f.entry_date}|fert|${typeKey}`
    const { work, kinds } = fertWork(f.unit, f.type_code)
    let task = tasks.get(key)
    if (!task) {
      task = { key, date: f.entry_date, title: f.type_name ?? f.duengung_code, work_type: work, machine_kinds: kinds, unit: f.unit, items: [] }
      tasks.set(key, task)
    }
    const parts =
      f.shares.length > 1
        ? f.shares
        : f.parcel_id
          ? [{ parcel_id: f.parcel_id, parcel_name: f.parcel_name ?? '?', area_a: f.parcel_area ?? 0, geometry: f.parcel_geometry }]
          : f.shares
    const totalArea = parts.reduce((s, p) => s + (p.area_a || 0), 0)
    for (const p of parts) {
      // Menge einer Mehrparzellen-Massnahme nach Fläche aufteilen.
      const share = f.amount == null ? null : parts.length === 1 || !totalArea ? f.amount : round1((f.amount * p.area_a) / totalArea)
      const it = item(task, p.parcel_id, {
        parcel_id: p.parcel_id,
        parcel_name: p.parcel_name,
        area_a: p.area_a || null,
        amount: share,
        unit: f.unit,
        notes: f.notes,
        geometry: p.geometry,
      })
      it.fertilization_ids.push(f.id)
    }
  }

  for (const u of usage) {
    const key = `${u.entry_date}|usage|${u.usage_type}|${u.label ?? ''}`
    const { work, kinds } = usageWork(u.usage_type)
    let task = tasks.get(key)
    if (!task) {
      const label = USAGE_TYPE_LABEL[u.usage_type] ?? u.usage_type
      task = { key, date: u.entry_date, title: u.label ? `${label}: ${u.label}` : label, work_type: work, machine_kinds: kinds, unit: null, items: [] }
      tasks.set(key, task)
    }
    const it = item(task, u.parcel_id, {
      parcel_id: u.parcel_id,
      parcel_name: u.parcel_name,
      area_a: u.parcel_area,
      amount: null,
      unit: null,
      notes: u.notes,
      geometry: u.parcel_geometry,
    })
    it.usage_ids.push(u.id)
  }

  for (const t of tasks.values()) t.items.sort((a, b) => a.parcel_name.localeCompare(b.parcel_name, 'de-CH'))
  return [...tasks.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'de-CH'))
}

export async function loadPlan(pg: PGlite, fromDate: string): Promise<PlanTask[]> {
  const [fert, shares, usage] = await Promise.all([
    pg.query<Record<string, unknown>>(
      `select e.id, e.entry_date, e.parcel_id, e.amount, e.unit, e.notes, e.duengung_code,
              t.id as type_id, t.name as type_name, t.code as type_code,
              p.name as parcel_name, p.area_a as parcel_area, p.base_geometry as parcel_geometry
       from fertilization_entries e
       left join fertilizer_types t on t.id = e.fertilizer_type_id
       left join parcels p on p.id = e.parcel_id
       where e.deleted_at is null and e.is_planned and e.entry_date >= $1`,
      [fromDate],
    ),
    pg.query<Record<string, unknown>>(
      `select s.entry_id, s.parcel_id, s.area_a, p.name as parcel_name, p.base_geometry
       from fertilization_shares s
       join fertilization_entries e on e.id = s.entry_id and e.is_planned and e.deleted_at is null and e.entry_date >= $1
       join parcels p on p.id = s.parcel_id
       where s.deleted_at is null`,
      [fromDate],
    ),
    pg.query<Record<string, unknown>>(
      `select u.id, u.entry_date, u.parcel_id, u.usage_type, u.label, u.notes,
              p.name as parcel_name, p.area_a as parcel_area, p.base_geometry as parcel_geometry
       from usage_entries u join parcels p on p.id = u.parcel_id
       where u.deleted_at is null and u.is_planned and u.entry_date >= $1`,
      [fromDate],
    ),
  ])
  const sharesByEntry = new Map<string, PlannedFertilization['shares']>()
  for (const s of shares.rows) {
    const list = sharesByEntry.get(String(s.entry_id)) ?? []
    list.push({ parcel_id: String(s.parcel_id), parcel_name: String(s.parcel_name), area_a: num(s.area_a) ?? 0, geometry: (s.base_geometry as string) ?? null })
    sharesByEntry.set(String(s.entry_id), list)
  }
  return buildPlan(
    fert.rows.map((r) => ({
      id: String(r.id),
      entry_date: isoDate(r.entry_date),
      parcel_id: (r.parcel_id as string) ?? null,
      amount: num(r.amount),
      unit: r.unit as DuengungUnit,
      notes: (r.notes as string) ?? null,
      duengung_code: String(r.duengung_code),
      type_id: (r.type_id as string) ?? null,
      type_name: (r.type_name as string) ?? null,
      type_code: (r.type_code as string) ?? null,
      parcel_name: (r.parcel_name as string) ?? null,
      parcel_area: num(r.parcel_area),
      parcel_geometry: (r.parcel_geometry as string) ?? null,
      shares: sharesByEntry.get(String(r.id)) ?? [],
    })),
    usage.rows.map((r) => ({
      id: String(r.id),
      entry_date: isoDate(r.entry_date),
      parcel_id: String(r.parcel_id),
      usage_type: String(r.usage_type),
      label: (r.label as string) ?? null,
      notes: (r.notes as string) ?? null,
      parcel_name: String(r.parcel_name),
      parcel_area: num(r.parcel_area),
      parcel_geometry: (r.parcel_geometry as string) ?? null,
    })),
  )
}

// --- Laufende Ausführung (auf diesem Gerät) ---

export interface ActivePlan {
  task: PlanTask
  machine_id: string | null
  machine_name: string | null
  /** Traktor dazu (Vorschlag aus dem Standard-Traktor des Geräts). */
  tractor_id?: string | null
  tractor_name?: string | null
  width_m: number | null
  started_at: string
  /** Laufende GPS-Spur; fehlt, solange die Karte sie noch nicht gestartet hat. */
  track_id?: string
}

const ACTIVE_KEY = 'wiesenjournal_active_plan'

export function getActivePlan(): ActivePlan | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    return raw ? (JSON.parse(raw) as ActivePlan) : null
  } catch {
    return null
  }
}

export function setActivePlan(plan: ActivePlan | null): void {
  try {
    if (plan) localStorage.setItem(ACTIVE_KEY, JSON.stringify(plan))
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // ohne localStorage: Plan nur bis zum Neuladen
  }
}

// --- "befahren": liegt ein GPS-Punkt in der Parzelle? ---

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Punkt in GeoJSON-(Multi)Polygon, Löcher berücksichtigt. */
export function pointInGeometry(lng: number, lat: number, geometry: string | null): boolean {
  if (!geometry) return false
  try {
    const g = JSON.parse(geometry) as { type: string; coordinates: number[][][] | number[][][][] }
    const polygons = g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : []
    return polygons.some((rings) => rings.length > 0 && inRing(lng, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lng, lat, hole)))
  } catch {
    return false
  }
}

/** Parzellen, in denen mindestens `minPoints` GPS-Punkte liegen. */
export function visitedParcels(items: PlanItem[], points: { lat: number; lng: number }[], minPoints = 3): Set<string> {
  const visited = new Set<string>()
  for (const it of items) {
    let n = 0
    for (const p of points) {
      if (pointInGeometry(p.lng, p.lat, it.geometry) && ++n >= minPoints) {
        visited.add(it.parcel_id)
        break
      }
    }
  }
  return visited
}

/** Erledigte Parzellen als ausgeführt übernehmen: geplante Einträge werden
 * zu definitiven mit dem Ausführungsdatum; nicht erledigte bleiben geplant. */
export async function completePlan(
  pg: PGlite,
  plan: ActivePlan,
  doneParcelIds: Set<string>,
  executedOn: string,
  /** gezählte Fässer je Parzelle (Güllefass): Menge und Anzahl übernehmen */
  measured?: Map<string, { m3: number; count: number }>,
): Promise<number> {
  const types = measured?.size ? await loadFertilizerTypes(pg, false) : []
  // Ein Eintrag über mehrere Parzellen gilt erst als ausgeführt, wenn alle
  // seine Parzellen erledigt sind.
  const fertIds = new Set<string>()
  const usageIds = new Set<string>()
  const open = new Set<string>()
  for (const it of plan.task.items) {
    const ids = [...it.fertilization_ids, ...it.usage_ids]
    if (doneParcelIds.has(it.parcel_id)) {
      it.fertilization_ids.forEach((id) => fertIds.add(id))
      it.usage_ids.forEach((id) => usageIds.add(id))
    } else ids.forEach((id) => open.add(id))
  }
  open.forEach((id) => {
    fertIds.delete(id)
    usageIds.delete(id)
  })
  let n = 0
  for (const [table, ids] of [
    ['fertilization_entries', fertIds],
    ['usage_entries', usageIds],
  ] as const) {
    if (!ids.size) continue
    const { rows } = await pg.query<Record<string, unknown>>(`select * from ${table} where id = any($1) and is_planned`, [[...ids]])
    for (const row of rows) {
      const m = table === 'fertilization_entries' && row.extent_type === 'parcel' ? measured?.get(String(row.parcel_id)) : undefined
      if (m) {
        // Menge aus den gezählten Fässern — Nährstoffe neu, auch im Anteil
        const type = types.find((t) => t.id === row.fertilizer_type_id) ?? null
        const nutrients = computeNutrients(m.m3, type, num(row.dilution_factor))
        await upsertRow(table, { ...row, id: String(row.id), entry_date: executedOn, is_planned: false, amount: m.m3, container_count: m.count, ...nutrients } as never)
        const { rows: shares } = await pg.query<Record<string, unknown>>('select * from fertilization_shares where entry_id = $1 and deleted_at is null', [row.id])
        for (const s of shares) await upsertRow('fertilization_shares', { ...s, id: String(s.id), ...nutrients } as never)
      } else {
        await upsertRow(table, { ...row, id: String(row.id), entry_date: executedOn, is_planned: false } as never)
      }
      n++
    }
  }
  return n
}
