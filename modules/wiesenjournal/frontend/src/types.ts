// Domain-Typen — spiegeln schema/0001_init.sql 1:1.

export type Intensitaet = 'i' | 'wi' | 'e' | 'mi'

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

export type UsageType = 'weide' | 'weide_anzahl' | 'eingrasen'

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
