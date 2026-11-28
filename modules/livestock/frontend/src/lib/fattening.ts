// Mastauswertung der Lämmer aus den Schlachtabrechnungen (slaughter_records): Tageszunahmen, geschätzter Futterverzehr
// in der Mast, Futterverwertung und Deckungsbeitrag je Tier und in Gruppen. Reine Rechnung ohne Datenbank — geladen
// wird in lib/fatteningData.ts, angezeigt auf pages/Fattening.tsx. Einstellungen nur im Browser (localStorage).
//
// Futterteil nach Agroscope, «Fütterungsempfehlungen für Wiederkäuer (Grünes Buch)», Kapitel 11 «Fütterungsempfehlungen
// für das Schaf» (Daccord, Kessler, Arrigo, Frioud, 2017), Tabellen 11.7–11.10: Energiebedarf NEV je Tag nach
// Lebendgewicht (LG) und Tageszunahme (∆LG), TS-Verzehr 4 % des LG (Spalte «Ø TS-Verzehr» der Tabellen).
// Die Tabellen gelten für Stallhaltung; der um 25 % höhere Erhaltungsbedarf auf der Weide ist nicht eingerechnet.

export type LambSex = 'm' | 'w' | 'k' | null
export type GrowthPotential = 'hoch' | 'gering'

/** Stützstellen einer Tabelle: [LG kg, [[∆LG g/Tag, NEV MJ/Tag], …]] */
type NevTable = readonly (readonly [number, readonly (readonly [number, number])[]])[]

/** NEV (MJ/Tag) für Zucht- und Mastlämmer, Grünes Buch Kap. 11 (Agroscope 2017), Tabellen 11.7–11.10. */
export const NEV_TABLES: Record<'m' | 'w', Record<GrowthPotential, NevTable>> = {
  m: {
    // Tabelle 11.7: männlich, geringes Wachstumspotenzial
    gering: [
      [15, [[150, 3.9], [200, 4.0], [250, 4.1], [300, 4.2]]],
      [20, [[150, 5.0], [200, 5.2], [250, 5.4], [300, 5.6]]],
      [25, [[150, 6.0], [200, 6.4], [250, 6.8], [300, 7.2], [350, 7.6]]],
      [30, [[150, 7.0], [200, 7.6], [250, 8.2], [300, 8.7], [350, 9.2], [400, 9.6]]],
      [35, [[200, 8.8], [250, 9.5], [300, 10.1], [350, 10.8], [400, 11.4]]],
    ],
    // Tabelle 11.9: männlich, hohes Wachstumspotenzial
    hoch: [
      [20, [[150, 4.3], [200, 4.6], [250, 4.9], [300, 5.2]]],
      [25, [[150, 5.2], [200, 5.4], [250, 5.6], [300, 5.8], [350, 5.9]]],
      [30, [[150, 6.0], [200, 6.3], [250, 6.6], [300, 6.8], [350, 7.0], [400, 7.2]]],
      [35, [[150, 6.8], [200, 7.2], [250, 7.6], [300, 7.8], [350, 8.0], [400, 8.2], [450, 8.3]]],
      [40, [[200, 8.1], [250, 8.7], [300, 9.1], [350, 9.4], [400, 9.6], [450, 9.8]]],
    ],
  },
  w: {
    // Tabelle 11.8: weiblich, geringes Wachstumspotenzial (Tabelle endet bei 30 kg)
    gering: [
      [15, [[150, 4.7], [200, 4.8], [250, 4.9]]],
      [20, [[150, 5.5], [200, 5.8], [250, 6.1], [300, 6.3]]],
      [25, [[150, 6.4], [200, 6.8], [250, 7.2], [300, 7.6]]],
      [30, [[150, 7.2], [200, 7.8], [250, 8.4], [300, 8.9]]],
    ],
    // Tabelle 11.10: weiblich, hohes Wachstumspotenzial
    hoch: [
      [20, [[150, 5.0], [200, 5.3], [250, 5.5], [300, 5.7]]],
      [25, [[150, 5.7], [200, 5.9], [250, 6.1], [300, 6.3], [350, 6.5]]],
      [30, [[150, 6.3], [200, 6.6], [250, 6.9], [300, 7.2], [350, 7.4]]],
      [35, [[150, 6.9], [200, 7.4], [250, 7.8], [300, 8.1], [350, 8.3], [400, 8.5]]],
      [40, [[200, 8.3], [250, 8.9], [300, 9.4], [350, 9.7], [400, 9.9]]],
    ],
  },
}

