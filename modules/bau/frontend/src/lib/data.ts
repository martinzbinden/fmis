// Laden und Ändern der Bauprojekte (alles über db/write.ts: volle Zeile, Outbox, Verlauf).

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { softDeleteRow, upsertRow, upsertRows } from '../db/write'
import { isoDate, num } from './format'
import { parseGeometry, stringifyGeometry, lengthM, type Geom } from './geometry'
import { planImport } from './importPlan'
import type { ImportedFeature } from './kml'
import { lineFromPoints, nextPointNo, nextSeq } from './survey'
import type { BauFeature, FeatureCategory, FeatureStatus, Project, ProjectStatus, SurveyPoint, Variant } from '../types'

const dates = (r: Project): Project => ({ ...r, start_date: isoDate(r.start_date), end_date: isoDate(r.end_date) })
const feature = (r: BauFeature): BauFeature => ({ ...r, diameter_mm: num(r.diameter_mm), depth_cm: num(r.depth_cm) })
const point = (r: SurveyPoint): SurveyPoint => ({
  ...r,
  lat: Number(r.lat),
  lng: Number(r.lng),
  accuracy_m: num(r.accuracy_m),
  altitude_m: num(r.altitude_m),
  depth_cm: num(r.depth_cm),
  measured_at: (r.measured_at as unknown) instanceof Date ? (r.measured_at as unknown as Date).toISOString() : String(r.measured_at),
})

export interface ProjectSummary extends Project {
  objectCount: number
  lengthM: number
  surveyed: number
}

export async function loadProjects(pg: PGlite): Promise<ProjectSummary[]> {
  const [p, f] = await Promise.all([
    pg.query<Project>('select * from projects where deleted_at is null order by updated_at desc'),
    pg.query<BauFeature>('select * from features where deleted_at is null'),
  ])
  const feats = f.rows.map(feature)
  return p.rows.map(dates).map((proj) => {
    // bei gewählter Variante zählen nur die gemeinsamen und deren Objekte
    const mine = feats.filter((x) => x.project_id === proj.id && x.status !== 'verworfen' && (!proj.chosen_variant_id || !x.variant_id || x.variant_id === proj.chosen_variant_id))
    return {
      ...proj,
      objectCount: mine.length,
      lengthM: mine.reduce((s, x) => s + (lengthM(parseGeometry(x.geometry)) ?? 0), 0),
      surveyed: mine.filter((x) => x.status === 'eingemessen').length,
    }
  })
}

export interface ProjectData {
  project: Project | null
  features: BauFeature[]
  points: SurveyPoint[]
  variants: Variant[]
}

export async function loadProject(pg: PGlite, id: string): Promise<ProjectData> {
  const [p, f, s, v] = await Promise.all([
    pg.query<Project>('select * from projects where id = $1 and deleted_at is null', [id]),
    pg.query<BauFeature>('select * from features where project_id = $1 and deleted_at is null order by sort_order, label', [id]),
    pg.query<SurveyPoint>('select * from survey_points where project_id = $1 and deleted_at is null order by point_no', [id]),
    pg.query<Variant>('select * from variants where project_id = $1 and deleted_at is null order by sort_order, name', [id]),
  ])
  return { project: p.rows[0] ? dates(p.rows[0]) : null, features: f.rows.map(feature), points: s.rows.map(point), variants: v.rows.map((x) => ({ ...x, sort_order: Number(x.sort_order) })) }
}

// ---------------------------------------------------------------- Projekte

export type ProjectInput = Pick<Project, 'name' | 'description' | 'status' | 'location' | 'start_date' | 'end_date' | 'contractor' | 'notes'>

export async function saveProject(input: ProjectInput, existing?: Project): Promise<string> {
  const id = existing?.id ?? crypto.randomUUID()
  await upsertRow('projects', { ...(existing ?? {}), ...input, id, created_by: existing?.created_by ?? getCurrentUserEmail() } as never)
  return id
}

export async function deleteProject(p: Project, features: BauFeature[], points: SurveyPoint[], variants: Variant[] = []): Promise<void> {
  for (const s of points) await softDeleteRow('survey_points', s.id)
  for (const f of features) await softDeleteRow('features', f.id)
  for (const v of variants) await softDeleteRow('variants', v.id)
  await softDeleteRow('projects', p.id)
}

// ---------------------------------------------------------------- Varianten

/** Neue Variante; mit `copyFrom` werden deren eigene Objekte als Ausgangspunkt kopiert (ohne Messpunkte). */
export async function addVariant(projectId: string, name: string, notes: string | null, existing: Variant[], features: BauFeature[], copyFrom?: string): Promise<string> {
  const id = crypto.randomUUID()
  const me = getCurrentUserEmail()
  await upsertRow('variants', { id, project_id: projectId, name, notes, sort_order: existing.reduce((m, v) => Math.max(m, v.sort_order), 0) + 1, created_by: me } as never)
  if (copyFrom) {
    const rows = features
      .filter((f) => f.variant_id === copyFrom)
      .map((f) => ({ ...f, id: crypto.randomUUID(), variant_id: id, status: f.status === 'verworfen' ? 'verworfen' : 'geplant', plan_geometry: null, created_by: me }))
    if (rows.length) await upsertRows('features', rows as never)
  }
  return id
}

export async function renameVariant(v: Variant, name: string, notes: string | null): Promise<void> {
  await upsertRow('variants', { ...v, name, notes } as never)
}

/** Variante samt ihren eigenen Objekten (und deren Messpunkten) löschen; gemeinsame Objekte bleiben. */
export async function removeVariant(p: Project, v: Variant, features: BauFeature[], points: SurveyPoint[]): Promise<void> {
  for (const f of features.filter((x) => x.variant_id === v.id)) await removeFeature(f, points)
  await softDeleteRow('variants', v.id)
  if (p.chosen_variant_id === v.id) await chooseVariant(p, null)
}

/** Variante festlegen (null = Wahl aufheben). Die Objekte selbst bleiben unverändert. */
export async function chooseVariant(p: Project, variantId: string | null): Promise<void> {
  await upsertRow('projects', { ...p, chosen_variant_id: variantId } as never)
}

// ---------------------------------------------------------------- Objekte

export interface FeatureInput {
  category: FeatureCategory
  status: FeatureStatus
  label: string | null
  geometry: Geom | null
  material?: string | null
  diameter_mm?: number | null
  depth_cm?: number | null
  notes?: string | null
  /** Variante; undefined = unverändert (neu: alle Varianten) */
  variant_id?: string | null
}

export async function saveFeature(projectId: string, input: FeatureInput, existing?: BauFeature, sortOrder = 0): Promise<string> {
  const id = existing?.id ?? crypto.randomUUID()
  const row: BauFeature = {
    plan_geometry: null,
    material: null,
    diameter_mm: null,
    depth_cm: null,
    notes: null,
    sort_order: sortOrder,
    variant_id: null,
    ...(existing ?? {}),
    id,
    project_id: projectId,
    category: input.category,
    status: input.status,
    label: input.label,
    geometry: input.geometry ? stringifyGeometry(input.geometry) : null,
    ...(input.material !== undefined ? { material: input.material } : {}),
    ...(input.diameter_mm !== undefined ? { diameter_mm: input.diameter_mm } : {}),
    ...(input.depth_cm !== undefined ? { depth_cm: input.depth_cm } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.variant_id !== undefined ? { variant_id: input.variant_id } : {}),
    created_by: existing?.created_by ?? getCurrentUserEmail(),
  } as BauFeature
  await upsertRow('features', row as never)
  return id
}

/** Geometrie eines Objekts ändern (zeichnen/Stützpunkte ziehen). Die erste Änderung an einem
 * geplanten Objekt ist kein Einmessen — die Planlinie bleibt nur beim Übernehmen von Messpunkten erhalten. */
export async function updateGeometry(f: BauFeature, geometry: Geom): Promise<void> {
  await upsertRow('features', { ...f, geometry: stringifyGeometry(geometry) } as never)
}

export async function duplicateFeature(f: BauFeature, category: FeatureCategory, label: string): Promise<string> {
  const id = crypto.randomUUID()
  await upsertRow('features', { ...f, id, category, label, status: 'geplant', plan_geometry: null, created_by: getCurrentUserEmail() } as never)
  return id
}

export async function removeFeature(f: BauFeature, points: SurveyPoint[]): Promise<void> {
  for (const s of points.filter((p) => p.feature_id === f.id)) await softDeleteRow('survey_points', s.id)
  await softDeleteRow('features', f.id)
}

/** Import ergänzt nur: schon vorhandene Objekte (Name + Geometrie) werden übersprungen. */
export async function importFeatures(
  projectId: string,
  existing: BauFeature[],
  imported: ImportedFeature[],
  variantId: string | null = null,
): Promise<{ added: number; skipped: number }> {
  const { toAdd, skipped } = planImport(existing, imported)
  const me = getCurrentUserEmail()
  const start = existing.reduce((m, f) => Math.max(m, f.sort_order), 0)
  const rows = toAdd.map((f, i) => ({
    id: crypto.randomUUID(),
    project_id: projectId,
    category: f.category,
    status: 'geplant',
    label: f.label,
    geometry: stringifyGeometry(f.geometry),
    plan_geometry: null,
    material: null,
    diameter_mm: null,
    depth_cm: null,
    notes: f.description || null,
    sort_order: start + i + 1,
    created_by: me,
    variant_id: variantId,
  }))
  if (rows.length) await upsertRows('features', rows as never)
  return { added: rows.length, skipped: skipped.length }
}

// ---------------------------------------------------------------- Einmessen

export interface FixInput {
  lat: number
  lng: number
  accuracy_m: number | null
  altitude_m: number | null
  depth_cm: number | null
  note: string | null
}

/** Messpunkt speichern (Rohdaten bleiben erhalten, auch nach «Linie übernehmen»). */
export async function addSurveyPoint(projectId: string, featureId: string | null, fix: FixInput, all: SurveyPoint[]): Promise<void> {
  await upsertRow('survey_points', {
    id: crypto.randomUUID(),
    project_id: projectId,
    feature_id: featureId,
    point_no: nextPointNo(all),
    seq: nextSeq(all, featureId),
    ...fix,
    measured_at: new Date().toISOString(),
    measured_by: getCurrentUserEmail(),
  } as never)
}

export async function removeSurveyPoint(p: SurveyPoint): Promise<void> {
  await softDeleteRow('survey_points', p.id)
}

/** «Linie aus Messpunkten übernehmen»: setzt die Geometrie des Objekts und den Status auf
 * «eingemessen». Die bisherige Planlinie bleibt in plan_geometry (nur beim ersten Mal). */
export async function adoptSurvey(f: BauFeature, points: SurveyPoint[]): Promise<boolean> {
  const mine = points.filter((p) => p.feature_id === f.id)
  const current = parseGeometry(f.geometry)
  let geom: Geom | null
  if (current?.type === 'Point') {
    const last = [...mine].sort((a, b) => a.seq - b.seq || a.measured_at.localeCompare(b.measured_at)).at(-1)
    geom = last ? { type: 'Point', coordinates: [last.lng, last.lat] } : null
  } else {
    const line = lineFromPoints(mine)
    if (current?.type === 'Polygon' && line && line.type === 'LineString' && line.coordinates.length >= 3) {
      geom = { type: 'Polygon', coordinates: [[...line.coordinates, line.coordinates[0]]] }
    } else geom = line
  }
  if (!geom) return false
  await upsertRow('features', {
    ...f,
    geometry: stringifyGeometry(geom),
    plan_geometry: f.plan_geometry ?? f.geometry,
    status: 'eingemessen',
  } as never)
  return true
}
