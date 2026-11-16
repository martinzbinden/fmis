// FMIS ↔ AGFF-Journal: Zeilen der FMIS-Tabellen (Wiesenjournal, Tiere) als Zeilen des AGFF-Stores und zurück.
// Reine Funktionen (getestet in abbildung.test.ts); die Datenbank-Anbindung steht in persist.ts.
//
// Unterschiede, die hier ausgeglichen werden:
// - parcels: farm_id ↔ farm_uid, source 'fields' ↔ 'gelan'; gelan_missing/management_unit/imported_at gibt es im FMIS nicht
// - fertilization_entries: duengung_code ↔ code, track_id ↔ trip_id; geplante Gaben (is_planned) bleiben draussen
// - usage_entries: geplante Nutzungen (is_planned) bleiben draussen
// - daily_farm_log: Laufhof als Zeichen X/L/0 (ältere Geräte: true/false)
// - einstellungen: im FMIS «journal_einstellungen» mit uuid aus dem Schlüssel und Wert als JSON-Text
// - herden / herden_aufenthalte: abgeleitet aus den Herdengruppen des Moduls Tiere (herd_groups, herd_stays). Dort
//   laufen Stall und Weide nebeneinander; das AGFF-Journal kennt je Tag nur einen Ort. Darum gilt die Weide, der
//   Stall füllt nur die Lücken dazwischen.

import type { AnimalCategory, Herde, HerdenAufenthalt } from '../types'

/** Spalte der FMIS-Tabelle → Feld im AGFF-Store, wo sie anders heisst */
export const UMBENENNEN: Record<string, Record<string, string>> = {
  parcels: { farm_id: 'farm_uid' },
  fertilization_entries: { duengung_code: 'code', track_id: 'trip_id' },
}

/** Tabellen des Wiesenjournals, die 1:1 (bis auf UMBENENNEN) in den Store gehen */
export const WJ_TABELLEN = ['parcels', 'usage_entries', 'fertilizer_types', 'fertilization_entries', 'fertilization_shares', 'daily_farm_log', 'weed_observations', 'auslauf_ausnahmen'] as const
export type WjTabelle = (typeof WJ_TABELLEN)[number]

type Zeile = Record<string, unknown> & { id: string }

export function laufhofZeichen(v: unknown): 'X' | 'L' | '0' | null {
  if (v === 'X' || v === 'L' || v === '0') return v
  if (v === true || v === 'true') return 'L'
  return null
}

/** FMIS-Zeile → AGFF-Zeile (oder null, wenn sie nicht ins Journal gehört, z.B. geplante Gaben). */
export function vonFmis(tabelle: WjTabelle, r: Zeile): Zeile | null {
  if ((tabelle === 'usage_entries' || tabelle === 'fertilization_entries') && r.is_planned === true) return null
  const out: Zeile = { ...r }
  for (const [fmis, agff] of Object.entries(UMBENENNEN[tabelle] ?? {})) {
    out[agff] = r[fmis] ?? null
    delete out[fmis]
  }
  if (tabelle === 'parcels') {
    out.source = r.source === 'fields' ? 'gelan' : r.source
    out.favorit = r.favorit === true
    out.immer_zeigen = r.immer_zeigen === true
  }
  if (tabelle === 'fertilization_entries') out.incomplete = r.incomplete === true
  if (tabelle === 'daily_farm_log') for (const k of Object.keys(r)) if (k.startsWith('laufhof_')) out[k] = laufhofZeichen(r[k])
  return out
}

/** Pflichtspalten mit Vorgabe in der Datenbank (schema/*.sql). Der FMIS-Schreibweg schreibt fehlende Spalten als leer,
 * nicht als Vorgabe; darum hier für neue Zeilen. Bestehende Zeilen bringen ihren Wert aus dem Laden mit. */
export const VORGABEN: Partial<Record<WjTabelle, Record<string, unknown>>> = {
  parcels: { category: 'futter', favorit: false, immer_zeigen: false, sort_order: 0, source: 'manual' },
  usage_entries: { day_only: false, is_planned: false },
  fertilizer_types: { active: true, dilution_default: 1, k2o_kg_per_unit: 0, n_avail_pct: 0, n_kg_per_unit: 0, p2o5_kg_per_unit: 0, sort_order: 0 },
  fertilization_entries: { extent_type: 'parcel', incomplete: false, is_planned: false, unit: 'm3' },
  daily_farm_log: { wetter_quelle: 'manuell' },
  weed_observations: { source: 'manual' },
  auslauf_ausnahmen: { grund: 'andere' },
}

/** AGFF-Zeile → Spalten der FMIS-Tabelle (nur die bekannten; der Schreibweg behält alle übrigen). */
export function nachFmis(tabelle: WjTabelle, r: Zeile, spalten: readonly string[]): Zeile {
  const zurueck: Record<string, string> = {}
  for (const [fmis, agff] of Object.entries(UMBENENNEN[tabelle] ?? {})) zurueck[agff] = fmis
  const out: Zeile = { id: r.id }
  for (const [k, v] of Object.entries(r)) {
    const spalte = zurueck[k] ?? k
    if (spalte === 'id' || spalte === 'updated_at' || !spalten.includes(spalte)) continue
    out[spalte] = v
  }
  for (const [k, v] of Object.entries(VORGABEN[tabelle] ?? {})) if (spalten.includes(k) && out[k] == null && !(k === 'source' && r.source === 'gelan')) out[k] = v
  // «gelan» ist im FMIS 'fields' (aus dem Kulturen-Modul) oder 'excel': den gespeicherten Wert behalten
  if (tabelle === 'parcels' && out.source === 'gelan') delete out.source
  if (tabelle === 'daily_farm_log') for (const k of Object.keys(out)) if (k.startsWith('laufhof_')) out[k] = laufhofZeichen(out[k])
  return out
}