/** TS-Verzehr (kg TS/Tag) = 4 % des Lebendgewichts, wie die Spalte «Ø TS-Verzehr» der Tabellen 11.7–11.10. */
export const DM_SHARE_OF_LW = 0.04

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Index der zwei Stützstellen für x: umschliessend, sonst die zwei nächsten am Rand (zum Fortschreiben). */
function pair(xs: readonly number[], x: number): [number, number] {
  if (xs.length < 2) return [0, 0]
  if (x <= xs[0]) return [0, 1]
  if (x >= xs[xs.length - 1]) return [xs.length - 2, xs.length - 1]
  const i = xs.findIndex((v) => v > x)
  return [i - 1, i]
}

function lerp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
}

/** Energiebedarf NEV (MJ/Tag) nach Geschlecht, Wachstumspotenzial, LG (kg) und Zunahme (g/Tag): bilinear
 * interpoliert, ausserhalb der Tabelle linear aus den zwei nächsten Stützstellen fortgeschrieben (Zunahme auf
 * 0–500 g, LG auf 10–50 kg begrenzt, nie negativ). `outside`: LG oder Zunahme liegt ausserhalb der Tabelle. */
export function nevPerDay(sex: LambSex, potential: GrowthPotential, lwKg: number, gainG: number): { nev: number; outside: boolean } {
  const table = NEV_TABLES[sex === 'w' ? 'w' : 'm'][potential]
  const lw = clamp(lwKg, 10, 50)
  const g = clamp(gainG, 0, 500)
  const lws = table.map((b) => b[0])
  let outside = lwKg < lws[0] || lwKg > lws[lws.length - 1] || gainG !== g
  const atBlock = (i: number) => {
    const pts = table[i][1]
    const gs = pts.map((p) => p[0])
    const [a, b] = pair(gs, g)
    return { v: lerp(gs[a], pts[a][1], gs[b], pts[b][1], g), out: g < gs[0] || g > gs[gs.length - 1] }
  }
  const [i, j] = pair(lws, lw)
  const bi = atBlock(i)
  const bj = atBlock(j)
  const t = lws[j] === lws[i] ? 0 : (lw - lws[i]) / (lws[j] - lws[i])
  // Nur Blöcke, die wirklich mitzählen, entscheiden über «ausserhalb»
  if ((t < 1 && bi.out) || (t > 0 && bj.out)) outside = true
  const nev = lerp(lws[i], bi.v, lws[j], bj.v, lw)
  return { nev: Math.max(0, nev), outside }
}

// ---------------------------------------------------------------------------------------------------------------
// Datum als Tageszahl

const DAY = 86_400_000
export const dayNo = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY)
export const isoOfDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string) => dayNo(b) - dayNo(a)

// ---------------------------------------------------------------------------------------------------------------
// Gewichtskurve

export interface WeightPoint {
  date: string
  kg: number
}

export interface Curve {
  /** aufsteigend nach Tag, je Tag ein Punkt */
  points: { day: number; kg: number }[]
}

/** Stückweise lineare Kurve durch die Punkte (gleicher Tag: Mittel). Unplausible Punkte (≤ 0 kg, vor `from`, nach
 * `to`) fallen weg. */
