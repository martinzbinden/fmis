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

export interface AnimalJournalEntry {
  id: string
  animal_id: string
  entry_date: string
  source: 'manual' | 'milchwaegung'
  text: string
  ref_id: string | null
  updated_at: string
  deleted_at: string | null
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
