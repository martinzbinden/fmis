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