// ---------- Einstellungen ----------

/** uuid aus dem Schlüssel (SHA-1, Form wie uuid v5): zwei Geräte legen dieselbe Zeile an. */
export async function einstellungsId(schluessel: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`fmis-wiesenjournal-einstellung:${schluessel}`)))
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

export function einstellungVonFmis(r: Zeile): Zeile {
  let wert: unknown = null
  try {
    wert = r.wert == null ? null : JSON.parse(String(r.wert))
  } catch {
    wert = null
  }
  return { id: String(r.schluessel), wert, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null }
}

// ---------- Herden aus dem Modul Tiere ----------

export interface TiereDaten {
  groups: { id: string; name: string; species: string; active: boolean; sort_order: number; notes: string | null; updated_at: string; deleted_at: string | null }[]
  stays: { id: string; group_id: string; slot: 'stall' | 'weide'; location_id: string | null; parcel_id: string | null; day_only: boolean; from_date: string; to_date: string | null; updated_at: string; deleted_at: string | null }[]
  locations: { id: string; laufhof: string | null }[]
  /** je Gruppe: Tiere je Journal-Kategorie heute (aus Mitgliedern und Beständen) */
  bestand: Map<string, Map<AnimalCategory, number>>
}

/** Markierung an abgeleiteten Zeilen: woher sie kommen (persist.ts schreibt nur Weide-Aufenthalte zurück) */
export interface Herkunft {
  fmis_slot?: 'stall' | 'weide' | 'weide_ort'
}

const tag = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function herdenVonTiere(t: TiereDaten): Herde[] {
  return t.groups
    .filter((g) => !g.deleted_at)
    .map((g) => {
      const b = t.bestand.get(g.id) ?? new Map()
      let kategorie: AnimalCategory = g.species === 'rinder' ? 'kuehe' : 'schafe'
      let max = 0
      for (const [k, n] of b) if (n > max) [kategorie, max] = [k, n]
      const anzahl = [...b.values()].reduce((s, n) => s + n, 0)
      return { id: g.id, name: g.name, kategorie, anzahl: anzahl || null, sort_order: g.sort_order, aktiv: g.active, notes: g.notes, updated_at: g.updated_at, deleted_at: null }
    })
}

/** Weide-Aufenthalte 1:1, Stall-Aufenthalte nur in den Lücken zwischen den Weiden (je Lücke eine Zeile). */
export function aufenthalteVonTiere(t: TiereDaten): (HerdenAufenthalt & Herkunft)[] {
  const laufhof = new Map(t.locations.map((l) => [l.id, l.laufhof]))
  const out: (HerdenAufenthalt & Herkunft)[] = []
  const stays = t.stays.filter((s) => !s.deleted_at)
  for (const s of stays) {
    if (s.slot !== 'weide') continue
    if (s.parcel_id)
      out.push({ id: s.id, herde_id: s.group_id, ort: 'weide', parcel_id: s.parcel_id, auslauf: null, tagweide: s.day_only, von: s.from_date, bis: s.to_date, updated_at: s.updated_at, deleted_at: null, fmis_slot: 'weide' })
    // Weide an einem Ort (Alp): keine Parzelle des Betriebs, für das Journal wie «nicht auf dem Betrieb»
    else out.push({ id: s.id, herde_id: s.group_id, ort: 'stall', parcel_id: null, auslauf: null, tagweide: false, von: s.from_date, bis: s.to_date, updated_at: s.updated_at, deleted_at: null, fmis_slot: 'weide_ort' })
  }
  for (const s of stays) {
    if (s.slot !== 'stall') continue
    const weiden = stays
      .filter((w) => w.slot === 'weide' && w.group_id === s.group_id)
      .map((w) => [w.from_date, w.to_date] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const lh = s.location_id ? laufhof.get(s.location_id) : null
    const auslauf = lh === 'staendig' ? 'L' : lh === 'keiner' ? '0' : null
    let von: string | null = s.from_date
    let n = 0
    const stuecke: [string, string | null][] = []
    for (const [wv, wb] of weiden) {
      if (von == null) break
      if (s.to_date != null && wv > s.to_date) break
      if (wb != null && wb < von) continue
      if (wv > von) stuecke.push([von, tag(wv, -1)])
      von = wb == null ? null : tag(wb, 1)
    }
    if (von != null && (s.to_date == null || von <= s.to_date)) stuecke.push([von, s.to_date])
    for (const [a, b] of stuecke) {
      out.push({ id: n === 0 ? s.id : `${s.id}~${n}`, herde_id: s.group_id, ort: 'stall', parcel_id: null, auslauf, tagweide: false, von: a, bis: b && s.to_date && b > s.to_date ? s.to_date : b, updated_at: s.updated_at, deleted_at: null, fmis_slot: 'stall' })
      n++
    }
  }
  return out
}

/** Tiere-Kategorie für einen neuen Bestand aus einer Journal-Kategorie */
export const TIERE_KATEGORIE: Partial<Record<AnimalCategory, { species: 'schafe' | 'rinder'; category: string }>> = {
  kuehe: { species: 'rinder', category: 'kuehe' },
  galtkuehe: { species: 'rinder', category: 'galtkuehe' },
  rinder: { species: 'rinder', category: 'rinder' },
  kaelber: { species: 'rinder', category: 'kaelber' },
  schafe: { species: 'schafe', category: 'auen_galt' },
}
