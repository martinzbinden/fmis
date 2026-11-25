// Platzbedarf beim Transport einer Tiergruppe: Mindestfläche je Tier nach Gewicht und die Mindesthöhe des Abteils
// (Widerristhöhe des grössten Tiers + Zuschlag), Tierschutzverordnung (TSchV) Anhang 4, wie im Merkblatt
// Nutztiertransporte (INFORAMA 2018). Für die Planung; massgebend sind die Verordnung und die Ladefläche im
// Fahrzeugausweis.

export type TransportSpecies = 'cattle' | 'sheep'
export type WeightBasis = 'waage' | 'schaetzung' | 'annahme'

export interface TransportAnimal {
  id: string
  species: TransportSpecies
  /** Lebendgewicht, kg; null = unbekannt */
  liveKg: number | null
  basis: WeightBasis
  /** Zuchtwidder (Schafe): eigene Zeile der Tabelle */
  breedingRam?: boolean
}

/** [bis kg (ausschliesslich), m² je Tier, Zuschlag zur Widerristhöhe in cm]; letzte Zeile = darüber */
type Row = [number, number, number]
const CATTLE: Row[] = [
  [80, 0.3, 20],
  [150, 0.4, 25],
  [250, 0.8, 25],
  [350, 1.0, 35],
  [450, 1.2, 35],
  [550, 1.4, 35],
  [700, 1.6, 35],
  [Infinity, 1.8, 35],
]
const SHEEP_UNSHORN: Row[] = [
  [30, 0.2, 20],
  [45, 0.25, 25],
  [60, 0.4, 30],
  [Infinity, 0.5, 30],
]
// geschoren: unter 30 kg nennt die Tabelle nichts, dort gilt die Zeile der ungeschorenen
const SHEEP_SHORN: Row[] = [
  [30, 0.2, 20],
  [45, 0.25, 25],
  [60, 0.33, 30],
  [Infinity, 0.4, 30],
]
/** Auen hochträchtig und Zuchtwidder */
const SHEEP_SPECIAL = { m2: 0.5, add: 30 }

export interface SpaceNeed {
  m2: number
  /** Zuschlag zur Widerristhöhe, cm */
  addCm: number
  /** Gewichtsklasse, z.B. «150–250 kg» */
  band: string
}

function band(rows: Row[], i: number): string {
  const from = i === 0 ? 0 : rows[i - 1][0]
  const to = rows[i][0]
  if (to === Infinity) return `über ${from} kg`
  return i === 0 ? `unter ${to} kg` : `${from}–${to} kg`
}

/** Mindestfläche eines Tiers. Ohne Gewicht: null. `pregnantLate` = Aue hochträchtig. */
export function spaceFor(a: Pick<TransportAnimal, 'species' | 'liveKg' | 'breedingRam'>, opts: { shorn?: boolean; pregnantLate?: boolean } = {}): SpaceNeed | null {
  if (a.species === 'sheep' && (a.breedingRam || opts.pregnantLate)) return { m2: SHEEP_SPECIAL.m2, addCm: SHEEP_SPECIAL.add, band: a.breedingRam ? 'Zuchtwidder' : 'Aue hochträchtig' }
  if (a.liveKg == null || !(a.liveKg > 0)) return null
  const rows = a.species === 'cattle' ? CATTLE : opts.shorn ? SHEEP_SHORN : SHEEP_UNSHORN
  const i = rows.findIndex(([to]) => a.liveKg! < to)
  const [, m2, addCm] = rows[i]
  return { m2, addCm, band: band(rows, i) }
}

export interface TransportSummary {
  animals: number
  /** Tiere mit bekanntem oder geschätztem Gewicht */
  counted: number
  /** Summe der Mindestflächen, m² */
  m2: number
  /** grösster Zuschlag zur Widerristhöhe (cm) */
  addCm: number
  /** Anzahl je Gewichtsklasse, in der Reihenfolge der Tabelle */
  bands: { band: string; m2: number; n: number }[]
  /** Tiere, deren Gewicht nur geschätzt oder angenommen ist */
  estimated: number
  /** Tiere ohne Gewicht (nicht gezählt) */
  unknown: number
}

export function transportSummary(list: TransportAnimal[], opts: { shorn?: boolean; pregnantLate?: ReadonlySet<string> } = {}): TransportSummary {
  const bands = new Map<string, { band: string; m2: number; n: number; order: number }>()
  let m2 = 0
  let addCm = 0
  let counted = 0
  let estimated = 0
  for (const a of list) {
    const s = spaceFor(a, { shorn: opts.shorn, pregnantLate: opts.pregnantLate?.has(a.id) })
    if (!s) continue
    counted++
    if (a.basis !== 'waage' && !a.breedingRam && !opts.pregnantLate?.has(a.id)) estimated++
    m2 += s.m2
    addCm = Math.max(addCm, s.addCm)
    const b = bands.get(s.band) ?? { band: s.band, m2: s.m2, n: 0, order: s.m2 * 1000 + s.addCm }
    b.n++
    bands.set(s.band, b)
  }
  return {
    animals: list.length,
    counted,
    m2: Math.round(m2 * 100) / 100,
    addCm,
    bands: [...bands.values()].sort((x, y) => x.order - y.order).map(({ band: b, m2: m, n }) => ({ band: b, m2: m, n })),
    estimated,
    unknown: list.length - counted,
  }
}

/** Lamm ohne Wägung: Geburt rund 4.5 kg, danach 250 g am Tag (Milchschaf), höchstens 65 kg. Grobe Annahme. */
export function lambKgByAge(ageDays: number): number {
  return Math.round(Math.min(65, 4.5 + 0.25 * Math.max(0, ageDays)))
}

/** Ausgewachsenes Schaf ohne Wägung: über 60 kg (Milchschaf). */
export const SHEEP_ADULT_KG = 70
/** ab diesem Alter zählt ein Schaf ohne Wägung als ausgewachsen */
export const SHEEP_ADULT_DAYS = 365
/** Wägungen gelten so lange (Jungtiere wachsen) */
export const WEIGHT_VALID_DAYS = { young: 45, adult: 365 }
