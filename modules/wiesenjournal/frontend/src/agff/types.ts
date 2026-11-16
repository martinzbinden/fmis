// Domain-Typen — spiegeln src/db/schema/0001_init.sql.

export type Intensitaet = 'i' | 'mi' | 'wi' | 'e'
export type ParcelSource = 'gelan' | 'manual'
export type ParcelCategory = 'futter' | 'acker' | 'andere'

export interface Parcel {
  id: string
  season_year: number
  /** angezeigter Name: aus dem Import oder ein eigener (Kurzname) */
  name: string
  /** Name aus dem Import, wenn ein eigener Name gesetzt ist (sonst null); der Import führt nur ihn nach (lib/kurzname.ts) */
  name_import: string | null
  area_a: number | null
  wiesentyp: string | null
  intensitaet: Intensitaet | null
  base_geometry: string | null
  sort_order: number
  notes: string | null
  source: ParcelSource
  category: ParcelCategory
  farm_uid: string | null
  farm_name: string | null
  management_unit: string | null
  external_kultur_id: string | null
  kultur_code: string | null
  kultur_name_de: string | null
  gelan_missing: boolean
  /** auch zeigen, wenn «kleine Parzellen ausblenden» an ist und die Fläche unter der Grenze liegt */
  immer_zeigen: boolean
  /** Favorit (Stern im Finder): steht zuoberst; reist mit Cloud und Sicherung (Entscheid E3) */
  favorit: boolean
  imported_at: string | null
  updated_at: string
  deleted_at: string | null
}

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
  animal_category: AnimalCategory | null
  /** nur bei abgeleiteter Weide aus einem Herden-Aufenthalt (nie gespeichert) */
  herde_aufenthalt_id?: string
  day_only: boolean
  animal_count: number | null
  animal_group: string | null
  label: string | null
  value_num: number | null
  yield_amount: number | null
  yield_unit: YieldUnit | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export type FertUnit = 'm3' | 't' | 'kg'
export type ExtentType = 'parcel' | 'parcels' | 'polygon'

export interface FertilizerType {
  id: string
  code: string
  name: string
  unit: FertUnit
  n_kg_per_unit: number
  n_avail_pct: number
  p2o5_kg_per_unit: number
  k2o_kg_per_unit: number
  mg_kg_per_unit: number | null
  dilution_default: number
  container_label: string | null
  container_size: number | null
  sort_order: number
  active: boolean
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export interface FertilizationEntry {
  id: string
  parcel_id: string | null
  entry_date: string
  fertilizer_type_id: string | null
  code: string
  amount: number | null
  unit: FertUnit
  container_count: number | null
  container_size: number | null
  dilution: string | null
  dilution_factor: number | null
  gabe_number: number | null
  extent_type: ExtentType
  geometry: string | null
  area_a: number | null
  n_kg: number | null
  n_avail_kg: number | null
  p2o5_kg: number | null
  k2o_kg: number | null
  trip_id: string | null
  incomplete: boolean
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

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

/** Laufhof/Auslauf je Tierkategorie und Tag: null = auto (X, wenn die Kategorie an diesem Tag auf einer Weide ist),
 * 'X' Weide von Hand, 'L' Laufhof, '0' kein Auslauf. Bis Schema 1 ein boolean (true → 'L', sonst auto). */
export type LaufhofWert = 'X' | 'L' | '0' | null

export interface DailyFarmLog {
  id: string
  entry_date: string
  laufhof_kuehe: LaufhofWert
  laufhof_rinder: LaufhofWert
  laufhof_kaelber: LaufhofWert
  laufhof_galtkuehe: LaufhofWert
  laufhof_schafe: LaufhofWert
  laufhof_legehennen: LaufhofWert
  wetter_code: string | null
  niederschlag_mm: number | null
  mond_phase: string | null
  animal_counts: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

export type AusnahmeGrund = 'einzeltier' | 'krankheit' | 'geburt' | 'eingriff' | 'transport' | 'witterung' | 'behoerde' | 'andere'

/** Ausnahme vom Auslauf (z.B. Einzeltier krank, Vogelgrippe-Stallpflicht), für eine Tierkategorie und einen Zeitraum. */
export interface AuslaufAusnahme {
  id: string
  kategorie: AnimalCategory
  grund: AusnahmeGrund
  freitext: string | null
  anzahl: number | null
  tier: string | null // Einzeltier: Name oder Ohrmarke
  von: string
  bis: string
  updated_at: string
  deleted_at: string | null
}

/** Herde: Tiere einer Kategorie, die zusammen umziehen (Etappe «Herde zieht um», docs/konzept-herden.md). */
export interface Herde {
  id: string
  name: string
  kategorie: AnimalCategory
  anzahl: number | null
  sort_order: number
  aktiv: boolean
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

/** Aufenthalt einer Herde: Weide (Parzelle) oder Stall (mit Laufhof L oder ohne Auslauf 0), von–bis inklusive, bis leer = offen. */
export interface HerdenAufenthalt {
  id: string
  herde_id: string
  ort: 'weide' | 'stall'
  parcel_id: string | null
  auslauf: 'L' | '0' | null
  tagweide: boolean
  von: string
  bis: string | null
  updated_at: string
  deleted_at: string | null
}

/**
 * Einstellung des Betriebs (seit Schema 4): id = Schlüssel (z.B. «betriebsnummer», «quelle:CH123»), `wert` beliebig. Mit
 * Zeitstempel, damit sie mit der Cloud abgeglichen werden kann. Gerätebezogenes bleibt in `settings` (store.ts GERAET).
 */
export interface Einstellung {
  id: string
  wert: unknown
  updated_at: string
  deleted_at: string | null
}

export type WeedType = 'blacken' | 'disteln' | 'andere'
export type WeedSeverity = 'einzeln' | 'nest' | 'flaechig'

export interface WeedObservation {
  id: string
  season_year: number
  parcel_id: string | null
  observed_at: string
  weed_type: WeedType
  weed_name: string | null
  severity: WeedSeverity | null
  treatment: string | null
  treated_at: string | null
  source: 'karte' | 'gps'
  geometry: string
  accuracy_m: number | null
  photo: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

/** GPS-Punkt: Länge, Breite, Zeit (ms), Genauigkeit (m) */
export type TrackPoint = [number, number, number, number | null]

export interface Gap {
  from: number
  to: number
  /** hintergrund = App war nicht sichtbar · keine_punkte = GPS lieferte nichts
   * · pause = keine Punkte, aber am selben Ort (z.B. Fass füllen) – harmlos */
  reason: 'hintergrund' | 'keine_punkte' | 'pause'
  /** Strecke zwischen dem Punkt vor und nach der Lücke (m) */
  movedM?: number
}

export interface Trip {
  id: string
  source: 'live' | 'gpx'
  label: string | null
  started_at: string
  ended_at: string | null
  points: string
  gaps: string
  file_name: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}
