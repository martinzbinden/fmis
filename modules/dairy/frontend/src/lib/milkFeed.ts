// Milch gegen Futter bis zur nächsten Geburt — für die Ausmerzung (pages/Culling.tsx) und als Kartenfeld im
// Dashboard (pages/Board.tsx). Grobe, nachvollziehbare Rechnung:
//
//   Tagesmilch heute  = letzte Wägung (Milchwägung: je Melkung × Melkungen pro Tag; Milchprüfung: schon Tagesmilch),
//                       seit der Wägung mit dem monatlichen Rückgang fortgeschrieben
//   korrigiert        = Tagesmilch + Milch, die die saugenden Lämmer trinken (lib/lambMilk.ts sucklingMilkByDam;
//                       Lämmer am Eimer zählen nicht). Bis zum Absetzen trinken sie diesen Teil, danach geht er in
//                       den Tank: gerechnet wird mit der korrigierten Menge, abzüglich der Lämmer bis zum Absetzen
//   Milch bis Trocken = Tag für Tag mit Rückgang, bis Trockenstellen vor der Geburt oder unter die Mindestmenge
//   Nächste Geburt    = gemeldete Belegung + Tragzeit; trächtig mit Wochen = Untersuchung + Rest-Tragzeit;
//                       sonst (keine Belegung oder danach leer) Annahme: Belegung in … Tagen + Tragzeit
//   Futter            = Grundfutter je Tag bis zur Geburt + Kraftfutter je kg Milch
//   Bilanz            = Milchgeld − Futter
//
// Rein (ohne Datenbank), damit sich alles testen lässt; die Wägungen lädt loadMilkSamples.

import { useSyncExternalStore } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { GESTATION_DAYS, type Species } from './fertility'
import { addDays, daysBetween } from './format'
import type { PregnancyStatus } from './pregnancy'
import { loadDryAnimalIds } from './dryOff'
import { loadLambs } from './lambs'
import { sucklingMilkByDam, type LambMilkSettings } from './lambMilk'

export interface MilkFeedSettings {
  /** Milchwägung: gewogene Melkung × so viele Melkungen = Tagesmilch */
  milkingsPerDay: number
  /** Milchpreis Fr./kg */
  milkPrice: number
  /** Rückgang der Tagesmilch je Monat (%) */
  declinePerMonth: number
  /** unter dieser Tagesmilch (kg) wird trockengestellt */
  minDailyKg: number
  /** Trockenstellen … Tage vor der Geburt */
  dryDaysBeforeBirth: number
  /** ohne gemeldete Belegung: Annahme Belegung in … Tagen */
  matingInDays: number
  /** Grundfutter: Preis je kg (Fr., z.B. zugekauftes Heu) und Verzehr je Tier und Tag (kg), auch trocken */
  feedPricePerKg: number
  feedKgPerDay: number
  /** Kraftfutter je kg Milch (Fr.) */
  feedPerKgMilk: number
  /** ältere Wägungen gelten nicht mehr (Tage) */
  maxSampleAgeDays: number
  /** Vorschlag Schlachtung: 1 Punkt je … Fr. Verlust (0 = Bilanz zählt nicht) */
  frPerPoint: number
  /** Lämmer unter 6 Monaten fressen diesen Anteil des Grundfutters (Summen im Dashboard) */
  youngFeedShare: number
}

export const DEFAULT_MILK_FEED: Record<Species, MilkFeedSettings> = {
  // Stand 15.11.2026: Schafe nur morgens gemolken (1 Melkung), Milchpreis 2.90 Fr./kg
  sheep: { milkingsPerDay: 1, milkPrice: 2.9, declinePerMonth: 10, minDailyKg: 0.3, dryDaysBeforeBirth: 60, matingInDays: 30, feedPricePerKg: 0.6, feedKgPerDay: 2.5, feedPerKgMilk: 0.25, maxSampleAgeDays: 60, frPerPoint: 100, youngFeedShare: 0.5 },
  cattle: { milkingsPerDay: 2, milkPrice: 0.75, declinePerMonth: 8, minDailyKg: 8, dryDaysBeforeBirth: 56, matingInDays: 45, feedPricePerKg: 0.4, feedKgPerDay: 15, feedPerKgMilk: 0.15, maxSampleAgeDays: 45, frPerPoint: 300, youngFeedShare: 0.3 },
}

