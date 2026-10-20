import { daysBetween } from './format'

/** Laktationstag an einem Wägungstag: Tage seit der Abkalbung/Ablammung
 * (Abkalbetag = Tag 0, wie in der Kurvenauswertung lib/lactationCurves.ts).
 * null ohne Abkalbedatum oder bei einem Datum nach der Wägung. */
export function lactationDayAt(calvingDate: string | null | undefined, testDate: string | null | undefined): number | null {
  if (!calvingDate || !testDate) return null
  const d = daysBetween(calvingDate, testDate)
  return Number.isFinite(d) && d >= 0 ? d : null
}
