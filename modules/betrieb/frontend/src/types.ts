import type { DuengungUnit } from '@fmis/wiesenjournal/types'

// Domain-Typen des Moduls Betrieb — spiegeln schema/0001_init.sql.

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
  /** Nulllinie fürs Parallelfahren, JSON GuideRef (schema/0025) */
  guide_ref?: string | null
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
  // Fahrhilfe: Wiesenstriegel
  | 'striegel'
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
  /** schema/0021: Güllefass-Ausfluss m³/min (Startwert, geeicht über tank_events) */
  flow_m3_min?: number | null
  /** JSON [{key, label, unit, part}] — Einstellgrössen (lib/machineSettings.ts) */
  settings_def?: string | null
  front_pto: boolean | null
  /** Anbaugeräte: Standard-Traktor (Vorschlag in Arbeitsplan und Tracking). */
  tractor_id: string | null
}

/** Ein Güllefass während des Trackings (schema/0021). */
export interface TankEvent {
  id: string
  track_id: string | null
  machine_id: string | null
  parcel_id: string | null
  event_at: string
  source: 'knopf' | 'auto'
  /** Menge des Behälters in `unit` (Name aus Güllefass-Zeiten) */
  volume_m3: number
  /** schema/0022 */
  unit?: DuengungUnit
  distance_m: number
  spread_s: number
  width_m: number
  lat: number | null
  lng: number | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
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

export type MaintenanceEntryType = 'wartung' | 'reparatur' | 'kontrolle' | 'zaehlerstand' | 'beobachtung' | 'schaden'

/** Pendenz (offene Aufgabe) an einer Maschine, schema/0024. */
export interface MachineTodo {
  id: string
  machine_id: string
  title: string
  notes: string | null
  priority: 'hoch' | 'normal' | 'tief'
  due_date: string | null
  status: 'offen' | 'erledigt'
  done_date: string | null
  log_id: string | null
  done_log_id: string | null
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}

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

// --- Dienstplan (schema/0026) ---
export interface DutyPerson {
  id: string
  name: string
  email: string | null
  color: string | null
  active: boolean
  sort_order: number
  notes: string | null
  updated_at: string
  deleted_at: string | null
}
export interface DutyType {
  id: string
  name: string
  /** HH:MM */
  start_time: string
  duration_min: number
  /** Plätze je Wochentag Mo..So, z.B. '1111111' */
  weekdays: string
  color: string | null
  description: string | null
  active: boolean
  sort_order: number
  updated_at: string
  deleted_at: string | null
  /** Tierart, steht vor dem Namen (schema/0005) */
  animal: string | null
  /** MM-DD: nur in diesem Zeitraum aktiv (leer = ganzjährig) */
  active_from: string | null
  active_to: string | null
  /** MM-DD: Sommer (leer = 04-01 bis 10-31), sonst Winter */
  summer_from: string | null
  summer_to: string | null
  /** JSON: Zeiten je Wochentag und Jahreszeit (siehe lib/duty.ts parseTimes) */
  times: string | null
}
export interface DutySkill {
  id: string
  person_id: string
  type_id: string
  updated_at: string
  deleted_at: string | null
}
export type DutyAbsenceKind = 'ferien' | 'frei' | 'krank' | 'kurs' | 'andere'
export interface DutyAbsence {
  id: string
  person_id: string
  from_date: string
  to_date: string
  kind: DutyAbsenceKind
  notes: string | null
  created_by: string | null
  updated_at: string
  deleted_at: string | null
}
export interface DutyShift {
  id: string
  type_id: string
  date: string
  slot: number
  person_id: string | null
  notes: string | null
  assigned_by: string | null
  updated_at: string
  deleted_at: string | null
}
export interface DutyChange {
  id: string
  shift_id: string
  date: string
  type_id: string
  from_person: string | null
  to_person: string | null
  kind: 'einteilen' | 'tausch' | 'abgabe' | 'entfernt'
  changed_by: string | null
  changed_at: string
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

/** Standard-Wochenplan (schema/0006): gilt ab valid_from, bis eine spätere Version beginnt. */
export interface DutyTemplate {
  id: string
  name: string
  valid_from: string
  cycle_weeks: number
  notes: string | null
  updated_at: string
  deleted_at: string | null
}
export interface DutyTemplateSlot {
  id: string
  template_id: string
  week_no: number
  weekday: number
  type_id: string
  slot: number
  person_id: string | null
  updated_at: string
  deleted_at: string | null
}
export type DutyWeekStatus = 'entwurf' | 'bestaetigt'
export interface DutyWeek {
  id: string
  week_start: string
  status: DutyWeekStatus
  generated_at: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export type DutyRequestKind = 'wunsch' | 'abgabe' | 'tausch'
export type DutyRequestStatus = 'offen' | 'bestaetigt' | 'abgelehnt' | 'zurueckgezogen'
/** Freiwunsch oder Vorschlag (Abgabe, Tausch) einer Person; das Büro entscheidet (schema/0004). */
export interface DutyRequest {
  id: string
  kind: DutyRequestKind
  person_id: string
  shift_id: string | null
  date: string | null
  type_id: string | null
  to_person: string | null
  other_shift_id: string | null
  other_date: string | null
  other_type_id: string | null
  from_date: string | null
  to_date: string | null
  notes: string | null
  status: DutyRequestStatus
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_by: string | null
  updated_at: string
  deleted_at: string | null
  /** bei kind 'wunsch': welche Abwesenheit (schema/0007); leer = frei */
  absence_kind: DutyAbsenceKind | null
  /** Abtausch: Zustimmung der Gegenpartei (to_person); null = keine Gegenpartei (schema/0008) */
  counter_status: 'offen' | 'zugestimmt' | 'abgelehnt' | null
  counter_at: string | null
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
