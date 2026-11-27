// Schlachtungen aller Tiere (schema/0007_slaughter_records.sql) und ihre Auswertungen: Schlachtgewicht nach Alter
// (Lämmer), nach Laktationstagen (Schafe), nach Jahreszeit und Taxation, Lieferungen je Abrechnung. Alter, Geschlecht
// und Ablammungen kommen rein lesend aus den Tierlisten der Module (Muster lib/ownLambs.ts), verknüpft über animal_key.

import type { PGlite } from '@electric-sql/pglite'
import { getSharedDbRaw } from '@fmis/core/db'
import { animalKey } from '@fmis/core/earTag'

export const CATEGORIES = ['Lamm', 'Schaf', 'Kalb', 'Rind', 'Kuh', 'Ziege', 'anderes'] as const
export type Category = (typeof CATEGORIES)[number]

export interface SlaughterRecord {
  id: string
  slaughter_date: string
  ear_tag: string | null
  animal_key: string | null
  category: string
  carcass_kg: number | null
  classification: string | null
  price_per_kg: number | null
  amount: number | null
  remark: string | null
  buyer: string | null
  settlement_no: string | null
  weigh_slip_no: string | null
  source: string | null
  notes: string | null
}

/** Was die Tierlisten über ein Tier wissen. */
export interface AnimalInfo {
  birth_date: string | null
  sex: 'w' | 'm' | null
  /** Ablammungen/Abkalbungen (aufsteigend), für die Laktationstage am Schlachttag */
  births: string[]
}

export interface Stats {
  n: number
  /** mit Schlachtgewicht */
  withKg: number
  meanKg: number | null
  minKg: number | null
  maxKg: number | null
  meanPrice: number | null
  amount: number
}

const DAY = 86_400_000
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)
const round1 = (v: number) => Math.round(v * 10) / 10

