// Domain-Typen — spiegeln schema/0001_init.sql 1:1.

export type Intensitaet = 'i' | 'wi' | 'e' | 'mi'
// Herkunft einer Journal-Parzelle: 'fields' = aus dem Kulturen-Modul (GELAN)
// übernommen (Name/Fläche/Geometrie werden vom Server nachgeführt), 'excel' =
// aus dem Excel-Import ohne GELAN-Treffer, 'manual' = in der App angelegt.
export type ParcelSource = 'manual' | 'fields' | 'excel'
// futter = 6xx Grünland, acker = 5xx offene Ackerfläche (siehe schema/0006).
export type ParcelCategory = 'futter' | 'acker' | 'andere'

export interface Parcel {
  id: string
  season_year: number
  name: string
  area_a: number | null
  wiesentyp: string | null
  intensitaet: Intensitaet | null
  base_geometry: string | null
  sort_order: number
  notes: string | null
  updated_at: string
  deleted_at: string | null
  source: ParcelSource
  category: ParcelCategory
  farm_id: string | null
  farm_name: string | null
  fields_lineage_id: string | null
  fields_declaration_id: string | null
  external_kultur_id: string | null
  kultur_code: string | null
  kultur_name_de: string | null
}

// Versionierte Weidegang-/Zaun-Geometrie — jede Bearbeitung ist eine neue
// Zeile (is_current markiert die jeweils aktuelle Version je paddock_id),
// siehe schema/0001_init.sql.
export interface Paddock {
  id: string
  paddock_id: string
  version_number: number
  is_current: boolean
  parcel_id: string | null
  season_year: number
  valid_from: string
  valid_to: string | null
  animal_group: string | null
  geometry: string
  notes: string | null
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}

// Legende des Wiesenjournals (siehe schema/0007_usage_model.sql, lib/format.ts
// USAGE_TYPE_LETTER / ANIMAL_CATEGORY_LETTER).
export type UsageType =
  | 'weide'
  | 'eingrasen'
  | 'silage'
  | 'duerrfutter_bel'
  | 'duerrfutter_unbel'
  | 'weide_putzen'
  | 'blacken_stechen'
  | 'blacken_einzelstock'
  | 'blacken_flaeche'
  | 'uebersaat'
  | 'aufwuchshoehe'
  | 'pflug'
  | 'saat'
  | 'striegeln'
  | 'saeuberungsschnitt'
  | 'sonstig'
export type AnimalCategory = 'kuehe' | 'rinder' | 'kaelber' | 'galtkuehe' | 'schafe' | 'legehennen'
export type YieldUnit = 'rb' | 'fu' | 'st' | 'kg' | 'dt_ts'

export interface UsageEntry {
  id: string
  parcel_id: string
  entry_date: string
  usage_type: UsageType
  animal_count: number | null
  animal_group: string | null
  paddock_version_id: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
  animal_category: AnimalCategory | null
  day_only: boolean
  label: string | null
  value_num: number | null
  yield_amount: number | null
  yield_unit: YieldUnit | null
  import_key: string | null
}

export type DuengungCode = 'RGv' | 'RGk' | 'RMI' | 'RMs' | 'SG' | 'SM' | 'A' | 'H' | 'V'
export type DuengungUnit = 'm3' | 't' | 'kg'

export interface FertilizationEntry {
  id: string
  parcel_id: string
  entry_date: string
  duengung_code: DuengungCode
  amount: number | null
  unit: DuengungUnit
  gabe_number: number | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface NDoseSummary {
  id: string
  parcel_id: string
  season_year: number
  gabe_number: number
  guelle_verduennung: string | null
  n_planned_kg: number | null
  n_actual_kg: number | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface DailyFarmLog {
  id: string
  entry_date: string
  laufhof_kuehe: boolean | null
  laufhof_rinder: boolean | null
  wetter_code: string | null
  niederschlag_mm: number | null
  mond_phase: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
  laufhof_kaelber: boolean | null
  laufhof_galtkuehe: boolean | null
  laufhof_schafe: boolean | null
  laufhof_legehennen: boolean | null
  animal_counts: string | null   // JSON {"kuehe": 20, ...}
}

export interface Track {
  id: string
  season_year: number
  label: string | null
  started_at: string
  ended_at: string | null
  width_m: number | null
  geometry: string | null
  point_times: string | null
  point_count: number
  notes: string | null
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}

export type WeedType = 'blacken' | 'disteln' | 'andere'
export type WeedSeverity = 'einzeln' | 'nest' | 'flaechig'
export type WeedSource = 'manual' | 'gps_dwell'

export interface WeedObservation {
  id: string
  season_year: number
  parcel_id: string | null
  track_id: string | null
  observed_at: string
  weed_type: WeedType
  severity: WeedSeverity | null
  treatment: string | null
  treated_at: string | null
  source: WeedSource
  geometry: string
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
