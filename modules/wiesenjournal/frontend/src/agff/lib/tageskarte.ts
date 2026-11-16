// Tageskarte (Etappe «Tageskarte wie gestern», Vorgabe des Betriebs 12.11.2026): eine Seite je Tag mit Laufhof oben und
// Vorschlägen zum Abhaken – was gestern lief, was fällig sein könnte, Parzellen in der Nähe (nur mit Standortfreigabe).
// Abhaken speichert sofort (wie die Kürzel im Raster), «Rückgängig» im Toast.

import type { Store } from '../db/store'
import { addDaysIso, ANIMAL_CATEGORY_LABEL } from './format'
import { laufhofSetzen } from './laufhof'
import { KUERZEL, schnellErfassen, type Erfasst, type Kuerzel, type Tiere } from './schnell'
import { pointInMulti, toLv, type LvMulti } from './geo'
import { nutzungen } from './herden'
import { wgs84ToLv95 } from './lv95'
import type { AnimalCategory, DailyFarmLog, LaufhofWert, Parcel, UsageEntry, UsageType } from '../types'

/** Ruhezeit, nach der eine Weide wieder beweidet werden kann (Tage) */
export const RUHE_WEIDE = 21
/** Aufwuchsdauer, nach der ein Schnitt fällig sein könnte (Tage) */
export const AUFWUCHS_SCHNITT = 35
/** Umkreis für «In der Nähe» (m) */
export const NAEHE_M = 300

const SCHNITT: UsageType[] = ['eingrasen', 'silage', 'duerrfutter_bel', 'duerrfutter_unbel']

const tage = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
const kuerzelFuer = (t: UsageType): Kuerzel | null => KUERZEL.find((k) => k.art.art === 'nutzung' && k.art.usage_type === t) ?? null

export interface GesternVorschlag {
  key: string
  parcel: Parcel
  kuerzel: Kuerzel
  tiere: Tiere | null
  text: string
}

function tiereVon(u: UsageEntry): Tiere | null {
  return u.usage_type === 'weide' && u.animal_category ? { animal_category: u.animal_category, animal_group: u.animal_group, animal_count: u.animal_count } : null
}

export function tiereKurz(t: Tiere | null): string {
  if (!t) return ''
  return [ANIMAL_CATEGORY_LABEL[t.animal_category], t.animal_group, t.animal_count ? `${t.animal_count}` : null].filter(Boolean).join(' · ')
}

/** Nutzungen von gestern, die heute (noch) fehlen: Weide, Eingrasen, Schnitt, Pflege. */
export function wieGestern(s: Store, datum: string, parcels: Parcel[]): GesternVorschlag[] {
  const gestern = addDaysIso(datum, -1)
  const byId = new Map(parcels.map((p) => [p.id, p]))
  // auch Weide aus Herden: was eine Herde heute belegt, nicht nochmals vorschlagen
  const heute = new Set(nutzungen(s, datum, datum).map((u) => `${u.parcel_id}|${u.usage_type}|${u.animal_category ?? ''}`))
  const out: GesternVorschlag[] = []
  const seen = new Set<string>()
  for (const u of s.rows('usage_entries')) {
    if (u.entry_date !== gestern) continue
    const p = byId.get(u.parcel_id)
    const k = kuerzelFuer(u.usage_type)
    if (!p || !k) continue
    const key = `${u.parcel_id}|${u.usage_type}|${u.animal_category ?? ''}`
    if (heute.has(key) || seen.has(key)) continue
    seen.add(key)
    const tiere = tiereVon(u)
    out.push({ key, parcel: p, kuerzel: k, tiere, text: tiere ? `Weide ${tiereKurz(tiere)}` : k.titel })
  }
  return out.sort((a, b) => a.parcel.sort_order - b.parcel.sort_order || a.parcel.name.localeCompare(b.parcel.name, 'de'))
}

/** Laufhof-Werte von gestern, die heute noch auf auto stehen (nur von Hand gesetzte L/0/X). */
export function laufhofGestern(s: Store, datum: string, kategorien: readonly AnimalCategory[]): { kategorie: AnimalCategory; wert: LaufhofWert }[] {
  const logs = s.rows('daily_farm_log')
  const g = logs.find((l) => l.entry_date === addDaysIso(datum, -1))
  const h = logs.find((l) => l.entry_date === datum)
  const feld = (k: AnimalCategory) => `laufhof_${k}` as keyof DailyFarmLog
  return kategorien
    .map((k) => ({ kategorie: k, wert: (g?.[feld(k)] ?? null) as LaufhofWert }))
    .filter((x) => x.wert != null && (h?.[feld(x.kategorie)] ?? null) == null)
}

