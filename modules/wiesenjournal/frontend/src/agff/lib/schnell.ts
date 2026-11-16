// Schnellerfassung im Raster (Etappe «Kürzel in der Zelle», Vorgabe des Betriebs 12.11.2026): ein Tipp auf ein Kürzel speichert
// sofort, für einen oder mehrere Tage, mit Rückgängig. Komplexere Einträge bleiben im Tagesdialog («…»).

import type { Store } from '../db/store'
import { addDaysIso, todayIso } from './format'
import { nutzungen } from './herden'
import { deleteFertilizationEntry, loadFertilizerTypes, saveFertilizationEntry } from './fertilization'
import type { AnimalCategory, FertilizerType, Parcel, UsageType } from '../types'

export type KuerzelArt = { art: 'nutzung'; usage_type: UsageType } | { art: 'duengung'; gruppe: 'guelle' | 'mist' }

export interface Kuerzel {
  key: string
  label: string
  titel: string
  /** Untertitel in der Leiste (passt in eine Taste) */
  kurz: string
  art: KuerzelArt
}

export const KUERZEL: Kuerzel[] = [
  { key: 'X', label: 'X', titel: 'Weide', kurz: 'Weide', art: { art: 'nutzung', usage_type: 'weide' } },
  { key: 'E', label: 'E', titel: 'Eingrasen', kurz: 'Eingrasen', art: { art: 'nutzung', usage_type: 'eingrasen' } },
  { key: 'S', label: 'S', titel: 'Silage', kurz: 'Silage', art: { art: 'nutzung', usage_type: 'silage' } },
  { key: 'Db', label: 'Db', titel: 'Dürrfutter belüftet', kurz: 'belüftet', art: { art: 'nutzung', usage_type: 'duerrfutter_bel' } },
  { key: 'Du', label: 'Du', titel: 'Dürrfutter unbelüftet', kurz: 'unbelüftet', art: { art: 'nutzung', usage_type: 'duerrfutter_unbel' } },
  { key: 'Gü', label: 'Gü', titel: 'Gülle', kurz: 'Gülle', art: { art: 'duengung', gruppe: 'guelle' } },
  { key: 'Mi', label: 'Mi', titel: 'Mist', kurz: 'Mist', art: { art: 'duengung', gruppe: 'mist' } },
  { key: 'P', label: 'P', titel: 'Weide putzen', kurz: 'Pflege', art: { art: 'nutzung', usage_type: 'weide_putzen' } },
]

export const WEIDE_NEU_TAGE = 14

const tageZwischen = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

/** Tiere für einen Weidegang: Kategorie, Gruppe, Anzahl */
export interface Tiere {
  animal_category: AnimalCategory
  animal_group: string | null
  animal_count: number | null
}

/** Letzter Weidegang auf der Parzelle vor dem Datum (oder null). */
export function letzteWeide(s: Store, parcelId: string, datum: string) {
  let best: { entry_date: string; tiere: Tiere } | null = null
  for (const u of nutzungen(s, addDaysIso(datum, -365), addDaysIso(datum, -1))) {
    if (u.parcel_id !== parcelId || u.usage_type !== 'weide' || u.entry_date >= datum || !u.animal_category) continue
    if (!best || u.entry_date > best.entry_date)
      best = { entry_date: u.entry_date, tiere: { animal_category: u.animal_category, animal_group: u.animal_group, animal_count: u.animal_count } }
  }
  return best
}

/** Erster Weidegang seit längerem? Dann fragt die App nach den Tieren (sonst wie beim letzten Mal). */
export function tiereNachfragen(s: Store, parcelId: string, datum: string, nTage = WEIDE_NEU_TAGE): boolean {
  const l = letzteWeide(s, parcelId, datum)
  return !l || tageZwischen(l.entry_date, datum) > nTage
}