export function buildCurve(points: WeightPoint[], from: string | null, to: string | null): Curve {
  const lo = from ? dayNo(from) : -Infinity
  const hi = to ? dayNo(to) : Infinity
  const byDay = new Map<number, number[]>()
  for (const p of points) {
    if (!p.date || !(p.kg > 0)) continue
    const d = dayNo(p.date)
    if (!Number.isFinite(d) || d < lo || d > hi) continue
    byDay.set(d, [...(byDay.get(d) ?? []), p.kg])
  }
  return {
    points: [...byDay.entries()].map(([day, kgs]) => ({ day, kg: kgs.reduce((s, v) => s + v, 0) / kgs.length })).sort((a, b) => a.day - b.day),
  }
}

/** Gewicht am Tag, null ausserhalb der Kurve (kein Fortschreiben). */
export function weightOn(c: Curve, day: number): number | null {
  const p = c.points
  if (!p.length || day < p[0].day || day > p[p.length - 1].day) return null
  const i = p.findIndex((x) => x.day >= day)
  if (p[i].day === day) return p[i].kg
  return lerp(p[i - 1].day, p[i - 1].kg, p[i].day, p[i].kg, day)
}

/** Zunahme (kg/Tag) des Abschnitts, der am Tag beginnt bzw. ihn enthält; am letzten Punkt der Abschnitt davor. */
export function slopeOn(c: Curve, day: number): number | null {
  const p = c.points
  if (p.length < 2 || day < p[0].day || day > p[p.length - 1].day) return null
  let i = p.findIndex((x) => x.day > day)
  if (i < 0) i = p.length - 1
  return (p[i].kg - p[i - 1].kg) / (p[i].day - p[i - 1].day)
}

// ---------------------------------------------------------------------------------------------------------------
// Einstellungen

export interface FatteningSettings {
  /** Schlachtausbeute in % (SG/LG), wenn am Schlachttag nicht gewogen */
  dressingPct: number
  /** Geburtsgewicht in kg, wenn nicht erfasst */
  birthWeightKg: number
  /** Absetzalter in Tagen, wenn weder Einstallung noch Absetzen bekannt */
  weanAgeDays: number
  growthPotential: GrowthPotential
  /** Wert bei Mastbeginn Fr./kg LG (0 = nicht eingerechnet), wenn kein Kaufpreis */
  startValuePerKg: number
  /** Futterkosten Fr./kg TS, wenn keine erfassten Gruppenkosten */
  feedCostPerKgDm: number
  /** Abzüge je Tier (Waagschein, Abgaben) Fr. */
  feePerAnimal: number
  /** übrige Kosten je Tier Fr. */
  otherCostPerAnimal: number
  /** Arbeitszeit für die Mast in Stunden je Tag, für alle Tiere im Mastplaner zusammen (0 = nicht eingerechnet) */
  labourHoursPerDay: number
}

export const DEFAULT_FATTENING_SETTINGS: FatteningSettings = {
  dressingPct: 46,
  birthWeightKg: 4.5,
  weanAgeDays: 40,
  growthPotential: 'hoch',
  startValuePerKg: 0,
  feedCostPerKgDm: 0.3,
  feePerAnimal: 3.72,
  otherCostPerAnimal: 0,
  labourHoursPerDay: 0,
}

const STORAGE_KEY = 'fmis.livestock.mastauswertung'

/** Gespeicherte Einstellungen mit Vorgaben ergänzt; ungültige Werte fallen auf die Vorgabe zurück. */
export function normalizeSettings(raw: unknown): FatteningSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_FATTENING_SETTINGS
  const n = (k: keyof FatteningSettings, min: number, max: number): number => {
    const v = Number(o[k])
    return o[k] != null && o[k] !== '' && Number.isFinite(v) && v >= min && v <= max ? v : (d[k] as number)
  }
  return {
    dressingPct: n('dressingPct', 20, 80),
    birthWeightKg: n('birthWeightKg', 0.5, 15),
    weanAgeDays: n('weanAgeDays', 0, 365),
    growthPotential: o.growthPotential === 'gering' ? 'gering' : o.growthPotential === 'hoch' ? 'hoch' : d.growthPotential,
    startValuePerKg: n('startValuePerKg', 0, 1000),
    feedCostPerKgDm: n('feedCostPerKgDm', 0, 100),
    feePerAnimal: n('feePerAnimal', 0, 10000),
    otherCostPerAnimal: n('otherCostPerAnimal', 0, 10000),
    labourHoursPerDay: n('labourHoursPerDay', 0, 24),
  }
}

