// Jahresübersicht (frontend/src/pages/YearOverview.tsx): jedes Modul liefert für
// ein Jahr Kennzahlen und einfache Balkendiagramme aus seiner Ablage auf dem
// Gerät (ModuleDescriptor.yearSummary). Die Seite kennt keine Moduldetails.

export interface YearFigure {
  label: string
  value: string
  /** kleine Zusatzzeile, z.B. «davon 12 weiblich» */
  detail?: string
}

export interface YearBars {
  title: string
  /** Einheit für Tooltip und Achse, z.B. «ha», «kg N», «Einträge» */
  unit: string
  /** 'months': Januar–Dezember (12 Werte); 'ranking': Kategorien, grösste zuerst */
  kind: 'months' | 'ranking'
  data: { name: string; value: number }[]
}

/** Monatswerte für den Jahresvergleich (frontend/src/components/YearCompare.tsx):
 * gleicher `key` in jedem Jahr. Diagramme mit kind 'months' werden
 * automatisch auch verglichen; hier nur zusätzliche Grössen. */
export interface YearSeries {
  key: string
  title: string
  unit: string
  /** 12 Werte Januar–Dezember; null = kein Wert (z.B. keine Probe im Monat) */
  values: (number | null)[]
  /** false = Mittelwerte (z.B. kg Milch je Tier): nicht aufsummierbar */
  summable: boolean
}

export interface YearSection {
  title: string
  icon: string
  /** Link zur ausführlichen Seite im Modul */
  to?: string
  figures: YearFigure[]
  charts: YearBars[]
  series?: YearSeries[]
  note?: string
}

/** Alle vergleichbaren Monatsreihen eines Abschnitts: eigene `series` und die Monatsdiagramme. */
export function sectionSeries(section: YearSection): YearSeries[] {
  const fromCharts = section.charts
    .filter((c) => c.kind === 'months')
    .map((c): YearSeries => ({ key: c.title, title: c.title, unit: c.unit, values: c.data.map((d) => d.value), summable: true }))
  return [...fromCharts, ...(section.series ?? [])]
}

/** Mittelwert je Monat (null ohne Werte). */
export function averageByMonth(rows: { date: string | null; value: number }[]): (number | null)[] {
  const sum = new Array(12).fill(0) as number[]
  const n = new Array(12).fill(0) as number[]
  for (const r of rows) {
    const m = r.date ? Number(r.date.slice(5, 7)) - 1 : -1
    if (m >= 0 && m < 12) {
      sum[m] += r.value
      n[m]++
    }
  }
  return sum.map((s, i) => (n[i] ? Math.round((s / n[i]) * 10) / 10 : null))
}

export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Zeilen mit Datum (YYYY-MM-DD) → 12 Monatswerte. */
export function byMonth(rows: { date: string | null; value?: number }[]): { name: string; value: number }[] {
  const sums = new Array(12).fill(0) as number[]
  for (const r of rows) {
    const m = r.date ? Number(r.date.slice(5, 7)) - 1 : -1
    if (m >= 0 && m < 12) sums[m] += r.value ?? 1
  }
  return MONTHS.map((name, i) => ({ name, value: Math.round(sums[i] * 10) / 10 }))
}

/** Grösste zuerst; ab `top` Einträgen der Rest als «Übrige». */
export function ranking(map: Map<string, number>, top = 8): { name: string; value: number }[] {
  const sorted = [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, top).map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))
  const rest = sorted.slice(top).reduce((s, [, v]) => s + v, 0)
  return rest > 0 ? [...head, { name: 'Übrige', value: Math.round(rest * 10) / 10 }] : head
}

export const fmtNum = (x: number, digits = 0) => x.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits })
