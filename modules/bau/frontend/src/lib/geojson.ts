// GeoJSON lesen und schreiben (WGS84, alle Attribute).

import { CATEGORY_ORDER, FEATURE_STATUS_ORDER, guessCategory } from './categories'
import { lengthM, normalizeGeometry, parseGeometry, type Geom } from './geometry'
import type { ImportedFeature } from './kml'
import type { BauFeature, FeatureCategory, FeatureStatus, SurveyPoint } from '../types'

type Json = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Features einlesen: FeatureCollection, einzelnes Feature oder blosse Geometrie. */
export function parseGeoJson(text: string): ImportedFeature[] {
  let root: Json
  try {
    root = JSON.parse(text) as Json
  } catch {
    return []
  }
  const features: Json[] =
    root.type === 'FeatureCollection' && Array.isArray(root.features)
      ? (root.features as Json[])
      : root.type === 'Feature'
        ? [root]
        : root.type
          ? [{ type: 'Feature', properties: {}, geometry: root }]
          : []
  const out: ImportedFeature[] = []
  for (const f of features) {
    const props = (f.properties ?? {}) as Json
    const label = str(props.label) ?? str(props.name) ?? str(props.Name) ?? 'Ohne Namen'
    const description = str(props.description) ?? str(props.notes) ?? ''
    const geom = (f.geometry ?? null) as Json | null
    const parts: unknown[] =
      geom?.type === 'MultiLineString' && Array.isArray(geom.coordinates)
        ? (geom.coordinates as unknown[]).map((c) => ({ type: 'LineString', coordinates: c }))
        : geom?.type === 'MultiPoint' && Array.isArray(geom.coordinates)
          ? (geom.coordinates as unknown[]).map((c) => ({ type: 'Point', coordinates: c }))
          : [geom]
    parts.forEach((p, i) => {
      const geometry = normalizeGeometry(p)
      if (!geometry) return
      const cat = str(props.category)
      out.push({
        label: parts.length > 1 ? `${label} (${i + 1})` : label,
        description,
        geometry,
        category: (CATEGORY_ORDER as string[]).includes(cat ?? '') ? (cat as FeatureCategory) : guessCategory(label, description),
      })
    })
  }
  return out
}

export function statusOf(v: unknown): FeatureStatus {
  return (FEATURE_STATUS_ORDER as string[]).includes(String(v)) ? (v as FeatureStatus) : 'geplant'
}

/** GeoJSON mit allen Attributen; Messpunkte als Points (feature = 'messpunkt'). */
/** `cultures`: Kulturflächen als Grundlage (feature = «grundlage»). */
export function buildGeoJson(projectName: string, features: BauFeature[], points: SurveyPoint[] = [], cultures: { name: string; geometry: Geom }[] = []): string {
  const fs = features.flatMap((f) => {
    const g = parseGeometry(f.geometry)
    if (!g) return []
    return [
      {
        type: 'Feature',
        geometry: g,
        properties: {
          feature: 'objekt',
          id: f.id,
          label: f.label,
          category: f.category,
          status: f.status,
          material: f.material,
          diameter_mm: f.diameter_mm,
          depth_cm: f.depth_cm,
          length_m: lengthM(g) != null ? Math.round(lengthM(g)! * 10) / 10 : null,
          notes: f.notes,
        },
      },
    ]
  })
  const ps = points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: {
      feature: 'messpunkt',
      point_no: p.point_no,
      object_id: p.feature_id,
      accuracy_m: p.accuracy_m,
      altitude_m: p.altitude_m,
      depth_cm: p.depth_cm,
      note: p.note,
      measured_at: p.measured_at,
      measured_by: p.measured_by,
    },
  }))
  const cs = cultures.map((c) => ({ type: 'Feature', geometry: c.geometry, properties: { feature: 'grundlage', grundlage: 'Kulturfläche', label: c.name } }))
  return JSON.stringify({ type: 'FeatureCollection', name: projectName, features: [...fs, ...ps, ...cs] }, null, 1)
}
