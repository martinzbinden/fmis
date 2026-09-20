// Domain-Typen — spiegeln schema/0001_init.sql 1:1.

export interface Farm {
  id: string
  external_uid: string | null
  bur_nr: string | null
  name: string
  updated_at: string
  deleted_at: string | null
}

export interface ManagementUnit {
  id: string
  farm_id: string
  external_id: string
  jahr: number
  gemeinde_bfs_nr: string | null
  zone: string | null
  name: string | null
  area_total_a: number | null
  area_unprod_a: number | null
  area_wald_a: number | null
  area_land_a: number | null
  updated_at: string
  deleted_at: string | null
}

export type FieldDeclarationSource = 'import' | 'plan'

// GeoJSON Geometrie (Polygon/MultiPolygon/Point), WGS84. field_declarations.geometry
// wird als JSON-Text gespeichert (siehe schema/0001_init.sql) — Aufrufer
// müssen selbst JSON.parse()/JSON.stringify() anwenden.
export interface FieldGeometry {
  type: 'Polygon' | 'MultiPolygon' | 'Point'
  coordinates: unknown
}

export interface FieldDeclaration {
  id: string
  farm_id: string
  lineage_id: string
  management_unit_external_id: string | null
  external_kultur_id: string | null
  jahr: number
  sequence_in_year: number
  kultur_code: string
  kultur_name_de: string | null
  kultur_name_fr: string | null
  flurname: string | null
  area_a: number | null
  baeume: number | null
  geometry: string | null
  source: FieldDeclarationSource
  notes: string | null
  // Saat-/Erntedatum, falls Kulturmassnahmen erfasst wurden (siehe
  // schema/0003_dates.sql) — sonst null, die Zeitstrahl-Ansicht nimmt dann
  // ersatzweise das volle Kalenderjahr.
  start_date: string | null
  end_date: string | null
  sorte: string | null
  updated_at: string
  deleted_at: string | null
}

// Spiegelt v_field_lineage_summary — jüngste Zeile je Parzellen-Linie.
export interface FieldLineageSummary {
  lineage_id: string
  farm_id: string
  flurname: string | null
  kultur_code: string
  kultur_name_de: string | null
  latest_jahr: number
}

// Ein benannter Planungs-Layer (Szenario) — mehrere können parallel
// existieren, siehe schema/0006_plan_layers.sql.
export interface PlanLayer {
  id: string
  name: string
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}

// Schreibbarer, versionierter Planungs-Layer — jede Zeile ist eine
// unveränderliche Version, siehe schema/0005_plan_layer.sql,
// schema/0006_plan_layers.sql und lib/planLayer.ts für die Schreiblogik.
export interface PlanParcel {
  id: string
  plan_id: string
  layer_id: string
  version_number: number
  is_current: boolean
  farm_id: string
  source_declaration_id: string | null
  jahr: number
  kultur_code: string | null
  kultur_name_de: string | null
  kultur_name_fr: string | null
  sorte: string | null
  flurname: string | null
  area_a: number | null
  geometry: string | null
  notes: string | null
  created_by: string | null
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
