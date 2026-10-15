// Domain-Typen des Moduls Tiere — spiegeln schema/0001_init.sql.

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
