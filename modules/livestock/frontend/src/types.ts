// Domain-Typen — spiegeln schema/0001_init.sql 1:1.

export type AnimalSex = 'm' | 'w' | 'k'
export type AnimalStatus = 'aktiv' | 'verkauft' | 'geschlachtet' | 'verendet'
export type GroupStatus = 'aktiv' | 'abgeschlossen'

export interface Animal {
  id: string
  ear_tag: string
  birth_date: string | null
  sex: AnimalSex
  status: AnimalStatus
  entry_date: string | null
  entry_weight_kg: number | null
  purchase_cost: number
  source_tvd_nr: string | null
  source_name: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface AnimalGroup {
  id: string
  name: string
  created_date: string
  target_weight_min_kg: number
  target_weight_max_kg: number
  status: GroupStatus
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface GroupMembership {
  id: string
  animal_id: string
  group_id: string
  start_date: string
  end_date: string | null
  updated_at: string
  deleted_at: string | null
}

export interface Weighing {
  id: string
  animal_id: string
  date: string
  weight_kg: number
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface Medication {
  id: string
  animal_id: string
  date: string
  medication_name: string
  dose: string | null
  reason: string | null
  withdrawal_days: number
  administered_by: string | null
  cost: number | null
  updated_at: string
  deleted_at: string | null
}

export interface FeedRecord {
  id: string
  group_id: string
  date: string
  feed_type: string
  quantity: number
  unit: string
  cost_total: number | null
  supplier: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface Expense {
  id: string
  group_id: string
  date: string
  category: string
  description: string | null
  amount: number
  updated_at: string
  deleted_at: string | null
}

export interface SlaughterResult {
  id: string
  animal_id: string
  slaughter_date: string
  slaughterhouse: string | null
  carcass_weight_kg: number | null
  classification: string | null
  fat_class: string | null
  price_per_kg: number | null
  total_revenue: number | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface AnimalEconomics {
  animal_id: string
  ear_tag: string
  status: AnimalStatus
  purchase_cost: number
  medication_cost: number
  allocated_group_cost: number
  total_revenue: number
  profit: number
}
