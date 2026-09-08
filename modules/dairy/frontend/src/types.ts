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
}

export interface MilkTest {
  id: string
  animal_id: string
  test_date: string
  calving_date: string | null
  lactation_number: number | null
  milk_kg: number
  fat_pct: number
  protein_pct: number
  lactose_pct: number | null
  cell_count: number | null
  urea_mg_dl: number | null
  updated_at: string
  deleted_at: string | null
}

// Spiegelt v_animal_milk_current (schema/0001_init.sql) — jeweils neuester
// Test pro Kuh inkl. berechneter kg Fett/Eiweiss.
export interface AnimalMilkCurrent {
  animal_id: string
  ear_tag: string
  name: string | null
  status: AnimalStatus
  test_date: string
  milk_kg: number
  fat_pct: number
  protein_pct: number
  fat_kg: number
  protein_kg: number
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
