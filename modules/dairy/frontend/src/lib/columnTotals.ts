// Summen je Spalte im Dashboard (pages/Board.tsx): welche Kennzahlen unten in jeder Gruppe/Merkliste stehen und für
// welchen Zeitraum. Je Gerät gemerkt.

export interface ColumnTotalsSettings {
  /** Schlachtwert aller Tiere (Fleischwert nach Abzügen, nur Schafe) */
  meat: boolean
  /** gemolkene Milch und ihr Wert im Zeitraum */
  milk: boolean
  /** Futterbedarf (kg Grundfutter, Fr. inkl. Kraftfutter) im Zeitraum */
  feed: boolean
  /** Platz beim Transport (m² nach TSchV Anhang 4, lib/transportSpace.ts) */
  transport: boolean
  /** Zeitraum in Tagen */
  days: number
}

export const TOTAL_PERIODS = [
  { days: 1, label: 'pro Tag' },
  { days: 30, label: '30 Tage' },
  { days: 90, label: '3 Monate' },
]

export const DEFAULT_COLUMN_TOTALS: ColumnTotalsSettings = { meat: true, milk: true, feed: true, transport: false, days: 30 }

const key = (moduleKey: string) => `${moduleKey}_board_totals`

export function loadColumnTotals(moduleKey: string): ColumnTotalsSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(key(moduleKey)) ?? 'null') as Partial<ColumnTotalsSettings> | null
    if (!raw) return DEFAULT_COLUMN_TOTALS
    return {
      meat: raw.meat ?? DEFAULT_COLUMN_TOTALS.meat,
      milk: raw.milk ?? DEFAULT_COLUMN_TOTALS.milk,
      feed: raw.feed ?? DEFAULT_COLUMN_TOTALS.feed,
      transport: raw.transport ?? DEFAULT_COLUMN_TOTALS.transport,
      days: TOTAL_PERIODS.some((p) => p.days === raw.days) ? raw.days! : DEFAULT_COLUMN_TOTALS.days,
    }
  } catch {
    return DEFAULT_COLUMN_TOTALS
  }
}

export function saveColumnTotals(moduleKey: string, s: ColumnTotalsSettings): void {
  try {
    localStorage.setItem(key(moduleKey), JSON.stringify(s))
  } catch {
    // nur bis zum Neuladen
  }
}

export const periodLabel = (days: number) => TOTAL_PERIODS.find((p) => p.days === days)?.label ?? `${days} Tage`