/** Letzte Wägung eines Tiers. */
export interface MilkSample {
  date: string
  /** kg wie gewogen */
  kg: number
  /** true = eine Melkung (Milchwägung), false = Tagesmilch (Milchprüfung) */
  perMilking: boolean
}

export interface MilkFeedInput {
  species: Species
  today: string
  sample: MilkSample | null
  /** letzte Geburt (Wägungen davor gehören zur alten Laktation) */
  lastBirth: string | null
  dry: boolean
  /** aus der gemeldeten Belegung (lib/fertility.ts) */
  expectedBirth: string | null
  pregnancy: PregnancyStatus | null
  /** saugende Lämmer: Milch je Tag und Tage bis zum Absetzen (null = keine saugenden Lämmer) */
  lambs?: { perDay: number; weanInDays: number } | null
}

/** Grundfutter je Tier und Tag in Fr. */
export const feedPerDay = (s: Pick<MilkFeedSettings, 'feedPricePerKg' | 'feedKgPerDay'>) => s.feedPricePerKg * s.feedKgPerDay

/** Eine Trächtigkeitsuntersuchung beurteilt eine Belegung frühestens nach so vielen Tagen. */
export const MIN_CHECK_DAYS = 25

export type BirthBasis = 'belegung' | 'untersuchung' | 'annahme'

export interface MilkFeed {
  birth: string
  birthBasis: BirthBasis
  /** Tagesmilch heute (kg, gemolken), null = keine aktuelle Wägung */
  dailyKg: number | null
  /** Milch der saugenden Lämmer heute (kg/Tag), 0 ohne */
  lambKg: number
  /** korrigierte Tagesmilch: gemolken + Lämmer (null ohne Wägung) */
  correctedKg: number | null
  /** letzter Melktag (null = melkt nicht mehr / unbekannt) */
  milkUntil: string | null
  milkDays: number
  milkKg: number
  milkValue: number
  feedDays: number
  feedCost: number
  /** Milchgeld − Futter; null ohne Wägung bei einem melkenden Tier */
  balance: number | null
}

export const BIRTH_BASIS_LABEL: Record<BirthBasis, string> = {
  belegung: 'nach gemeldeter Belegung',
  untersuchung: 'nach Trächtigkeitsuntersuchung',
  annahme: 'Annahme: noch nicht belegt',
}

function nextBirth(i: MilkFeedInput, s: MilkFeedSettings): { birth: string; basis: BirthBasis } {
  const gestation = GESTATION_DAYS[i.species]
  const p = i.pregnancy
  // Belegung gemeldet und nicht nachher leer untersucht
  if (i.expectedBirth) {
    const service = addDays(i.expectedBirth, -gestation)
    // «leer» hebt die Belegung nur auf, wenn die Untersuchung spät genug danach war
    const emptyAfter = p && p.result === 'nein' && daysBetween(service, p.date) >= MIN_CHECK_DAYS
    if (!emptyAfter) return { birth: i.expectedBirth < i.today ? i.today : i.expectedBirth, basis: 'belegung' }
  }
  if (p && p.result === 'ja' && p.weeks != null) {
    const birth = addDays(p.date, Math.max(0, gestation - Math.round(p.weeks * 7)))
    return { birth: birth < i.today ? i.today : birth, basis: 'untersuchung' }
  }
  return { birth: addDays(i.today, s.matingInDays + gestation), basis: 'annahme' }
}