/** Zuletzt verwendete Tiergruppen (über alle Parzellen), die neuesten zuerst, ohne Doppelte. */
export function letzteTiere(s: Store, max = 6): Tiere[] {
  const weide = nutzungen(s, addDaysIso(todayIso(), -365), todayIso())
    .filter((u) => u.usage_type === 'weide' && u.animal_category)
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : a.updated_at < b.updated_at ? 1 : -1))
  const out: Tiere[] = []
  const seen = new Set<string>()
  for (const u of weide) {
    const k = `${u.animal_category}|${u.animal_group ?? ''}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ animal_category: u.animal_category!, animal_group: u.animal_group, animal_count: u.animal_count })
    if (out.length >= max) break
  }
  return out
}

export interface LetzteGabe {
  type: FertilizerType
  container_count: number | null
  container_size: number | null
  amount: number | null
  dilution: string | null
  /** Menge je Hektare der letzten Gabe (m³/ha bzw. t/ha); null, wenn die Fläche unbekannt war */
  proHa: number | null
}

/** Zuletzt verwendete Gülle (m³) bzw. Mist (t): Sorte und Menge je Hektare für das Kürzel (Befund U6, Entscheid E4). */
export function letzteGabe(s: Store, gruppe: 'guelle' | 'mist'): LetzteGabe | null {
  const types = new Map(loadFertilizerTypes(s, false).map((t) => [t.id, t]))
  const passt = (t: FertilizerType | undefined) => !!t && (gruppe === 'guelle' ? t.unit === 'm3' : t.unit === 't')
  const e = s
    .rows('fertilization_entries')
    .filter((x) => passt(types.get(x.fertilizer_type_id ?? '')))
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : a.updated_at < b.updated_at ? 1 : -1))[0]
  if (!e) return null
  const count = e.container_count != null ? Number(e.container_count) : null
  const size = e.container_size != null ? Number(e.container_size) : null
  const menge = count != null ? count * (size ?? 0) : e.amount != null ? Number(e.amount) : null
  // Fläche der Gabe: Summe der Anteile (ganze Parzelle, mehrere Parzellen oder Teilfläche)
  const flaecheA = s.rows('fertilization_shares').filter((x) => x.entry_id === e.id).reduce((a, x) => a + (Number(x.area_a) || 0), 0)
  return {
    type: types.get(e.fertilizer_type_id!)!,
    container_count: count,
    container_size: size,
    amount: count != null ? null : e.amount != null ? Number(e.amount) : null,
    dilution: e.dilution,
    proHa: menge != null && menge > 0 && flaecheA > 0 ? menge / (flaecheA / 100) : null,
  }
}

const einheitText = (g: LetzteGabe) => (g.type.unit === 'm3' ? 'm³' : g.type.unit)
const zahl = (v: number) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))

/** Menge für eine Parzelle: je Hektare auf ihre Fläche umgerechnet (m³ auf 0.5, t auf 0.1 gerundet); ohne Fläche wie zuletzt. */
export function gabeFuer(g: LetzteGabe, parcel: Pick<Parcel, 'area_a'>): Pick<LetzteGabe, 'amount' | 'container_count' | 'container_size'> & { umgerechnet: boolean } {
  const ha = parcel.area_a != null ? Number(parcel.area_a) / 100 : 0
  if (g.proHa != null && ha > 0) {
    const schritt = g.type.unit === 'm3' ? 0.5 : 0.1
    const amount = Math.max(schritt, Math.round((g.proHa * ha) / schritt) * schritt)
    return { amount: Math.round(amount * 10) / 10, container_count: null, container_size: null, umgerechnet: true }
  }
  return { amount: g.amount, container_count: g.container_count, container_size: g.container_size, umgerechnet: false }
}

/** «RGv 30 m³/ha» (Knopf) bzw. mit Parzelle «RGv 57 m³ (30 m³/ha)». Ohne bekannte Fläche: Menge wie zuletzt. */
export function gabeText(g: LetzteGabe, parcel?: Pick<Parcel, 'area_a'>): string {
  const e = einheitText(g)
  if (parcel) {
    const m = gabeFuer(g, parcel)
    if (m.umgerechnet) return `${g.type.code} ${zahl(m.amount!)} ${e} (${zahl(g.proHa!)} ${e}/ha)`
  } else if (g.proHa != null) return `${g.type.code} ${zahl(g.proHa)} ${e}/ha`
  return g.container_count != null ? `${g.type.code} ${g.container_count}×${g.container_size ?? ''}` : `${g.type.code} ${g.amount ?? ''} ${e}`.trim()
}

export type Erfasst = { table: 'usage_entries' | 'fertilization_entries'; id: string }

/** Kürzel für eine Parzelle und mehrere Tage speichern; gibt die neuen Zeilen für «Rückgängig» zurück. */
export function schnellErfassen(
  s: Store,
  parcel: Parcel,
  tage: string[],
  k: Kuerzel,
  opts: { tiere?: Tiere | null; gabe?: LetzteGabe | null } = {},
): Erfasst[] {
  const neu: Erfasst[] = []
  s.batch(() => {
    for (const d of tage) {
      if (k.art.art === 'nutzung') {
        const id = crypto.randomUUID()
        const weide = k.art.usage_type === 'weide'
        const t = weide ? (opts.tiere ?? letzteWeide(s, parcel.id, d)?.tiere ?? null) : null
        s.put('usage_entries', {
          id,
          parcel_id: parcel.id,
          entry_date: d,
          usage_type: k.art.usage_type,
          animal_category: t?.animal_category ?? (weide ? 'kuehe' : null),
          animal_group: t?.animal_group ?? null,
          animal_count: t?.animal_count ?? null,
          day_only: false,
        })
        neu.push({ table: 'usage_entries', id })
      } else {
        const g = opts.gabe
        if (!g) continue
        const m = gabeFuer(g, parcel)
        const id = saveFertilizationEntry(s, {
          id: null,
          anchorParcel: parcel,
          entry_date: d,
          season_year: parcel.season_year,
          type: g.type,
          amount: m.amount,
          container_count: m.container_count,
          container_size: m.container_size,
          dilution: g.dilution,
          gabe_number: null,
          notes: null,
          extent_type: 'parcel',
          extra_parcels: [],
          geometry: null,
        })
        neu.push({ table: 'fertilization_entries', id })
      }
    }
  })
  return neu
}

export function rueckgaengig(s: Store, erfasst: Erfasst[]): void {
  s.batch(() => {
    for (const e of erfasst) {
      if (e.table === 'fertilization_entries') deleteFertilizationEntry(s, e.id)
      else s.softDelete('usage_entries', e.id)
    }
  })
}

/** Alle Tage von a bis b (in beliebiger Reihenfolge), aufsteigend. */
export function tageVonBis(a: string, b: string): string[] {
  const [von, bis] = a <= b ? [a, b] : [b, a]
  const out: string[] = []
  for (let d = von; d <= bis && out.length < 400; ) {
    out.push(d)
    const x = new Date(d + 'T00:00:00Z')
    x.setUTCDate(x.getUTCDate() + 1)
    d = x.toISOString().slice(0, 10)
  }
  return out
}