/** Weichen die Einstellungen von den eingebauten Vorgaben ab? (Hinweis «eigene Annahmen aktiv») */
export function settingsDiffer(s: FatteningSettings): boolean {
  const d = DEFAULT_FATTENING_SETTINGS
  return (Object.keys(d) as (keyof FatteningSettings)[]).some((k) => s[k] !== d[k])
}

export function loadFatteningSettings(): FatteningSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_FATTENING_SETTINGS }
  }
}

export function saveFatteningSettings(s: FatteningSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(s)))
  } catch {
    // ohne Speicher (privates Fenster): gilt nur bis zum Neuladen
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Eingabe und Kennzahlen je Lamm

export interface LambInput {
  /** slaughter_records.id */
  id: string
  ear_tag: string | null
  animal_key: string | null
  slaughter_date: string
  carcass_kg: number | null
  classification: string | null
  price_per_kg: number | null
  amount: number | null
  buyer: string | null
  settlement_no: string | null
  birth_date: string | null
  sex: LambSex
  /** erfasstes Geburtsgewicht (Milchschafe birth_offspring) */
  birth_weight_kg: number | null
  /** alle Wägungen (Mastplaner, Milchschafe), ohne Einstallgewicht */
  weights: WeightPoint[]
  /** Mastplaner: Tier-ID, Einstallung, Kaufpreis, erfasste Kosten */
  livestock_id: string | null
  entry_date: string | null
  entry_weight_kg: number | null
  purchase_cost: number | null
  allocated_group_cost: number | null
  medication_cost: number | null
  group_name: string | null
  /** Milchschafe: Absetzen (bzw. von der Mutter weggenommen) */
  wean_date: string | null
  wean_reason: 'abgesetzt' | 'weggenommen' | null
  sire: string | null
  dam: string | null
}

export type StartSource = 'Mastplaner' | 'Absetzen' | 'weggenommen' | 'angenommen'

export interface LambResult {
  input: LambInput
  ageDays: number | null
  /** Lebendgewicht am Schlachttag */
  lwKg: number | null
  lwWeighed: boolean
  /** gemessene Schlachtausbeute in %, nur wenn gewogen */
  dressingMeasuredPct: number | null
  birthWeightKg: number
  birthWeightMeasured: boolean
  /** Lebenstageszunahme g/Tag */
  ltz: number | null
  /** Netto-Tageszunahme (SG je Lebenstag) g/Tag */
  ntz: number | null
  /** Masttageszunahme g/Tag, nur mit gemessenem Gewicht bei Mastbeginn */
  mtz: number | null
  startDate: string | null
  startSource: StartSource | null
  startWeightKg: number | null
  startWeightMeasured: boolean
  fatteningDays: number | null
  /** Zuwachs in der Mast kg */
  gainKg: number | null
  dmKg: number | null
  nevMj: number | null
  /** kg TS je kg Zuwachs */
  fcr: number | null
  mjPerKgGain: number | null
  /** MJ NEV je kg TS */
  energyDensity: number | null
  /** Anteil der Masttage ausserhalb der Tabellen (0–1) */
  outsideShare: number | null
  revenue: number | null
  startValue: number | null
  feedCost: number | null
  feedCostSource: 'erfasst' | 'geschätzt' | null
  medicationCost: number
  fees: number
  otherCost: number
  totalCost: number | null
  margin: number | null
  marginPerDay: number | null
  marginPerKgGain: number | null
  feedCostPerKgGain: number | null
  /** Anteil an der Arbeitszeit der Mast in Stunden (allocateLabour); null = nicht eingerechnet */
  labourHours: number | null
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const r0 = (v: number) => Math.round(v)
const sum = (vs: (number | null)[]): number | null => (vs.some((v) => v == null) ? null : (vs as number[]).reduce((s, v) => s + v, 0))

/** Mastbeginn: Einstallung im Mastplaner → Absetzen (Milchschafe) → Geburt + Absetzalter (angenommen). */
export function fatteningStart(input: Pick<LambInput, 'entry_date' | 'wean_date' | 'wean_reason' | 'birth_date'>, s: Pick<FatteningSettings, 'weanAgeDays'>): { date: string; source: StartSource } | null {
  if (input.entry_date) return { date: input.entry_date, source: 'Mastplaner' }
  if (input.wean_date) return { date: input.wean_date, source: input.wean_reason === 'weggenommen' ? 'weggenommen' : 'Absetzen' }
  if (input.birth_date) return { date: isoOfDay(dayNo(input.birth_date) + Math.round(s.weanAgeDays)), source: 'angenommen' }
  return null
}

export function evaluateLamb(input: LambInput, s: FatteningSettings): LambResult {
  const sd = dayNo(input.slaughter_date)
  const sg = input.carcass_kg != null && input.carcass_kg > 0 ? input.carcass_kg : null
  const birthDay = input.birth_date ? dayNo(input.birth_date) : null
  const age = birthDay != null && sd - birthDay > 0 ? sd - birthDay : null
  const plausible = (p: WeightPoint) => p.kg > 0 && !!p.date && dayNo(p.date) <= sd && (birthDay == null || dayNo(p.date) >= birthDay)
  const weights = input.weights.filter(plausible)
  const entryPoint: WeightPoint | null =
    input.entry_date && input.entry_weight_kg != null && input.entry_weight_kg > 0 ? { date: input.entry_date, kg: input.entry_weight_kg } : null
  const allWeights = entryPoint && plausible(entryPoint) ? [...weights, entryPoint] : weights

  // Lebendgewicht am Schlachttag: jüngste Wägung höchstens 7 Tage davor, sonst SG / Ausbeute
  const nearSlaughter = allWeights.filter((w) => sd - dayNo(w.date) <= 7).sort((a, b) => dayNo(b.date) - dayNo(a.date))[0]
  const lwWeighed = !!nearSlaughter
  const lw = nearSlaughter ? nearSlaughter.kg : sg != null && s.dressingPct > 0 ? sg / (s.dressingPct / 100) : null
  const dressingMeasuredPct = nearSlaughter && sg != null ? r1((sg / nearSlaughter.kg) * 100) : null

  const birthWeightMeasured = input.birth_weight_kg != null && input.birth_weight_kg > 0
  const birthWeight = birthWeightMeasured ? input.birth_weight_kg! : s.birthWeightKg

  const ltz = age != null && lw != null ? r0(((lw - birthWeight) / age) * 1000) : null
  const ntz = age != null && sg != null ? r0((sg / age) * 1000) : null

  // Gewichtskurve: Geburt, Wägungen, Schlachttag
  const curvePoints: WeightPoint[] = [...allWeights]
  if (input.birth_date) curvePoints.push({ date: input.birth_date, kg: birthWeight })
  if (lw != null) curvePoints.push({ date: input.slaughter_date, kg: lw })
  const curve = buildCurve(curvePoints, input.birth_date, input.slaughter_date)

  const start = fatteningStart(input, s)
  const startDay = start ? dayNo(start.date) : null
  const days = startDay != null && sd - startDay > 0 ? sd - startDay : null

  // Gewicht bei Mastbeginn: gemessen (Einstallgewicht oder Wägung ± 7 Tage), sonst aus der Kurve
  let startWeight: number | null = null
  let startWeightMeasured = false
  if (startDay != null && days != null) {
    if (entryPoint && start!.source === 'Mastplaner') {
      startWeight = entryPoint.kg
      startWeightMeasured = true
    } else {
      const near = weights.filter((w) => Math.abs(dayNo(w.date) - startDay) <= 7).sort((a, b) => Math.abs(dayNo(a.date) - startDay) - Math.abs(dayNo(b.date) - startDay))[0]
      if (near) {
        startWeight = near.kg
        startWeightMeasured = true
      } else startWeight = weightOn(curve, startDay)
    }
  }
  const mtz = startWeightMeasured && lw != null && days != null ? r0(((lw - startWeight!) / days) * 1000) : null
  const gain = startWeight != null && lw != null ? lw - startWeight : null

  // Futter je Masttag aufsummiert (Mastbeginn bis Vortag der Schlachtung)
  let dm: number | null = null
  let nev: number | null = null
  let outsideShare: number | null = null
  if (startDay != null && days != null && lw != null) {
    let dmSum = 0
    let nevSum = 0
    let outside = 0
    let ok = true
    for (let d = startDay; d < sd; d++) {
      const w = weightOn(curve, d)
      const slope = slopeOn(curve, d)
      if (w == null || slope == null) {
        ok = false
        break
      }
      dmSum += DM_SHARE_OF_LW * w
      const e = nevPerDay(input.sex, s.growthPotential, w, slope * 1000)
      nevSum += e.nev
      if (e.outside) outside++
    }
    if (ok) {
      dm = dmSum
      nev = nevSum
      outsideShare = outside / days
    }
  }
  const fcr = dm != null && gain != null && gain > 0 ? r2(dm / gain) : null
  const mjPerKgGain = nev != null && gain != null && gain > 0 ? r1(nev / gain) : null
  const energyDensity = dm != null && nev != null && dm > 0 ? r2(nev / dm) : null

  // Deckungsbeitrag
  const revenue = input.amount != null ? input.amount : sg != null && input.price_per_kg != null ? r2(sg * input.price_per_kg) : null
  const startValue =
    input.purchase_cost != null && input.purchase_cost > 0
      ? input.purchase_cost
      : s.startValuePerKg > 0
        ? startWeight != null
          ? r2(startWeight * s.startValuePerKg)
          : null
        : 0
  const recorded = input.livestock_id != null && input.allocated_group_cost != null && input.allocated_group_cost > 0
  const feedCost = recorded ? r2(input.allocated_group_cost!) : s.feedCostPerKgDm > 0 ? (dm != null ? r2(dm * s.feedCostPerKgDm) : null) : 0
  const feedCostSource = recorded ? 'erfasst' : feedCost != null ? 'geschätzt' : null
  const medicationCost = input.livestock_id != null ? (input.medication_cost ?? 0) : 0
  const totalCost = sum([startValue, feedCost, medicationCost, s.feePerAnimal, s.otherCostPerAnimal])
  const margin = revenue != null && totalCost != null ? r2(revenue - totalCost) : null

  return {
    input,
    ageDays: age,
    lwKg: lw != null ? r1(lw) : null,
    lwWeighed,
    dressingMeasuredPct,
    birthWeightKg: birthWeight,
    birthWeightMeasured,
    ltz,
    ntz,
    mtz,
    startDate: start?.date ?? null,
    startSource: start?.source ?? null,
    startWeightKg: startWeight != null ? r1(startWeight) : null,
    startWeightMeasured,
    fatteningDays: days,
    gainKg: gain != null ? r1(gain) : null,
    dmKg: dm != null ? r1(dm) : null,
    nevMj: nev != null ? r0(nev) : null,
    fcr,
    mjPerKgGain,
    energyDensity,
    outsideShare,
    revenue,
    startValue,
    feedCost,
    feedCostSource,
    medicationCost: r2(medicationCost),
    fees: s.feePerAnimal,
    otherCost: s.otherCostPerAnimal,
    totalCost: totalCost != null ? r2(totalCost) : null,
    margin,
    marginPerDay: margin != null && days != null ? r2(margin / days) : null,
    marginPerKgGain: margin != null && gain != null && gain > 0 ? r2(margin / gain) : null,
    feedCostPerKgGain: feedCost != null && gain != null && gain > 0 ? r2(feedCost / gain) : null,
    labourHours: null,
  }
}

/**
 * Arbeitszeit der Mast auf die Tiere verteilen: An jedem Masttag teilen sich die Tiere, die an diesem Tag in der Mast
 * stehen, die Stunden des Tages zu gleichen Teilen. Es zählen nur Tiere aus dem Mastplaner (Einstallung bekannt);
 * Masttage = Mastbeginn bis Vortag der Schlachtung, wie fatteningDays. Tiere ohne Schlachtung kommen in der
 * Auswertung nicht vor und tragen deshalb nichts – ihre Stunden liegen bei den ausgewerteten Tieren.
 */
export function allocateLabour(rows: LambResult[], hoursPerDay: number): LambResult[] {
  if (!(hoursPerDay > 0)) return rows
  const span = (r: LambResult): [number, number] | null =>
    r.input.livestock_id != null && r.startDate && r.fatteningDays != null && r.fatteningDays > 0 ? [dayNo(r.startDate), dayNo(r.input.slaughter_date)] : null
  const present = new Map<number, number>()
  for (const r of rows) {
    const sp = span(r)
    if (sp) for (let d = sp[0]; d < sp[1]; d++) present.set(d, (present.get(d) ?? 0) + 1)
  }
  return rows.map((r) => {
    const sp = span(r)
    if (!sp) return r
    let h = 0
    for (let d = sp[0]; d < sp[1]; d++) h += hoursPerDay / present.get(d)!
    return { ...r, labourHours: r2(h) }
  })
}

/** Ab diesem Anteil Masttage ausserhalb der Tabellen wird ein Tier gekennzeichnet. */
export const OUTSIDE_FLAG_SHARE = 0.2

// ---------------------------------------------------------------------------------------------------------------
// Zusammenfassung und Gruppen

export interface Summary {
  n: number
  /** ohne Geburtsdatum */
  nNoBirth: number
  meanAge: number | null
  meanSg: number | null
  meanLw: number | null
  meanNtz: number | null
  meanLtz: number | null
  meanMtz: number | null
  nMtz: number
  meanDays: number | null
  meanDm: number | null
  sumDm: number | null
  nDm: number
  /** Futterverwertung über alle Tiere: Σ TS / Σ Zuwachs */
  fcr: number | null
  meanMargin: number | null
  nMargin: number
  /** Σ DB / Σ Masttage */
  marginPerDay: number | null
  sumMargin: number | null
  /** Σ Arbeitsstunden der Tiere mit DB und Arbeitsanteil */
  sumLabourHours: number | null
  /** Arbeitsverdienst Fr./h: Σ DB / Σ Arbeitsstunden */
  marginPerHour: number | null
}

const mean = (vs: (number | null)[]): number | null => {
  const ok = vs.filter((v): v is number => v != null)
  return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null
}

/** Mittelwerte nur über vorhandene Werte. */
export function summarize(rows: LambResult[]): Summary {
  const sg = rows.map((r) => (r.input.carcass_kg != null && r.input.carcass_kg > 0 ? r.input.carcass_kg : null))
  const dms = rows.map((r) => r.dmKg).filter((v): v is number => v != null)
  const withFcr = rows.filter((r) => r.dmKg != null && r.gainKg != null && r.gainKg > 0)
  const gainSum = withFcr.reduce((s, r) => s + r.gainKg!, 0)
  const margins = rows.map((r) => r.margin).filter((v): v is number => v != null)
  const withDay = rows.filter((r) => r.margin != null && r.fatteningDays != null)
  const daySum = withDay.reduce((s, r) => s + r.fatteningDays!, 0)
  const withHours = rows.filter((r) => r.margin != null && r.labourHours != null && r.labourHours > 0)
  const hourSum = withHours.reduce((s, r) => s + r.labourHours!, 0)
  const opt = (v: number | null, f: (x: number) => number) => (v == null ? null : f(v))
  return {
    n: rows.length,
    nNoBirth: rows.filter((r) => !r.input.birth_date).length,
    meanAge: opt(mean(rows.map((r) => r.ageDays)), r0),
    meanSg: opt(mean(sg), r1),
    meanLw: opt(mean(rows.map((r) => r.lwKg)), r1),
    meanNtz: opt(mean(rows.map((r) => r.ntz)), r0),
    meanLtz: opt(mean(rows.map((r) => r.ltz)), r0),
    meanMtz: opt(mean(rows.map((r) => r.mtz)), r0),
    nMtz: rows.filter((r) => r.mtz != null).length,
    meanDays: opt(mean(rows.map((r) => r.fatteningDays)), r0),
    meanDm: opt(mean(dms), r1),
    sumDm: dms.length ? r1(dms.reduce((s, v) => s + v, 0)) : null,
    nDm: dms.length,
    fcr: gainSum > 0 ? r2(withFcr.reduce((s, r) => s + r.dmKg!, 0) / gainSum) : null,
    meanMargin: opt(mean(margins), r2),
    nMargin: margins.length,
    marginPerDay: daySum > 0 ? r2(withDay.reduce((s, r) => s + r.margin!, 0) / daySum) : null,
    sumMargin: margins.length ? r2(margins.reduce((s, v) => s + v, 0)) : null,
    sumLabourHours: hourSum > 0 ? r1(hourSum) : null,
    marginPerHour: hourSum > 0 ? r2(withHours.reduce((s, r) => s + r.margin!, 0) / hourSum) : null,
  }
}

export interface FatteningGroup {
  key: string
  label: string
  summary: Summary
}

/** Gruppiert nach `keyOf` (null = Tier fällt weg); mit `order` in dieser Reihenfolge, sonst nach Schlüssel. */
export function groupRows(rows: LambResult[], keyOf: (r: LambResult) => { key: string; label: string } | null, order?: string[]): FatteningGroup[] {
  const m = new Map<string, { label: string; rows: LambResult[] }>()
  for (const r of rows) {
    const k = keyOf(r)
    if (!k) continue
    const g = m.get(k.key) ?? { label: k.label, rows: [] }
    g.rows.push(r)
    m.set(k.key, g)
  }
  const out = [...m.entries()].map(([key, g]) => ({ key, label: g.label, summary: summarize(g.rows) }))
  return order ? out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : out.sort((a, b) => a.key.localeCompare(b.key))
}

/** Lieferung = Schlachtdatum, Abnehmer und Abrechnung (wie lib/slaughterRecords.ts deliveries). */
export const deliveryKey = (r: LambResult) => `${r.input.slaughter_date}|${r.input.buyer ?? ''}|${r.input.settlement_no ?? ''}`

export const sexKey = (sex: LambSex) => (sex === 'w' ? 'w' : sex === 'm' ? 'm' : sex === 'k' ? 'k' : 'x')
export const SEX_LABELS: Record<string, string> = { m: '♂ männlich', w: '♀ weiblich', k: 'Kastrat', x: 'unbekannt' }

/** Gruppen nach Vater, nur Väter mit mindestens `min` Lämmern. */
export function bySire(rows: LambResult[], min = 2): FatteningGroup[] {
  return groupRows(rows, (r) => (r.input.sire ? { key: r.input.sire, label: r.input.sire } : null)).filter((g) => g.summary.n >= min)
}

/** Verteilung der Lebenstageszunahme in Klassen à `width` g/Tag (lückenlos von der kleinsten bis zur grössten Klasse). */
export function histogram(values: (number | null)[], width = 50): { from: number; to: number; n: number }[] {
  const vs = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!vs.length) return []
  const lo = Math.floor(Math.min(...vs) / width)
  const hi = Math.floor(Math.max(...vs) / width)
  const out = []
  for (let c = lo; c <= hi; c++) out.push({ from: c * width, to: (c + 1) * width, n: vs.filter((v) => Math.floor(v / width) === c).length })
  return out
}