/** Alle Vorschläge von gestern auf einmal übernehmen (Nutzungen und von Hand gesetzter Laufhof). */
export function allesWieGestern(s: Store, datum: string, parcels: Parcel[], kategorien: readonly AnimalCategory[]): { erfasst: Erfasst[]; laufhof: { kategorie: AnimalCategory; vorher: LaufhofWert }[] } {
  const erfasst: Erfasst[] = []
  const laufhof: { kategorie: AnimalCategory; vorher: LaufhofWert }[] = []
  s.batch(() => {
    for (const v of wieGestern(s, datum, parcels)) erfasst.push(...schnellErfassen(s, v.parcel, [datum], v.kuerzel, { tiere: v.tiere }))
    for (const l of laufhofGestern(s, datum, kategorien)) {
      laufhofSetzen(s, datum, l.kategorie, l.wert)
      laufhof.push({ kategorie: l.kategorie, vorher: null })
    }
  })
  return { erfasst, laufhof }
}

export interface FaelligVorschlag {
  key: string
  parcel: Parcel
  art: 'weide' | 'schnitt'
  tageSeit: number
  text: string
  /** für Weide: Tiere des letzten Weidegangs */
  tiere: Tiere | null
}

/**
 * Könnte fällig sein (nur Futterflächen, April bis Oktober): Weide nach der Ruhezeit wieder möglich, wenn die letzte
 * Nutzung eine Weide war; Schnitt nach der Aufwuchsdauer, wenn die letzte Nutzung ein Schnitt war. Faustwerte, keine
 * Beratung – die App weiss nichts über Wetter und Wüchsigkeit.
 */
export function koennteFaellig(s: Store, datum: string, parcels: Parcel[], max = 8): FaelligVorschlag[] {
  const monat = Number(datum.slice(5, 7))
  if (monat < 4 || monat > 10) return []
  const letzte = new Map<string, UsageEntry>()
  for (const u of nutzungen(s, addDaysIso(datum, -120), datum)) {
    if (u.usage_type !== 'weide' && !SCHNITT.includes(u.usage_type)) continue
    const l = letzte.get(u.parcel_id)
    if (!l || u.entry_date > l.entry_date) letzte.set(u.parcel_id, u)
  }
  const out: FaelligVorschlag[] = []
  for (const p of parcels) {
    if (p.category !== 'futter') continue
    const u = letzte.get(p.id)
    if (!u || u.entry_date === datum) continue
    const n = tage(u.entry_date, datum)
    if (u.usage_type === 'weide' && n >= RUHE_WEIDE)
      out.push({ key: `w|${p.id}`, parcel: p, art: 'weide', tageSeit: n, text: `Weide möglich · letzte Weide vor ${n} Tagen`, tiere: tiereVon(u) })
    else if (SCHNITT.includes(u.usage_type) && n >= AUFWUCHS_SCHNITT)
      out.push({ key: `s|${p.id}`, parcel: p, art: 'schnitt', tageSeit: n, text: `Schnitt? · letzter Schnitt vor ${n} Tagen`, tiere: null })
  }
  return out.sort((a, b) => b.tageSeit - a.tageSeit).slice(0, max)
}

function abstandZuRing(x: number, y: number, ring: [number, number][]): number {
  let best = Infinity
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
  }
  return best
}

/** Abstand in Metern vom Punkt (LV95) zur Parzelle; 0 = drin. */
export function abstandM(x: number, y: number, m: LvMulti): number {
  if (pointInMulti(x, y, m)) return 0
  let best = Infinity
  for (const poly of m) for (const ring of poly) best = Math.min(best, abstandZuRing(x, y, ring as [number, number][]))
  return best
}

/** Parzellen im Umkreis, die nächste zuerst. */
export function inDerNaehe(parcels: Parcel[], lat: number, lng: number, umkreis = NAEHE_M, max = 6): { parcel: Parcel; m: number }[] {
  const [x, y] = wgs84ToLv95([lng, lat])
  const out: { parcel: Parcel; m: number }[] = []
  for (const p of parcels) {
    const g = toLv(p.base_geometry)
    if (!g || g.length === 0) continue
    const m = abstandM(x, y, g)
    if (m <= umkreis) out.push({ parcel: p, m: Math.round(m) })
  }
  return out.sort((a, b) => a.m - b.m).slice(0, max)
}
