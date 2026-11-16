// Kleine Parzellen in Listen ausblenden (z.B. Extensive Streifen aus dem Import von geodienste.ch). Nur die Anzeige:
// nichts wird gelöscht, die Karte zeigt immer alles. Nie ausgeblendet werden Parzellen mit Einträgen im Jahr, mit einer
// Herde darauf und solche mit «immer zeigen».

import type { Store } from '../db/store'
import type { Parcel } from '../types'

export const KLEIN_KEY = 'klein_ausblenden'
export type KleinEinstellung = { an: boolean; grenze_a: number }
export const KLEIN_VORGABE: KleinEinstellung = { an: false, grenze_a: 10 }

export function kleinEinstellung(s: Store): KleinEinstellung {
  const e = s.getSetting<KleinEinstellung>(KLEIN_KEY, KLEIN_VORGABE)
  const g = Number(e.grenze_a)
  return { an: !!e.an, grenze_a: Number.isFinite(g) && g > 0 ? g : KLEIN_VORGABE.grenze_a }
}

/** Fläche unter der Grenze (ohne Fläche: nie klein). Ausnahmen prüft `kleineAusblenden`. */
export function istKlein(p: Pick<Parcel, 'area_a'>, grenzeA: number): boolean {
  if (p.area_a == null) return false
  const a = Number(p.area_a)
  return Number.isFinite(a) && a < grenzeA
}

/** Parzellen mit Daten im Zeitraum: Nutzung, Düngung (auch Anteile), Unkraut oder ein Herden-Aufenthalt auf der Weide. */
export function parzellenMitDaten(s: Store, von: string, bis: string): Set<string> {
  const ids = new Set<string>()
  for (const u of s.rows('usage_entries')) if (u.entry_date >= von && u.entry_date <= bis) ids.add(u.parcel_id)
  const duengungen = new Set<string>()
  for (const f of s.rows('fertilization_entries'))
    if (f.entry_date >= von && f.entry_date <= bis) {
      duengungen.add(f.id)
      if (f.parcel_id) ids.add(f.parcel_id)
    }
  for (const x of s.rows('fertilization_shares')) if (duengungen.has(x.entry_id)) ids.add(x.parcel_id)
  for (const w of s.rows('weed_observations')) if (w.parcel_id && w.observed_at.slice(0, 10) >= von && w.observed_at.slice(0, 10) <= bis) ids.add(w.parcel_id)
  for (const a of s.rows('herden_aufenthalte')) if (a.ort === 'weide' && a.parcel_id && a.von <= bis && (a.bis == null || a.bis >= von)) ids.add(a.parcel_id)
  return ids
}

/** Daten des Jahres und Einstellung: was eine Liste zum Filtern braucht (in useQuery laden, dann `kleineAusblenden`). */
export function kleinStand(s: Store, jahr: number): { einstellung: KleinEinstellung; behalten: Set<string> } {
  const einstellung = kleinEinstellung(s)
  return { einstellung, behalten: einstellung.an ? parzellenMitDaten(s, `${jahr}-01-01`, `${jahr}-12-31`) : new Set() }
}

export interface KleinErgebnis<T> {
  /** anzuzeigen (bei `zeigen` alle) */
  sichtbar: T[]
  /** ausgeblendete (bei `zeigen` die, die sonst ausgeblendet wären) */
  ausgeblendet: T[]
  grenze_a: number
}

/**
 * Filtert eine Parzellenliste. `behalten`: Parzellen mit Daten (siehe parzellenMitDaten) und weitere, die sichtbar
 * bleiben müssen (z.B. die gewählte). `zeigen`: vorübergehend alle zeigen («· zeigen» im Hinweis).
 */
export function kleineAusblenden<T extends Pick<Parcel, 'id' | 'area_a'> & { immer_zeigen?: boolean | null }>(
  parcels: T[],
  stand: { einstellung: KleinEinstellung; behalten: Set<string> },
  zeigen = false,
  auchBehalten: Iterable<string | null | undefined> = [],
): KleinErgebnis<T> {
  const { an, grenze_a } = stand.einstellung
  if (!an) return { sichtbar: parcels, ausgeblendet: [], grenze_a }
  const extra = new Set(auchBehalten)
  const ausgeblendet: T[] = []
  const sichtbar: T[] = []
  for (const p of parcels) {
    const weg = istKlein(p, grenze_a) && !p.immer_zeigen && !stand.behalten.has(p.id) && !extra.has(p.id)
    if (weg) ausgeblendet.push(p)
    if (!weg || zeigen) sichtbar.push(p)
  }
  return { sichtbar, ausgeblendet, grenze_a }
}

export const grenzeText = (a: number) => `${String(a).replace('.', ',')} a`