/** Tagesmilch an einem Tag, `days` nach der Wägung, mit monatlichem Rückgang. */
function dailyAt(kg0: number, days: number, s: MilkFeedSettings): number {
  return kg0 * Math.pow(1 - s.declinePerMonth / 100, days / 30)
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Gemolkene (verkaufte) Milch Tag für Tag ab heute bis zum Trockenstellen (`lastDay` exklusiv) oder bis die Menge unter
 * die Grenze fällt. Bis zum Absetzen trinken die Lämmer ihren Teil. */
function soldMilkSeries(total0: number, since: number, lamb: { perDay: number; weanInDays: number } | null, lastDay: number, s: MilkFeedSettings): number[] {
  const out: number[] = []
  for (let d = 0; d < lastDay; d++) {
    const total = dailyAt(total0, since + d, s)
    const drunk = lamb && d < lamb.weanInDays ? lamb.perDay : 0
    // trockenstellen erst, wenn keine Lämmer mehr saugen und die Menge unter die Grenze fällt
    if (!drunk && total < s.minDailyKg) break
    out.push(Math.max(0, total - drunk))
  }
  return out
}

export interface MilkFeedWindow {
  /** gemolkene Milch und ihr Wert in den nächsten `days` Tagen */
  milkKg: number
  milkValue: number
  /** Futter in dieser Zeit: Grundfutter (kg und Fr.) plus Kraftfutter je kg Milch (Fr.) */
  feedKg: number
  feedCost: number
  /** melkendes Tier ohne aktuelle Wägung: Milch nicht bekannt (zählt als 0) */
  milkUnknown: boolean
}

/** Milch und Futter eines Tiers für die nächsten `days` Tage (Summen je Spalte im Dashboard). `young`: Lamm unter
 * 6 Monaten, frisst den Anteil `youngFeedShare` des Grundfutters. Nach der nächsten Geburt rechnet es keine Milch mehr
 * (neue Laktation unbekannt), Futter läuft weiter. */
export function milkFeedWindow(i: MilkFeedInput, s: MilkFeedSettings, days: number, young = false): MilkFeedWindow {
  const { birth } = nextBirth(i, s)
  const dryOff = addDays(birth, -s.dryDaysBeforeBirth)
  const sample = i.sample && (!i.lastBirth || i.sample.date >= i.lastBirth) && daysBetween(i.sample.date, i.today) <= s.maxSampleAgeDays ? i.sample : null
  const kg0 = sample ? sample.kg * (sample.perMilking ? s.milkingsPerDay : 1) : null
  const since = sample ? Math.max(0, daysBetween(sample.date, i.today)) : 0
  const milking = !i.dry && kg0 != null
  const lamb = milking && i.lambs && i.lambs.perDay > 0 ? i.lambs : null
  const series = milking && kg0 != null ? soldMilkSeries(kg0 + (lamb ? lamb.perDay : 0), since, lamb, Math.min(days, daysBetween(i.today, dryOff)), s) : []
  const milkKg = series.reduce((t, kg) => t + kg, 0)
  const feedKg = days * s.feedKgPerDay * (young ? s.youngFeedShare : 1)
  return {
    milkKg: round2(milkKg),
    milkValue: round2(milkKg * s.milkPrice),
    feedKg: round2(feedKg),
    feedCost: round2(feedKg * s.feedPricePerKg + milkKg * s.feedPerKgMilk),
    milkUnknown: !i.dry && kg0 == null && i.lastBirth != null,
  }
}

export function milkFeed(i: MilkFeedInput, s: MilkFeedSettings): MilkFeed {
  const { birth, basis } = nextBirth(i, s)
  const feedDays = Math.max(0, daysBetween(i.today, birth))
  const dryOff = addDays(birth, -s.dryDaysBeforeBirth)

  const sample = i.sample && (!i.lastBirth || i.sample.date >= i.lastBirth) && daysBetween(i.sample.date, i.today) <= s.maxSampleAgeDays ? i.sample : null
  const kg0 = sample ? sample.kg * (sample.perMilking ? s.milkingsPerDay : 1) : null
  const since = sample ? Math.max(0, daysBetween(sample.date, i.today)) : 0

  const milking = !i.dry && kg0 != null
  const lamb = milking && i.lambs && i.lambs.perDay > 0 ? i.lambs : null
  // die Lämmer trinken heute ihren Teil; die Mutter gibt also gemolken + Lämmer
  const total0 = kg0 == null ? null : kg0 + (lamb ? lamb.perDay : 0)
  const series = milking && total0 != null ? soldMilkSeries(total0, since, lamb, daysBetween(i.today, dryOff), s) : []
  const milkDays = series.length
  const milkKg = series.reduce((t, kg) => t + kg, 0)
  const milkUntil = milkDays > 0 ? addDays(i.today, milkDays - 1) : null
  const milkValue = milkKg * s.milkPrice
  const feedCost = feedDays * feedPerDay(s) + milkKg * s.feedPerKgMilk
  const unknown = !i.dry && kg0 == null
  return {
    birth,
    birthBasis: basis,
    dailyKg: kg0 == null || i.dry ? (i.dry ? 0 : null) : round2(dailyAt(kg0, since, s)),
    lambKg: lamb ? round2(lamb.perDay) : 0,
    correctedKg: total0 == null || i.dry ? (i.dry ? 0 : null) : round2(dailyAt(total0, since, s)),
    milkUntil,
    milkDays,
    milkKg: round2(milkKg),
    milkValue: round2(milkValue),
    feedDays,
    feedCost: round2(feedCost),
    balance: unknown ? null : round2(milkValue - feedCost),
  }
}

/** Punkte für den Vorschlag Schlachtung (lib/cullingPlan.ts): Verlust zieht nach oben (bis +3), ein Tier, das
 * deutlich mehr Milch bringt als es frisst, nach unten (bis −2). Ohne Bilanz oder mit 0 Fr./Punkt: 0. */
export const MILK_FEED_POINTS_MAX = 3
export const MILK_FEED_POINTS_MIN = -2
export function milkFeedPoints(balance: number | null, frPerPoint: number): number {
  if (balance == null || !(frPerPoint > 0)) return 0
  const p = Math.round(-balance / frPerPoint)
  return Math.max(MILK_FEED_POINTS_MIN, Math.min(MILK_FEED_POINTS_MAX, p)) || 0
}

/** Kurztext «Milch 85 kg 212 Fr. − Futter 230 Fr. = −18 Fr.» */
export function fmtMilkFeed(m: MilkFeed): string {
  const fr = (v: number) => Math.round(v).toLocaleString('de-CH')
  if (m.balance == null) return `keine aktuelle Wägung · Futter ${fr(m.feedCost)} Fr.`
  return `Milch ${fr(m.milkKg)} kg = ${fr(m.milkValue)} Fr. − Futter ${fr(m.feedCost)} Fr. = ${m.balance >= 0 ? '+' : '−'}${fr(Math.abs(m.balance))} Fr.`
}

/** Letzte Wägung je Tier: Milchwägung (je Melkung; mehrere Plätze am selben Tag gemittelt) oder Milchprüfung
 * (Tagesmilch). Am gleichen Tag gilt die Milchprüfung. */
export async function loadMilkSamples(pg: PGlite): Promise<Map<string, MilkSample>> {
  const { rows } = await pg.query<{ animal_id: string; date: string; kg: number; per_milking: boolean }>(
    `select s.animal_id, b.session_date::text as date, avg(s.milk_kg)::float8 as kg, true as per_milking
       from milking_slots s join milking_banks b on b.id = s.bank_id
      where s.deleted_at is null and b.deleted_at is null and s.animal_id is not null and s.milk_kg > 0
      group by s.animal_id, b.session_date
     union all
     select animal_id, test_date::text, milk_kg::float8, false
       from milk_tests where deleted_at is null and milk_kg > 0`,
  )
  const out = new Map<string, MilkSample>()
  for (const r of rows) {
    const prev = out.get(r.animal_id)
    const better = !prev || r.date > prev.date || (r.date === prev.date && prev.perMilking && !r.per_milking)
    if (better) out.set(r.animal_id, { date: r.date, kg: Number(r.kg), perMilking: r.per_milking })
  }
  return out
}

/** Alles, was die Rechnung aus der Datenbank braucht: letzte Wägungen, trockene Tiere, saugende Lämmer je Mutter. */
export async function loadMilkFeedData(pg: PGlite, today: string, lambSettings: LambMilkSettings) {
  const [samples, dry, lambs] = await Promise.all([loadMilkSamples(pg), loadDryAnimalIds(pg), loadLambs(pg, today)])
  return { samples, dry, suckling: sucklingMilkByDam(lambs, lambSettings) }
}
export type MilkFeedData = Awaited<ReturnType<typeof loadMilkFeedData>>

/** Eingabe der Rechnung für ein Tier aus den geladenen Daten. `weanDay` = Absetzen ab Alter (Stall-Regeln). */
export function milkFeedInputFor(
  d: MilkFeedData,
  a: { id: string; lastBirth: string | null; expectedBirth: string | null; pregnancy: PregnancyStatus | null; dry?: boolean },
  species: Species,
  today: string,
  weanDay: number,
): MilkFeedInput {
  const s = d.suckling.get(a.id)
  return {
    species,
    today,
    sample: d.samples.get(a.id) ?? null,
    lastBirth: a.lastBirth,
    dry: (a.dry ?? false) || d.dry.has(a.id),
    expectedBirth: a.expectedBirth,
    pregnancy: a.pregnancy,
    lambs: s && s.lambs > 0 ? { perDay: s.perDay, weanInDays: Math.max(0, weanDay - (s.youngestAgeDays ?? 0)) } : null,
  }
}

// Einstellungen je Gerät (localStorage), gemeinsam für Ausmerzliste und Dashboard
const listeners = new Set<() => void>()
const cache = new Map<string, MilkFeedSettings>()
const storageKey = (moduleKey: string) => `${moduleKey}_milk_feed_settings`

export function readMilkFeedSettings(moduleKey: string, species: Species): MilkFeedSettings {
  const hit = cache.get(moduleKey)
  if (hit) return hit
  const out = { ...DEFAULT_MILK_FEED[species] }
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(moduleKey)) ?? 'null') as Partial<Record<keyof MilkFeedSettings, unknown>> | null
    if (raw)
      for (const k of Object.keys(out) as (keyof MilkFeedSettings)[]) {
        const v = Number(raw[k])
        if (raw[k] != null && Number.isFinite(v) && v >= 0) out[k] = v
      }
  } catch {
    // Vorgaben
  }
  cache.set(moduleKey, out)
  return out
}