export function stats(rows: SlaughterRecord[]): Stats {
  const kg = rows.map((r) => r.carcass_kg).filter((v): v is number => v != null)
  const price = rows.map((r) => r.price_per_kg).filter((v): v is number => v != null)
  return {
    n: rows.length,
    withKg: kg.length,
    meanKg: kg.length ? round1(kg.reduce((s, v) => s + v, 0) / kg.length) : null,
    minKg: kg.length ? Math.min(...kg) : null,
    maxKg: kg.length ? Math.max(...kg) : null,
    meanPrice: price.length ? Math.round((price.reduce((s, v) => s + v, 0) / price.length) * 100) / 100 : null,
    amount: Math.round(rows.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100,
  }
}

export interface Group {
  key: string
  label: string
  stats: Stats
}

function groupBy(rows: SlaughterRecord[], keyOf: (r: SlaughterRecord) => { key: string; label: string } | null, order?: string[]): Group[] {
  const m = new Map<string, { label: string; rows: SlaughterRecord[] }>()
  for (const r of rows) {
    const k = keyOf(r)
    if (!k) continue
    const g = m.get(k.key) ?? { label: k.label, rows: [] }
    g.rows.push(r)
    m.set(k.key, g)
  }
  const out = [...m.entries()].map(([key, g]) => ({ key, label: g.label, stats: stats(g.rows) }))
  return order ? out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : out.sort((a, b) => a.key.localeCompare(b.key))
}

/** Alter am Schlachttag (Tage), null ohne Geburtsdatum. */
export function ageAt(r: SlaughterRecord, info: ReadonlyMap<string, AnimalInfo>): number | null {
  const a = r.animal_key ? info.get(r.animal_key) : undefined
  return a?.birth_date ? daysBetween(a.birth_date, r.slaughter_date) : null
}

/** Laktationstage am Schlachttag: Tage seit der letzten Geburt davor, null ohne bekannte Geburt. */
export function lactationDaysAt(r: SlaughterRecord, info: ReadonlyMap<string, AnimalInfo>): number | null {
  const a = r.animal_key ? info.get(r.animal_key) : undefined
  const last = a?.births.filter((b) => b <= r.slaughter_date).at(-1)
  return last ? daysBetween(last, r.slaughter_date) : null
}

export const AGE_BANDS = [
  { key: 'a120', label: 'bis 120 Tage', max: 120 },
  { key: 'a150', label: '121–150 Tage', max: 150 },
  { key: 'a210', label: '151–210 Tage', max: 210 },
  { key: 'a420', label: '211–420 Tage', max: 420 },
  { key: 'aelter', label: 'älter', max: Infinity },
]
export const LACTATION_BANDS = [
  { key: 'l60', label: 'bis 60 Laktationstage', max: 60 },
  { key: 'l120', label: '61–120 Tage', max: 120 },
  { key: 'l200', label: '121–200 Tage', max: 200 },
  { key: 'lspaet', label: 'über 200 Tage', max: Infinity },
]

/** Schlachtgewicht nach Alter am Schlachttag (sinnvoll für Lämmer, Kälber); ohne Geburtsdatum «Alter unbekannt». */
export function byAge(rows: SlaughterRecord[], info: ReadonlyMap<string, AnimalInfo>): Group[] {
  return groupBy(
    rows,
    (r) => {
      const age = ageAt(r, info)
      if (age == null) return { key: 'unbekannt', label: 'Alter unbekannt' }
      const b = AGE_BANDS.find((x) => age <= x.max)!
      return { key: b.key, label: b.label }
    },
    [...AGE_BANDS.map((b) => b.key), 'unbekannt'],
  )
}

/** Schlachtgewicht nach Laktationstagen (Schafe, Kühe); ohne bekannte Geburt «keine Ablammung bekannt». */
export function byLactation(rows: SlaughterRecord[], info: ReadonlyMap<string, AnimalInfo>): Group[] {
  return groupBy(
    rows,
    (r) => {
      const d = lactationDaysAt(r, info)
      if (d == null) return { key: 'unbekannt', label: 'keine Geburt bekannt' }
      const b = LACTATION_BANDS.find((x) => d <= x.max)!
      return { key: b.key, label: b.label }
    },
    [...LACTATION_BANDS.map((b) => b.key), 'unbekannt'],
  )
}

const SEASONS = [
  { key: 'q1', label: 'Winter (Jan–Mär)', months: [1, 2, 3] },
  { key: 'q2', label: 'Frühling (Apr–Jun)', months: [4, 5, 6] },
  { key: 'q3', label: 'Sommer (Jul–Sep)', months: [7, 8, 9] },
  { key: 'q4', label: 'Herbst (Okt–Dez)', months: [10, 11, 12] },
]
export function bySeason(rows: SlaughterRecord[]): Group[] {
  return groupBy(
    rows,
    (r) => {
      const s = SEASONS.find((x) => x.months.includes(Number(r.slaughter_date.slice(5, 7))))!
      return { key: s.key, label: s.label }
    },
    SEASONS.map((s) => s.key),
  )
}

export function bySex(rows: SlaughterRecord[], info: ReadonlyMap<string, AnimalInfo>): Group[] {
  return groupBy(rows, (r) => {
    const s = r.animal_key ? info.get(r.animal_key)?.sex : null
    return s === 'w' ? { key: 'w', label: '♀ weiblich' } : s === 'm' ? { key: 'm', label: '♂ männlich' } : { key: 'x', label: 'unbekannt' }
  })
}

/** Nach Taxation (CHTAX, z.B. T2): Gewicht und Preis je Klasse. */
export function byClassification(rows: SlaughterRecord[]): Group[] {
  const groups = groupBy(rows, (r) => (r.classification ? { key: r.classification, label: r.classification } : { key: '', label: 'ohne Taxation' }))
  // ohne Taxation ans Ende
  return [...groups.filter((g) => g.key), ...groups.filter((g) => !g.key)]
}

export interface Delivery {
  key: string
  date: string
  buyer: string | null
  settlement: string | null
  categories: Record<string, number>
  stats: Stats
}

/** Lieferungen: je Schlachtdatum, Abnehmer und Abrechnung. Neueste zuerst. */
export function deliveries(rows: SlaughterRecord[]): Delivery[] {
  const m = new Map<string, SlaughterRecord[]>()
  for (const r of rows) {
    const k = `${r.slaughter_date}|${r.buyer ?? ''}|${r.settlement_no ?? ''}`
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return [...m.entries()]
    .map(([key, list]) => {
      const categories: Record<string, number> = {}
      for (const r of list) categories[r.category] = (categories[r.category] ?? 0) + 1
      return { key, date: list[0].slaughter_date, buyer: list[0].buyer, settlement: list[0].settlement_no, categories, stats: stats(list) }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

export async function loadSlaughterRecords(pg: PGlite): Promise<SlaughterRecord[]> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from slaughter_records where deleted_at is null order by slaughter_date desc, ear_tag')
  return rows.map(toRecord)
}

/** Schlachtungen aus den Abrechnungen zu einer Ohrmarke (über animal_key). */
export async function loadSlaughterRecordsForEarTag(pg: PGlite, earTag: string | null): Promise<SlaughterRecord[]> {
  const key = animalKey(earTag)
  if (!key) return []
  const { rows } = await pg.query<Record<string, unknown>>(
    'select * from slaughter_records where deleted_at is null and animal_key = $1 order by slaughter_date desc',
    [key],
  )
  return rows.map(toRecord)
}

function toRecord(r: Record<string, unknown>): SlaughterRecord {
  return {
    id: String(r.id),
    slaughter_date: iso(r.slaughter_date)!,
    ear_tag: (r.ear_tag as string | null) ?? null,
    animal_key: (r.animal_key as string | null) ?? null,
    category: String(r.category),
    carcass_kg: num(r.carcass_kg),
    classification: (r.classification as string | null) ?? null,
    price_per_kg: num(r.price_per_kg),
    amount: num(r.amount),
    remark: (r.remark as string | null) ?? null,
    buyer: (r.buyer as string | null) ?? null,
    settlement_no: (r.settlement_no as string | null) ?? null,
    weigh_slip_no: (r.weigh_slip_no as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }
}

export interface StillActive {
  animal_id: string
  ear_tag: string
  slaughter_date: string
}

/** Tiere des Mastplaners, die laut Abrechnung geschlachtet, im Mastplaner aber
 * noch «aktiv» sind. Abgleich über animal_key; bei mehreren Abrechnungen zählt
 * die früheste. */
export function stillActiveAnimals(
  records: SlaughterRecord[],
  animals: { id: string; ear_tag: string; status: string }[],
): StillActive[] {
  const firstByKey = new Map<string, string>()
  for (const r of records) {
    if (!r.animal_key) continue
    const prev = firstByKey.get(r.animal_key)
    if (!prev || r.slaughter_date < prev) firstByKey.set(r.animal_key, r.slaughter_date)
  }
  const out: StillActive[] = []
  for (const a of animals) {
    if (a.status !== 'aktiv') continue
    const key = animalKey(a.ear_tag)
    const date = key ? firstByKey.get(key) : undefined
    if (date) out.push({ animal_id: a.id, ear_tag: a.ear_tag, slaughter_date: date })
  }
  return out.sort((x, y) => x.ear_tag.localeCompare(y.ear_tag))
}

/** Geburtsdatum, Geschlecht und Geburten aus allen Tierlisten, die auf diesem Gerät da sind (Mastplaner, Milchschafe,
 * Milchkühe). Fehlt ein Modul hier, fehlen nur seine Angaben. */
export async function loadAnimalInfo(pg: PGlite): Promise<Map<string, AnimalInfo>> {
  const out = new Map<string, AnimalInfo>()
  const put = (tag: string | null, birth: unknown, sex: unknown) => {
    const key = animalKey(tag)
    if (!key) return
    const prev = out.get(key)
    out.set(key, {
      birth_date: prev?.birth_date ?? iso(birth),
      sex: prev?.sex ?? (sex === 'w' || sex === 'm' ? sex : null),
      births: prev?.births ?? [],
    })
  }
  try {
    const { rows } = await pg.query<{ ear_tag: string; birth_date: unknown; sex: unknown }>('select ear_tag, birth_date, sex from animals where deleted_at is null')
    for (const a of rows) put(a.ear_tag, a.birth_date, a.sex)
  } catch {
    // ohne Mastplaner-Tiere
  }
  let shared: PGlite | null = null
  try {
    shared = await getSharedDbRaw()
  } catch {
    return out
  }
  for (const schema of ['dairy_schafe', 'dairy']) {
    try {
      const [animals, births] = await Promise.all([
        shared.query<{ ear_tag: string; birth_date: unknown; sex: unknown }>(`select ear_tag, birth_date, sex from "${schema}"."animals" where deleted_at is null`),
        shared.query<{ ear_tag: string; birth_date: unknown }>(
          `select a.ear_tag, b.birth_date from "${schema}"."births" b join "${schema}"."animals" a on a.id = b.dam_id where b.deleted_at is null order by b.birth_date`,
        ),
      ])
      for (const a of animals.rows) put(a.ear_tag, a.birth_date, a.sex)
      for (const b of births.rows) {
        const key = animalKey(b.ear_tag)
        const info = key ? out.get(key) : undefined
        const d = iso(b.birth_date)
        if (info && d && !info.births.includes(d)) info.births.push(d)
      }
    } catch {
      // Modul auf diesem Gerät nicht vorhanden
    }
  }
  for (const v of out.values()) v.births.sort()
  return out
}
