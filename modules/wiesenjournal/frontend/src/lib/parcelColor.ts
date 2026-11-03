// Einfärben der Parzellen auf der Karte (components/ParcelColorLayer.tsx):
// Kennzahl je Parzelle aus dem Wiesenjournal des Jahres und Klassen für die Farbe.

export type ColorMode = 'kultur' | 'schnitte' | 'weidetage' | 'ruhe'

export const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  kultur: 'Kultur',
  schnitte: 'Schnitte im Jahr',
  weidetage: 'Weidetage im Jahr',
  ruhe: 'Tage seit letzter Nutzung',
}

export const CUT_TYPES = ['eingrasen', 'silage', 'duerrfutter_bel', 'duerrfutter_unbel']

export interface ParcelMetric {
  cuts: number
  grazingDays: number
  /** letzte Nutzung (Schnitt oder Weide), YYYY-MM-DD */
  lastUse: string | null
}

/** Einträge (gespeichert und aus Herden abgeleitet) → Kennzahlen je Parzelle.
 * Ein Weidetag zählt je Parzelle und Datum einmal, auch bei mehreren Tiergruppen. */
export function parcelMetrics(entries: { parcel_id: string; entry_date: string; usage_type: string }[], today: string): Map<string, ParcelMetric> {
  const out = new Map<string, ParcelMetric>()
  const grazing = new Map<string, Set<string>>()
  for (const e of entries) {
    if (e.entry_date > today) continue
    const isCut = CUT_TYPES.includes(e.usage_type)
    const isGraze = e.usage_type === 'weide'
    if (!isCut && !isGraze) continue
    const m = out.get(e.parcel_id) ?? { cuts: 0, grazingDays: 0, lastUse: null }
    if (isCut) m.cuts++
    if (isGraze) grazing.set(e.parcel_id, (grazing.get(e.parcel_id) ?? new Set()).add(e.entry_date))
    if (!m.lastUse || e.entry_date > m.lastUse) m.lastUse = e.entry_date
    out.set(e.parcel_id, m)
  }
  for (const [p, days] of grazing) out.get(p)!.grazingDays = days.size
  return out
}

/** Feste Reihenfolge für Kategorien (Diagramm-Vorgabe); Rest «Übrige» grau. */
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
export const OTHER = '#9ca3af'

/** Kulturen nach Fläche: die grössten bekommen der Reihe nach eine Farbe, der Rest «Übrige». */
export function cultureColors(parcels: { kultur_name_de: string | null; area_a: number | null }[]): { color: Map<string, string>; legend: [string, string][] } {
  const area = new Map<string, number>()
  for (const p of parcels) if (p.kultur_name_de) area.set(p.kultur_name_de, (area.get(p.kultur_name_de) ?? 0) + Number(p.area_a ?? 0) + 1e-6)
  const ranked = [...area.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const color = new Map<string, string>()
  ranked.forEach((k, i) => color.set(k, CATEGORICAL[i] ?? OTHER))
  const legend: [string, string][] = ranked.slice(0, CATEGORICAL.length).map((k, i) => [k, CATEGORICAL[i]])
  if (ranked.length > CATEGORICAL.length) legend.push(['Übrige', OTHER])
  return { color, legend }
}

/** Einfarbige Stufen (hell = wenig, dunkel = viel), wie in der Diagramm-Vorgabe. */
export const RAMP = ['#b7d3f6', '#6da7ec', '#3987e5', '#256abf', '#104281']

/** Klassengrenzen je Kennzahl (untere Grenze je Stufe). */
export const BREAKS: Record<Exclude<ColorMode, 'kultur'>, number[]> = {
  schnitte: [1, 2, 3, 4, 5],
  weidetage: [1, 10, 20, 40, 60],
  ruhe: [0, 14, 28, 42, 60],
}

export function classIndex(value: number, breaks: number[]): number {
  let idx = -1
  breaks.forEach((b, i) => {
    if (value >= b) idx = i
  })
  return idx
}

export function legendLabels(breaks: number[]): string[] {
  return breaks.map((b, i) => (i < breaks.length - 1 ? (breaks[i + 1] - 1 === b ? `${b}` : `${b}–${breaks[i + 1] - 1}`) : `≥ ${b}`))
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000)