export function saveMilkFeedSettings(moduleKey: string, s: MilkFeedSettings): void {
  cache.set(moduleKey, s)
  try {
    localStorage.setItem(storageKey(moduleKey), JSON.stringify(s))
  } catch {
    // nur bis zum Neuladen
  }
  listeners.forEach((l) => l())
}

export function useMilkFeedSettings(moduleKey: string, species: Species): MilkFeedSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => readMilkFeedSettings(moduleKey, species),
  )
}

/** Felder für die Einstellungen (Ausmerzliste und Dashboard). */
export const MILK_FEED_FIELDS: { key: keyof MilkFeedSettings; label: string; step: number }[] = [
  { key: 'milkPrice', label: 'Milchpreis (Fr./kg)', step: 0.05 },
  { key: 'feedPricePerKg', label: 'Grundfutter Preis (Fr./kg, z.B. Zukauf)', step: 0.05 },
  { key: 'feedKgPerDay', label: 'Grundfutter je Tier und Tag (kg)', step: 0.1 },
  { key: 'feedPerKgMilk', label: 'Kraftfutter je kg Milch (Fr.)', step: 0.05 },
  { key: 'milkingsPerDay', label: 'Milchwägung: Melkungen pro Tag', step: 1 },
  { key: 'declinePerMonth', label: 'Rückgang Milch je Monat (%)', step: 1 },
  { key: 'minDailyKg', label: 'Trockenstellen unter (kg/Tag)', step: 0.1 },
  { key: 'dryDaysBeforeBirth', label: 'Trockenstellen vor Geburt (Tage)', step: 1 },
  { key: 'matingInDays', label: 'Ohne Belegung: Belegung in … Tagen', step: 1 },
  { key: 'maxSampleAgeDays', label: 'Wägung gilt höchstens (Tage)', step: 1 },
  { key: 'frPerPoint', label: 'Vorschlag: 1 Punkt je … Fr. Verlust (0 = aus)', step: 10 },
  { key: 'youngFeedShare', label: 'Jungtiere unter 6 Mt.: Anteil Grundfutter', step: 0.1 },
]
