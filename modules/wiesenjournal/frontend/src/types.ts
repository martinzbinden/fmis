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
  is_planned: boolean
  /** Aus Herden abgeleitet (lib/herds.ts), nicht gespeichert — Gruppe */
  herd_group_id?: string
}

export type DuengungCode = 'RGv' | 'RGk' | 'RMI' | 'RMs' | 'SG' | 'SM' | 'A' | 'H' | 'V'
export type DuengungUnit = 'm3' | 't' | 'kg'
// Flächenbezug einer Massnahme, siehe schema/0011_fertilization_extent.sql.
export type ExtentType = 'parcel' | 'parcels' | 'polygon' | 'track'

// Düngerart mit Nährstoffgehalten je Einheit (schema/0010_fertilizer_types.sql).
export interface FertilizerType {
  id: string
  code: string
  name: string
  unit: DuengungUnit
  n_kg_per_unit: number
  n_avail_pct: number
  p2o5_kg_per_unit: number
  k2o_kg_per_unit: number
  mg_kg_per_unit: number | null
  dilution_default: number
  container_label: string | null
  container_size: number | null
  legacy_code: string | null
  sort_order: number
  active: boolean
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface FertilizationEntry {
  id: string
  parcel_id: string | null   // Anker-Parzelle; null bei Polygon/Track ohne Parzellentreffer
  entry_date: string
  duengung_code: DuengungCode
  amount: number | null
  unit: DuengungUnit
  gabe_number: number | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
  fertilizer_type_id: string | null
  dilution: string | null
  dilution_factor: number | null
  container_count: number | null
  extent_type: ExtentType
  track_id: string | null
  track_width_m: number | null
  geometry: string | null
  area_a: number | null
  n_kg: number | null
  n_avail_kg: number | null
  p2o5_kg: number | null
  k2o_kg: number | null
  import_key: string | null
  is_planned: boolean
}

// Anteil einer Massnahme an einer Journal-(GELAN-)Parzelle.
export interface FertilizationShare {
  id: string
  entry_id: string
  parcel_id: string
  area_a: number
  n_kg: number | null
  n_avail_kg: number | null
  p2o5_kg: number | null
  k2o_kg: number | null
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
  // 'geodaten': künftig automatisch vom Geodatenserver befüllt (noch nicht
  // angebunden); 'manuell': lokal erfasst/überschrieben, hat Vorrang.
  wetter_quelle: 'geodaten' | 'manuell'
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
  work_type: string | null
  machine: string | null
  operator: string | null
  /** Verknüpfung mit der Maschinenliste (schema/0015); machine bleibt als Anzeigename. */
  machine_id?: string | null
  /** Traktor dazu (schema/0016). */
  tractor_id?: string | null
}

export type MachineKind =
  | 'guellefass'
  | 'miststreuer'
  | 'duengerstreuer'
  | 'maehwerk'
  | 'zettwender'
  | 'schwader'
  | 'ladewagen'
  | 'saemaschine'
  | 'saatkombination'
  | 'kreiselegge'
  | 'pflug'
  | 'traktor'
  // schema/0019: Hoflader als Träger, seine Anbaugeräte, weitere Arten
  | 'hoflader'
  | 'ladergeraet'
  | 'aufbereiter'
  | 'motormaeher'
  | 'viehanhaenger'
  | 'verschlauchung'
  // schema/0020: Autos (Wartung in km)
  | 'auto'
  | 'andere'

export interface Machine {
  id: string
  name: string
  kind: MachineKind
  capacity: number | null
  capacity_unit: DuengungUnit | null
  width_m: number | null
  notes: string | null
  active: boolean
  sort_order: number
  updated_at: string
  deleted_at: string | null
  // Typenschild (schema/0016)
  manufacturer: string | null
  model: string | null
  type_no: string | null
  serial_no: string | null
  year_built: number | null
  weight_kg: number | null
  /** Nur Traktoren. */
  power_hp: number | null
  /** schema/0019: Eigentümer, null = eigener Betrieb */
  owner?: string | null
  /** schema/0020: Kategorie-Knopf, null = automatisch nach Art */
  category?: MachineCategory | null
  front_pto: boolean | null
  /** Anbaugeräte: Standard-Traktor (Vorschlag in Arbeitsplan und Tracking). */
  tractor_id: string | null
}

export type MachineCategory = 'zugfahrzeug' | 'anbaugeraet' | 'anhaenger' | 'auto' | 'uebrige'

export type MaintenanceTaskType = 'oel' | 'filter' | 'schmieren' | 'kontrolle' | 'verschleiss' | 'service' | 'andere'

/** Wartungsplan-Position (schema/0020). Intervall in Zählereinheit der
 * Maschine (Betriebsstunden, bei Autos km) und/oder Monaten. */
export interface MaintenanceTask {
  id: string
  machine_id: string
  title: string
  task_type: MaintenanceTaskType
  interval_count: number | null
  interval_months: number | null
  notes: string | null
  active: boolean
  sort_order: number
  template_key: string | null
  updated_at: string
  deleted_at: string | null
}

export type MaintenanceEntryType = 'wartung' | 'reparatur' | 'kontrolle' | 'zaehlerstand'

/** Wartungsjournal-Eintrag (schema/0020); task_ids = JSON-Array als Text. */
export interface MaintenanceLog {
  id: string
  machine_id: string
  done_date: string
  entry_type: MaintenanceEntryType
  title: string | null
  task_ids: string | null
  counter: number | null
  cost_chf: number | null
  material: string | null
  done_by: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export type MachineFileKind = 'bild' | 'anleitung' | 'dokument'

/** Bild/Anleitung zu einer Maschine; der Inhalt liegt nur auf dem Server. */
export interface MachineFile {
  id: string
  machine_id: string
  kind: MachineFileKind
  title: string | null
  filename: string
  content_type: string
  size_bytes: number | null
  source_url: string | null
  sort_order: number
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
  accuracy_m: number | null
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

// --- Herden und Standorte (schema/0017_herds.sql) ---

export type HerdSpecies = 'schafe' | 'rinder'
export type LocationKind = 'stall' | 'weide' | 'alp' | 'andere'
/** Laufhof beim Ort (schema/0018): ständig zugänglich, zeitweise (Gänge
 * täglich erfassen) oder keiner. */
export type LaufhofMode = 'keiner' | 'staendig' | 'zeitweise'

export interface HerdLocation {
  id: string
  name: string
  site: string | null
  kind: LocationKind
  sort_order: number
  active: boolean
  notes: string | null
  updated_at: string
  deleted_at: string | null
  laufhof: LaufhofMode
}

/** Gruppe war an diesem Tag im Laufhof (schema/0018). */
export interface HerdLaufhof {
  id: string
  group_id: string
  entry_date: string
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface HerdGroup {
  id: string
  name: string
  species: HerdSpecies
  milking: boolean
  active: boolean
  sort_order: number
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export type StaySlot = 'stall' | 'weide'

export interface HerdStay {
  id: string
  group_id: string
  slot: StaySlot
  location_id: string | null
  parcel_id: string | null
  day_only: boolean
  from_date: string
  to_date: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface HerdMember {
  id: string
  group_id: string
  module_key: string
  animal_id: string
  label: string | null
  category: string
  from_date: string
  to_date: string | null
  updated_at: string
  deleted_at: string | null
}

export interface HerdCount {
  id: string
  group_id: string
  category: string
  count: number
  from_date: string
  to_date: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}
