// Masken für Tätigkeiten (Etappe 3, Skizze B2/B3; Entscheid des Betriebs «B mit A und C»): Düngen, Schnitt, Weide, Pflege mit
// den drei Fragen was – wo – wann, mehreren Parzellen auf einmal. Gespeichert wird mit denselben Funktionen wie im Raster
// und im Tagesdialog (saveFertilizationEntry, usage_entries), damit alle Wege gleich rechnen. Jede Speicherung liefert die
// Liste fürs «Rückgängig» (wie die Kürzelleiste).

import type { Store } from '../db/store'
import { addDaysIso, num, todayIso } from './format'
import { saveFertilizationEntry } from './fertilization'
import { tageVonBis, type Erfasst, type Tiere } from './schnell'
import type { FertilizerType, Parcel, UsageType, YieldUnit } from '../types'

export const SCHNITTE: UsageType[] = ['silage', 'duerrfutter_bel', 'duerrfutter_unbel', 'eingrasen']
export const PFLEGE: UsageType[] = ['weide_putzen', 'saeuberungsschnitt', 'blacken_stechen', 'blacken_einzelstock', 'blacken_flaeche', 'uebersaat', 'saat', 'striegeln', 'pflug', 'aufwuchshoehe', 'sonstig']

/** Fläche in Aren (0 ohne Angabe). */
const aren = (p: Pick<Parcel, 'area_a'>) => num(p.area_a) ?? 0
export const summeAren = (ps: Pick<Parcel, 'area_a'>[]) => ps.reduce((a, p) => a + aren(p), 0)

// ---------- Düngen ----------

export interface DuengenEingabe {
  type: FertilizerType
  /** Menge gesamt (m³, t, kg) oder Anzahl × Inhalt (Fass, Streuer) */
  amount: number | null
  container_count: number | null
  container_size: number | null
  dilution: string | null
  parcels: Parcel[]
  datum: string
  notes?: string | null
}

export function mengeGesamt(e: Pick<DuengenEingabe, 'amount' | 'container_count' | 'container_size'>): number | null {
  if (e.amount != null && e.amount > 0) return e.amount
  if (e.container_count != null && e.container_size != null) return Math.round(e.container_count * e.container_size * 1000) / 1000
  return null
}

/** Menge je Hektare über alle gewählten Parzellen (die Gabe wird nach Fläche verteilt). */
export function mengeProHa(e: Pick<DuengenEingabe, 'amount' | 'container_count' | 'container_size' | 'parcels'>): number | null {
  const m = mengeGesamt(e)
  const ha = summeAren(e.parcels) / 100
  return m != null && ha > 0 ? Math.round((m / ha) * 10) / 10 : null
}

/**
 * Eine Gabe auf eine oder mehrere Parzellen: ein Eintrag, nach Fläche verteilt (Anteile wie bei «Mehrere Parzellen» im
 * Tagesdialog). Anker ist die grösste Parzelle.
 */
export function duengenSpeichern(s: Store, e: DuengenEingabe): Erfasst[] {
  if (!e.parcels.length) return []
  const anker = [...e.parcels].sort((a, b) => aren(b) - aren(a))[0]
  const id = saveFertilizationEntry(s, {
    id: null,
    anchorParcel: anker,
    entry_date: e.datum,
    season_year: anker.season_year,
    type: e.type,
    amount: e.amount,
    container_count: e.container_count,
    container_size: e.container_size,
    dilution: e.dilution,
    gabe_number: null,
    notes: e.notes ?? null,
    extent_type: e.parcels.length > 1 ? 'parcels' : 'parcel',
    extra_parcels: e.parcels.filter((p) => p.id !== anker.id),
    geometry: null,
  })
  return [{ table: 'fertilization_entries', id }]
}

// ---------- Schnitt ----------

/** Wievielter Schnitt im Jahr wäre ein Schnitt an diesem Datum (frühere Schnitte + 1). */
export function schnittNummer(s: Store, parcelId: string, datum: string): number {
  const jahr = datum.slice(0, 4)
  const tage = new Set(
    s
      .rows('usage_entries')
      .filter((u) => u.parcel_id === parcelId && SCHNITTE.includes(u.usage_type) && u.entry_date.startsWith(jahr) && u.entry_date < datum)
      .map((u) => u.entry_date),
  )
  return tage.size + 1
}

/** Parzellen des letzten Schnitts mit mehreren Parzellen am selben Tag (Vorschlag «wie letztes Mal»). */
export function letzterGemeinsamerSchnitt(s: Store, vor = todayIso()): { datum: string; usage_type: UsageType; parcelIds: string[] } | null {
  const je = new Map<string, { usage_type: UsageType; ids: Set<string> }>()
  for (const u of s.rows('usage_entries')) {
    if (!SCHNITTE.includes(u.usage_type) || u.entry_date > vor || u.entry_date < addDaysIso(vor, -365)) continue
    const k = `${u.entry_date}|${u.usage_type}`
    const e = je.get(k) ?? { usage_type: u.usage_type, ids: new Set<string>() }
    e.ids.add(u.parcel_id)
    je.set(k, e)
  }
  const kandidaten = [...je.entries()].filter(([, e]) => e.ids.size >= 2).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  const [k, e] = kandidaten[0] ?? []
  return k && e ? { datum: k.slice(0, 10), usage_type: e.usage_type, parcelIds: [...e.ids] } : null
}

