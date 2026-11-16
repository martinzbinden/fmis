// Druck im Format des AGFF-Wiesenjournals (Etappe 5, E6; Muster aus der AGFF-Anleitung, vom Betrieb am 16.11.2026
// geliefert): A4 quer, drei Monate je Seite, je Parzelle zwei Zeilen (oben Nutzung, unten Düngung), vorne Parzelle/Schlag,
// No, Aren, Wiesentyp/Leitgras/Mischung, Intensität, hinten die Stickstoffdüngung (N verfügbar je ha: geplant, 1.–6. Gabe,
// total), unten Laufhof, Wetter, Niederschlag und Mond. Nur lesend; die Seite selbst ist pages/DruckPage.tsx.

import type { Store } from '../db/store'
import { addDaysIso, ANIMAL_CATEGORY_LETTER, num, USAGE_TYPE_LETTER } from './format'
import { nutzungen, stallAuslauf } from './herden'
import { laufhofKategorien, laufhofZelle, weideKategorien, ausnahmenAm } from './laufhof'
import { kleineAusblenden, kleinStand } from './klein'
import type { AnimalCategory, DailyFarmLog, LaufhofWert, Parcel } from '../types'

/** Drei Monate je Seite wie im Original (März–Mai …); Dezember–Februar für den Winter. */
export const ZEITRAEUME = [
  { key: 'fruehling', text: 'März–Mai', von: '03-01', monate: 3 },
  { key: 'sommer', text: 'Juni–August', von: '06-01', monate: 3 },
  { key: 'herbst', text: 'September–November', von: '09-01', monate: 3 },
  { key: 'winter', text: 'Januar–Februar und Dezember', von: '01-01', monate: 2 },
] as const
export type ZeitraumKey = (typeof ZEITRAEUME)[number]['key']

export const MAX_GABEN = 6

export interface DruckZeile {
  parcel: Parcel
  no: number
  /** obere Zeile: Zeichen je Tag (X Weide Kühe, / Eingrasen, S, DB, DU …) */
  nutzung: Map<string, string>
  /** untere Zeile: Text ab dem Tag («25 RGk», «10t RMs») */
  duengung: Map<string, string>
  /** N verfügbar je ha je Gabe im Jahr, der Reihe nach */
  gaben: number[]
  total: number | null
}

export interface DruckSeite {
  tage: string[]
  zeilen: DruckZeile[]
  laufhof: { kategorie: AnimalCategory; werte: Map<string, string> }[]
  wetter: Map<string, string>
  regen: Map<string, string>
  /** Tage, deren Niederschlag von Hand eingetragen ist (gerade gedruckt; automatische kursiv) */
  regenHand: Set<string>
  /** Summe der Seite in mm (von Hand vor automatisch), null ohne Werte */
  regenSumme: number | null
  mond: Map<string, string>
}

/** Tage einer Seite: drei Monate ab `von` (Winter: Jan–Feb plus Dezember desselben Jahres). */
export function seitenTage(jahr: number, z: ZeitraumKey): string[] {
  const t = ZEITRAEUME.find((x) => x.key === z)!
  const out: string[] = []
  const bereich = (von: string, monate: number) => {
    const m = Number(von.slice(0, 2))
    for (let d = `${jahr}-${von}`; Number(d.slice(5, 7)) < m + monate && d.startsWith(String(jahr)); d = addDaysIso(d, 1)) out.push(d)
  }
  bereich(t.von, t.monate)
  if (z === 'winter') bereich('12-01', 1)
  return out
}

/** Wetter-Freitext → Zeichen des Originals (O = Sonne, / = Regen); sonst der Anfang des Texts. */
export function wetterZeichen(t: string | null | undefined): string {
  if (!t) return ''
  const s = t.toLowerCase()
  if (/sonn|klar|heiter/.test(s)) return 'O'
  if (/regen|schauer|nass/.test(s)) return '/'
  if (/bewölkt|bedeckt|wolk/.test(s)) return '◑'
  if (/schnee/.test(s)) return '*'
  return t.trim().slice(0, 2)
}

/**
 * Mondphase (●  Neumond, ◐ erstes Viertel, ○ Vollmond, ◑ letztes Viertel) am Tag, auf den Tag gerundet; sonst leer.
 * Mittlere synodische Periode ab dem Neumond vom 6.1.2000 18:14 UT; für ein Formular genügt das (Abweichung ≤ 1 Tag).
 */
export function mondPhase(iso: string): string {
  const SYN = 29.530588853
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000
  const tag = Date.parse(`${iso}T12:00:00Z`) / 86400000
  const alter = (((tag - ref) % SYN) + SYN) % SYN
  const marken: [number, string][] = [
    [0, '●'],
    [SYN / 4, '◐'],
    [SYN / 2, '○'],
    [(3 * SYN) / 4, '◑'],
    [SYN, '●'],
  ]
  for (const [w, z] of marken) if (Math.abs(alter - w) < 0.5) return z
  return ''
}

const mengeText = (menge: number | null, unit: string, code: string) => {
  if (menge == null) return code
  const m = menge >= 10 ? Math.round(menge) : Math.round(menge * 10) / 10
  return unit === 't' ? `${m}t ${code}` : `${m} ${code}`
}

