// Domain-Typen — spiegeln modules/bau/schema/0001_init.sql.

export type ProjectStatus = 'idee' | 'geplant' | 'bewilligt' | 'im_bau' | 'abgeschlossen'

export type FeatureCategory =
  | 'guelle'
  | 'strom'
  | 'wasser'
  | 'abwasser'
  | 'drainage'
  | 'kommunikation'
  | 'leerrohr'
  | 'gebaeude'
  | 'schacht'
  | 'sonstiges'

export type FeatureStatus = 'geplant' | 'gebaut' | 'eingemessen' | 'verworfen'

export interface Project {
  id: string
  name: string
  description: string | null
  status: ProjectStatus
  location: string | null
  start_date: string | null
  end_date: string | null
  contractor: string | null
  notes: string | null
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}

export interface BauFeature {
  id: string
  project_id: string
  category: FeatureCategory
  status: FeatureStatus
  label: string | null
  /** GeoJSON-Geometrie (Point, LineString, Polygon) als Text, WGS84 */
  geometry: string | null
  /** ursprüngliche Planlinie, falls die Geometrie durch Einmessen ersetzt wurde */
  plan_geometry: string | null
  material: string | null
  diameter_mm: number | null
  depth_cm: number | null
  notes: string | null
  sort_order: number
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}

export interface SurveyPoint {
  id: string
  project_id: string
  feature_id: string | null
  /** fortlaufende Punktnummer im Projekt (P001 …) */
  point_no: number
  /** Reihenfolge innerhalb des Objekts (Linie) */
  seq: number
  lat: number
  lng: number
  accuracy_m: number | null
  altitude_m: number | null
  depth_cm: number | null
  note: string | null
  measured_at: string
  measured_by: string | null
  updated_at: string
  deleted_at: string | null
}

export type HistoryAction = 'insert' | 'update' | 'delete'

export interface DataHistory {
  id: string
  table_name: string
  row_id: string
  action: HistoryAction
  changed_by: string | null
  changed_at: string
  snapshot: string
  updated_at: string
}

/** Grundlage (schema/0003_overlays.sql), z.B. eine Ebene des Leitungskatasters: nur Anzeige. */
export interface BauOverlay {
  id: string
  group_id: string
  group_name: string
  kind: string
  name: string
  color: string | null
  south: number
  west: number
  north: number
  east: number
  opacity: number
  /** standardmässig eingeblendet */
  visible: boolean
  sort_order: number
  source: string | null
  size_bytes: number | null
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}
