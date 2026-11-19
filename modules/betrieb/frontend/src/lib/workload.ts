// Pensum je Person für die Dienstplanung: Soll-Stunden je Woche aus Anstellung − Schule/ÜK × Vollzeit-Stunden.
// «Grob beachtet»: beim Verteilen kommen zuerst Angestellte, die ihr Soll noch nicht erreicht haben (tiefster Anteil
// zuerst), dann Personen ohne Anstellung (Familie), zuletzt Angestellte über dem Soll.

import type { DutyPerson } from '../types'

export const DEFAULT_FULLTIME_HOURS = 50
const KEY = 'betrieb_fulltime_hours'

export function loadFulltimeHours(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v >= 10 && v <= 80 ? v : DEFAULT_FULLTIME_HOURS
  } catch {
    return DEFAULT_FULLTIME_HOURS
  }
}

export function saveFulltimeHours(h: number): void {
  try {
    localStorage.setItem(KEY, String(h))
  } catch {
    // nur bis zum Neuladen
  }
}

/** Pensum am Betrieb in % (Anstellung − Schule/ÜK); null = nicht angestellt. */
export function farmPct(p: Pick<DutyPerson, 'employment_pct' | 'school_pct'>): number | null {
  if (p.employment_pct == null) return null
  return Math.max(0, p.employment_pct - (p.school_pct ?? 0))
}

/** Soll-Minuten je Woche am Betrieb; null = nicht angestellt. */
export function targetMinutes(p: Pick<DutyPerson, 'employment_pct' | 'school_pct'>, fulltimeHours: number): number | null {
  const pct = farmPct(p)
  return pct == null ? null : Math.round((pct / 100) * fulltimeHours * 60)
}

/** Reihenfolge beim Verteilen: [Gruppe, Anteil]; kleiner = zuerst. Gruppe 0 = unter Soll, 1 = ohne Anstellung, 2 = am/über Soll. */
export function workloadRank(minutes: number, target: number | null): [number, number] {
  if (target == null) return [1, 0]
  if (target <= 0) return [2, minutes]
  const ratio = minutes / target
  return ratio < 1 ? [0, ratio] : [2, ratio]
}

export const compareRank = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1]

/** «18/20 h» */
export const fmtHours = (min: number) => `${Math.round(min / 6) / 10}`.replace('.', ',')