/** Eine Druckseite (bzw. die Daten dazu). `regenAuto`: automatisch geholter Niederschlag, ein Eintrag von Hand geht vor. */
export function druckSeite(s: Store, jahr: number, z: ZeitraumKey, regenAuto?: (d: string) => number | null): DruckSeite {
  const tage = seitenTage(jahr, z)
  const von = tage[0]
  const bis = tage[tage.length - 1]
  const alle = s
    .rows('parcels')
    .filter((p) => p.season_year === jahr)
    .sort((a, b) => (a.farm_name ?? '￿').localeCompare(b.farm_name ?? '￿') || ['futter', 'acker', 'andere'].indexOf(a.category) - ['futter', 'acker', 'andere'].indexOf(b.category) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de', { numeric: true }))
  const parcels = kleineAusblenden(alle, kleinStand(s, jahr), false).sichtbar
  const zeilen = new Map<string, DruckZeile>(parcels.map((p, i) => [p.id, { parcel: p, no: i + 1, nutzung: new Map(), duengung: new Map(), gaben: [], total: null }]))

  // Nutzung (obere Zeile)
  const imZeitraum = nutzungen(s, von, bis)
  for (const u of imZeitraum) {
    const zl = zeilen.get(u.parcel_id)
    if (!zl) continue
    const zeichen = u.usage_type === 'weide' ? (u.animal_category ? (ANIMAL_CATEGORY_LETTER[u.animal_category] ?? 'X') : 'X') : u.usage_type === 'eingrasen' ? '/' : (USAGE_TYPE_LETTER[u.usage_type] ?? '•').toUpperCase()
    const alt = zl.nutzung.get(u.entry_date) ?? ''
    if (!alt.includes(zeichen)) zl.nutzung.set(u.entry_date, alt + zeichen)
  }

  // Düngung (untere Zeile) und Gaben im ganzen Jahr (N verfügbar je ha)
  const gaben = new Map(s.rows('fertilization_entries').filter((f) => f.entry_date.startsWith(String(jahr))).map((f) => [f.id, f]))
  const jeParzelle = new Map<string, { datum: string; nHa: number }[]>()
  for (const x of s.rows('fertilization_shares')) {
    const f = gaben.get(x.entry_id)
    const zl = zeilen.get(x.parcel_id)
    if (!f || !zl) continue
    const a = num(x.area_a) ?? 0
    const ha = a / 100
    if (f.entry_date >= von && f.entry_date <= bis) {
      // Menge auf diese Parzelle (Anteil nach Fläche bei mehreren Parzellen)
      const fa = num(f.area_a) ?? a
      const menge = f.amount != null && fa > 0 ? (Number(f.amount) * a) / fa : f.amount != null ? Number(f.amount) : null
      const alt = zl.duengung.get(f.entry_date)
      const text = mengeText(menge, f.unit, f.code)
      if (!alt) zl.duengung.set(f.entry_date, text)
      else if (!alt.split(' + ').includes(text)) zl.duengung.set(f.entry_date, `${alt} + ${text}`)
    }
    if (ha > 0 && x.n_avail_kg != null) {
      const l = jeParzelle.get(x.parcel_id) ?? []
      l.push({ datum: f.entry_date, nHa: Number(x.n_avail_kg) / ha })
      jeParzelle.set(x.parcel_id, l)
    }
  }
  for (const [pid, l] of jeParzelle) {
    const zl = zeilen.get(pid)!
    const sortiert = l.sort((a, b) => (a.datum < b.datum ? -1 : 1)).map((g) => Math.round(g.nHa))
    zl.gaben = sortiert.length > MAX_GABEN ? [...sortiert.slice(0, MAX_GABEN - 1), sortiert.slice(MAX_GABEN - 1).reduce((a, b) => a + b, 0)] : sortiert
    zl.total = sortiert.reduce((a, b) => a + b, 0)
  }

  // Hof-Zeilen
  const logs = new Map(s.rows('daily_farm_log').filter((l) => l.entry_date >= von && l.entry_date <= bis).map((l) => [l.entry_date, l]))
  const weideAm = weideKategorien(imZeitraum)
  const ausnahmen = s.rows('auslauf_ausnahmen').filter((a) => a.bis >= von && a.von <= bis)
  const stall = stallAuslauf(s, von, bis)
  const kategorien = laufhofKategorien(weideAm, [...logs.values()], ausnahmen)
  const laufhof = kategorien.map((k) => {
    const werte = new Map<string, string>()
    for (const d of tage) {
      const zelle = laufhofZelle(logs.get(d)?.[`laufhof_${k}` as keyof DailyFarmLog] as LaufhofWert, !!weideAm.get(d)?.has(k), ausnahmenAm(ausnahmen, d, k), stall.get(d)?.get(k))
      if (zelle.zeichen) werte.set(d, zelle.zeichen)
    }
    return { kategorie: k, werte }
  })
  const wetter = new Map<string, string>()
  const regen = new Map<string, string>()
  const regenHand = new Set<string>()
  let regenSumme: number | null = null
  const mond = new Map<string, string>()
  for (const d of tage) {
    const l = logs.get(d)
    const w = wetterZeichen(l?.wetter_code)
    if (w) wetter.set(d, w)
    const hand = l?.niederschlag_mm != null
    const mm = hand ? Number(l!.niederschlag_mm) : (regenAuto?.(d) ?? null)
    // ganze mm wie im Original (passt in die schmalen Tageszellen); unter 0.5 mm leer
    if (mm != null && Math.round(mm) > 0) regen.set(d, String(Math.round(mm)))
    if (mm != null) regenSumme = (regenSumme ?? 0) + mm
    if (hand) regenHand.add(d)
    const m = (l as unknown as { mond_phase?: string | null })?.mond_phase || mondPhase(d)
    if (m) mond.set(d, m)
  }
  return { tage, zeilen: [...zeilen.values()], laufhof, wetter, regen, regenHand, regenSumme: regenSumme == null ? null : Math.round(regenSumme), mond }
}