/** Zuletzt benutzte Ertragseinheit (Vorgabe Rundballen). */
export function letzteEinheit(s: Store): YieldUnit {
  let best: { d: string; u: YieldUnit } | null = null
  for (const u of s.rows('usage_entries')) if (u.yield_unit && (!best || u.entry_date > best.d)) best = { d: u.entry_date, u: u.yield_unit }
  return best?.u ?? 'rb'
}

export interface SchnittEingabe {
  usage_type: UsageType
  zeilen: { parcel: Parcel; ertrag: number | null }[]
  einheit: YieldUnit
  datum: string
  notes?: string | null
}

export function schnittSpeichern(s: Store, e: SchnittEingabe): Erfasst[] {
  const out: Erfasst[] = []
  s.batch(() => {
    for (const z of e.zeilen) {
      const id = crypto.randomUUID()
      s.put('usage_entries', {
        id,
        parcel_id: z.parcel.id,
        entry_date: e.datum,
        usage_type: e.usage_type,
        yield_amount: z.ertrag,
        yield_unit: z.ertrag != null ? e.einheit : null,
        notes: e.notes ?? null,
        day_only: false,
      })
      out.push({ table: 'usage_entries', id })
    }
  })
  return out
}

// ---------- Weide ----------

export interface WeideEingabe {
  parcels: Parcel[]
  von: string
  bis: string
  tiere: Tiere
  tagweide: boolean
}

/** Weide auf mehreren Parzellen über mehrere Tage (je Parzelle und Tag ein Eintrag, wie im Raster). */
export function weideSpeichern(s: Store, e: WeideEingabe): Erfasst[] {
  const out: Erfasst[] = []
  const tage = tageVonBis(e.von, e.bis)
  s.batch(() => {
    for (const p of e.parcels)
      for (const d of tage) {
        const id = crypto.randomUUID()
        s.put('usage_entries', {
          id,
          parcel_id: p.id,
          entry_date: d,
          usage_type: 'weide',
          animal_category: e.tiere.animal_category,
          animal_group: e.tiere.animal_group,
          animal_count: e.tiere.animal_count,
          day_only: e.tagweide,
        })
        out.push({ table: 'usage_entries', id })
      }
  })
  return out
}

// ---------- Pflege ----------

export interface PflegeEingabe {
  usage_type: UsageType
  parcels: Parcel[]
  datum: string
  /** Mittel, Mischung oder «Was?» (Spalte label) */
  label: string | null
  /** Saatmenge kg/ha bzw. Aufwuchshöhe cm (Spalte value_num) */
  wert: number | null
  notes?: string | null
}

export function pflegeSpeichern(s: Store, e: PflegeEingabe): Erfasst[] {
  const out: Erfasst[] = []
  s.batch(() => {
    for (const p of e.parcels) {
      const id = crypto.randomUUID()
      s.put('usage_entries', { id, parcel_id: p.id, entry_date: e.datum, usage_type: e.usage_type, label: e.label, value_num: e.wert, notes: e.notes ?? null, day_only: false })
      out.push({ table: 'usage_entries', id })
    }
  })
  return out
}

// ---------- Offen (auf «Heute») ----------

export interface Offen {
  art: 'ertrag' | 'gabe'
  datum: string
  titel: string
  text: string
  parcelIds: string[]
}

/**
 * Lücken der letzten 60 Tage, an die «Heute» erinnert, statt sie im Dialog zu erzwingen: Schnitte ohne Ertrag (je Tag und
 * Art zusammengefasst) und unvollständige Gaben (z.B. aus einer GPS-Fahrt mit Lücken).
 */
export function offen(s: Store, heute = todayIso(), namen: (id: string) => string = (id) => s.get('parcels', id)?.name ?? '?'): Offen[] {
  const von = addDaysIso(heute, -60)
  const out: Offen[] = []
  const schnitte = new Map<string, string[]>()
  for (const u of s.rows('usage_entries'))
    if (SCHNITTE.includes(u.usage_type) && u.usage_type !== 'eingrasen' && u.yield_amount == null && u.entry_date >= von && u.entry_date <= heute) {
      const k = `${u.entry_date}|${u.usage_type}`
      schnitte.set(k, [...(schnitte.get(k) ?? []), u.parcel_id])
    }
  for (const [k, ids] of schnitte) {
    const [datum, art] = k.split('|')
    out.push({ art: 'ertrag', datum, titel: 'Ertrag fehlt', text: `${ART_TEXT[art] ?? art} vom ${kurzDatum(datum)}: ${ids.map(namen).join(', ')}`, parcelIds: ids })
  }
  for (const f of s.rows('fertilization_entries'))
    if (f.incomplete && f.entry_date >= von && f.entry_date <= heute)
      out.push({ art: 'gabe', datum: f.entry_date, titel: 'Gabe unvollständig', text: `${f.code} vom ${kurzDatum(f.entry_date)}${f.parcel_id ? `: ${namen(f.parcel_id)}` : ''}`, parcelIds: f.parcel_id ? [f.parcel_id] : [] })
  return out.sort((a, b) => (a.datum < b.datum ? 1 : -1))
}

const ART_TEXT: Record<string, string> = { silage: 'Silage', duerrfutter_bel: 'Dürrfutter belüftet', duerrfutter_unbel: 'Dürrfutter unbelüftet' }
const kurzDatum = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`
