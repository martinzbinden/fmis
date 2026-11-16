// Vorgaben je Tabelle (entsprechen den Spalten-Defaults des früheren SQL-Schemas) und die Start-Düngerarten.
import type { FertilizerType } from '../types'
import type { Table } from './store'

const base = { updated_at: '', deleted_at: null }

export const DEFAULTS: Record<Table, Record<string, unknown>> = {
  parcels: {
    ...base, season_year: 0, name: '', area_a: null, wiesentyp: null, intensitaet: null, base_geometry: null, sort_order: 0,
    notes: null, source: 'manual', category: 'futter', farm_uid: null, farm_name: null, management_unit: null,
    external_kultur_id: null, kultur_code: null, kultur_name_de: null, gelan_missing: false, imported_at: null,
    immer_zeigen: false, favorit: false, name_import: null,
  },
  usage_entries: {
    ...base, parcel_id: '', entry_date: '', usage_type: 'weide', animal_category: null, day_only: false, animal_count: null,
    animal_group: null, label: null, value_num: null, yield_amount: null, yield_unit: null, notes: null,
  },
  fertilizer_types: {
    ...base, code: '', name: '', unit: 'm3', n_kg_per_unit: 0, n_avail_pct: 0, p2o5_kg_per_unit: 0, k2o_kg_per_unit: 0,
    mg_kg_per_unit: null, dilution_default: 1, container_label: null, container_size: null, sort_order: 0, active: true, notes: null,
  },
  fertilization_entries: {
    ...base, parcel_id: null, entry_date: '', fertilizer_type_id: null, code: '', amount: null, unit: 'm3', container_count: null,
    container_size: null, dilution: null, dilution_factor: null, gabe_number: null, extent_type: 'parcel', geometry: null,
    area_a: null, n_kg: null, n_avail_kg: null, p2o5_kg: null, k2o_kg: null, trip_id: null, incomplete: false, notes: null,
  },
  fertilization_shares: { ...base, entry_id: '', parcel_id: '', area_a: 0, n_kg: null, n_avail_kg: null, p2o5_kg: null, k2o_kg: null },
  daily_farm_log: {
    ...base, entry_date: '', laufhof_kuehe: null, laufhof_rinder: null, laufhof_kaelber: null, laufhof_galtkuehe: null,
    laufhof_schafe: null, laufhof_legehennen: null, wetter_code: null, niederschlag_mm: null, mond_phase: null, animal_counts: null,
    notes: null,
  },
  weed_observations: {
    ...base, season_year: 0, parcel_id: null, observed_at: '', weed_type: 'blacken', weed_name: null, severity: null,
    treatment: null, treated_at: null, source: 'karte', geometry: '', accuracy_m: null, photo: null, notes: null,
  },
  auslauf_ausnahmen: { ...base, kategorie: 'kuehe', grund: 'andere', freitext: null, anzahl: null, tier: null, von: '', bis: '' },
  herden: { ...base, name: '', kategorie: 'kuehe', anzahl: null, sort_order: 0, aktiv: true, notes: null },
  herden_aufenthalte: { ...base, herde_id: '', ort: 'weide', parcel_id: null, auslauf: null, tagweide: false, von: '', bis: null },
  einstellungen: { ...base, wert: null },
  trips: { ...base, source: 'live', label: null, started_at: '', ended_at: null, points: '[]', gaps: '[]', file_name: null, notes: null },
}

type Seed = Pick<FertilizerType, 'id' | 'code' | 'name' | 'unit' | 'n_kg_per_unit' | 'n_avail_pct' | 'p2o5_kg_per_unit' | 'k2o_kg_per_unit' | 'mg_kg_per_unit' | 'dilution_default' | 'container_label' | 'container_size' | 'sort_order' | 'notes'>

const f = (n: number, code: string, name: string, unit: 'm3' | 't' | 'kg', N: number, avail: number, P: number, K: number, Mg: number, dil: number, cl: string | null, cs: number | null, notes: string): Seed => ({
  id: `70000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`, code, name, unit, n_kg_per_unit: N, n_avail_pct: avail,
  p2o5_kg_per_unit: P, k2o_kg_per_unit: K, mg_kg_per_unit: Mg, dilution_default: dil, container_label: cl, container_size: cs,
  sort_order: n * 10, notes,
})

/** Richtwerte ca. GRUD 2017 (wie im FMIS, schema 0010_fertilizer_types.sql), in der App editierbar. */
export const SEED_FERTILIZER_TYPES: Seed[] = [
  f(1, 'RGv', 'Rindergülle verdünnt 1:1', 'm3', 2.3, 60, 0.9, 3.5, 0.4, 0.5, 'Fass', 6.5, 'Richtwert ca. GRUD 2017 (TS ~3.5 %)'),
  f(2, 'RGk', 'Rindergülle unverdünnt (Vollgülle)', 'm3', 4.6, 60, 1.8, 7.0, 0.8, 1.0, 'Fass', 6.5, 'Richtwert ca. GRUD 2017 (TS ~7.5 %)'),
  f(3, 'RMI', 'Rindermist (Stapelmist)', 't', 5.0, 25, 3.0, 9.5, 1.1, 1.0, 'Fuder', null, 'Richtwert ca. GRUD 2017'),
  f(4, 'RMs', 'Rindermist (Laufstall/Tiefstreu)', 't', 5.5, 25, 3.0, 10.0, 1.2, 1.0, 'Fuder', null, 'Richtwert ca. GRUD 2017'),
  f(5, 'SG', 'Schafgülle', 'm3', 3.5, 55, 1.5, 6.0, 0.6, 1.0, 'Fass', 6.5, 'Richtwert ca. GRUD 2017'),
  f(6, 'SM', 'Schafmist', 't', 8.0, 25, 4.0, 13.0, 1.7, 1.0, 'Fuder', null, 'Richtwert ca. GRUD 2017'),
  f(7, 'MK', 'Mistkompost', 't', 7.0, 10, 5.0, 11.0, 3.0, 1.0, 'Fuder', null, 'Richtwert ca. GRUD 2017 (TS ~50 %)'),
  f(8, 'H', 'Hühnermist / Legehennenkot', 't', 15.0, 50, 11.0, 8.0, 3.0, 1.0, null, null, 'Richtwert ca. GRUD 2017 (frisch)'),
  f(9, 'A', 'Ammonsalpeter 27 %', 'kg', 0.27, 100, 0, 0, 0, 1.0, null, null, 'Handelsdünger'),
  f(10, 'V', 'NPK 15-15-15', 'kg', 0.15, 100, 0.15, 0.15, 0, 1.0, null, null, 'Handelsdünger'),
  f(11, 'K', 'Kalk', 'kg', 0, 0, 0, 0, 0, 1.0, null, null, 'nur Kalkung, kein N'),
]
