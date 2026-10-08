// Domain-Typen — spiegeln schema/0001_init.sql 1:1.

export type AnimalSex = 'w' | 'm'
export type AnimalStatus = 'aktiv' | 'abgegangen'

export interface Animal {
  id: string
  ear_tag: string
  name: string | null
  breed_code: string | null
  birth_date: string | null
  sex: AnimalSex | null
  status: AnimalStatus
  entry_date: string | null
  exit_date: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
  lauf_nr: string | null
}

// Milchwägung (schema/0005_milking.sql): Bank = Melkstand-Durchgang mit
// `capacity` Plätzen, Slots = gelesene Tiere in Lese-Reihenfolge.
export interface MilkingBank {
  id: string
  session_date: string
  bank_number: number
  capacity: number
  opened_at: string
  closed_at: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface MilkingSlot {
  id: string
  bank_id: string
  position: number
  original_position: number
  transponder: string | null
  ear_tag: string | null
  animal_id: string | null
  weighed: boolean
  notes: string | null
  read_at: string | null
  updated_at: string
  deleted_at: string | null
}

export type JournalCategory = 'notiz' | 'beobachtung' | 'krankheit' | 'behandlung' | 'brunst' | 'klauen' | 'trocken'

export interface AnimalJournalEntry {
  id: string
  /** leer bei importierten Behandlungen von Tieren ausserhalb der Herde (ear_tag/animal_name) */
  animal_id: string | null
  entry_date: string
  source: 'manual' | 'milchwaegung' | 'import'
  text: string
  ref_id: string | null
  updated_at: string
  deleted_at: string | null
  // schema/0007_journal_health.sql — null bei Zeilen von älteren Geräten = 'notiz'
  category: JournalCategory | null
  diagnosis: string | null
  medication: string | null
  dose: string | null
  withdrawal_milk_days: number | null
  withdrawal_meat_days: number | null
  administered_by: string | null
  // schema/0013_treatment_journal.sql — Behandlungsjournal (TAMV)
  ear_tag: string | null
  animal_name: string | null
  /** HH:MM der ersten Anwendung */
  treatment_time: string | null
  /** letzte Anwendung (leer = entry_date) */
  last_date: string | null
  applications: number | null
  /** Abgabestelle / Herkunft des Tierarzneimittels */
  supplier: string | null
  /** Organsystem, Position (cownect "OS, Position") */
  body_system: string | null
  /** 2 = doppelte Absetzfrist (Bio) */
  withdrawal_factor: number | null
  /** erster Tag, an dem Milch/Fleisch wieder geliefert werden darf */
  release_milk_date: string | null
  release_meat_date: string | null
  critical_antibiotic: boolean | null
  antibiogram: boolean | null
  /** Präparate desselben Falls */
  case_id: string | null
  import_key: string | null
}

/** Favorit: typische Behandlung mit einem oder mehreren Präparaten. */
export interface TreatmentTemplate {
  id: string
  title: string
  body_system: string | null
  diagnosis: string | null
  /** JSON TemplateItem[] */
  items: string
  supplier: string | null
  notes: string | null
  sort_order: number
  updated_at: string
  deleted_at: string | null
}

export interface TemplateItem {
  medication: string
  dose: string
  /** Anzahl Anwendungen */
  applications: number | null
  /** Behandlungsdauer in Tagen (1 = nur heute) */
  days: number | null
  milk_days: number | null
  meat_days: number | null
  /** Hinweis, z.B. "Präparat gemäss Tierarzt wählen" */
  hint?: string
}

export interface MilkTest {
  id: string
  animal_id: string
  test_date: string
  calving_date: string | null
  lactation_number: number | null
  milk_kg: number
  // null = Wägung ohne Laboranalyse (nur kg Milch), siehe schema/0004.
  fat_pct: number | null
  protein_pct: number | null
  lactose_pct: number | null
  cell_count: number | null
  urea_mg_dl: number | null
  updated_at: string
  deleted_at: string | null
}

// Spiegelt v_animal_milk_current (schema/0003_lactations.sql) — jeweils
// neuester Test pro Kuh inkl. berechneter kg Fett/Eiweiss/ECM.
export interface AnimalMilkCurrent {
  animal_id: string
  ear_tag: string
  name: string | null
  status: AnimalStatus
  test_date: string
  milk_kg: number
  // Alle Fett-/Eiweiss-Werte null, wenn die neueste Wägung keine
  // Laboranalyse hatte (has_analysis = false), siehe schema/0004.
  fat_pct: number | null
  protein_pct: number | null
  fat_kg: number | null
  protein_kg: number | null
  fat_protein_kg: number | null
  ecm_kg: number | null
  has_analysis: boolean
}

// ADIS Satzart K04 — Abschlussart-Code, siehe schema/0003_lactations.sql.
// 8 = laufender Stand, 9 = Prognose, 1/4-7 = abgeschlossen (Varianten),
// 2 = Standardabschluss (305 Tage), 3 = Vollabschluss.
export type LactationClosureType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface Lactation {
  id: string
  animal_id: string
  lactation_number: number
  calving_date: string | null
  closure_type: LactationClosureType
  days_in_milk: number | null
  milk_kg: number | null
  fat_kg: number | null
  fat_pct: number | null
  protein_kg: number | null
  protein_pct: number | null
  updated_at: string
  deleted_at: string | null
}

// Spiegelt v_lactation_summary — die "beste" Zeile pro (Kuh, Laktation).
export interface LactationSummary {
  lactation_id: string
  animal_id: string
  ear_tag: string
  name: string | null
  lactation_number: number
  calving_date: string | null
  closure_type: LactationClosureType
  days_in_milk: number | null
  milk_kg: number | null
  fat_kg: number | null
  fat_pct: number | null
  protein_kg: number | null
  protein_pct: number | null
  fat_protein_kg: number | null
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
