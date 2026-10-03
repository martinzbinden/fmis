// Datenexplorer der Laktationskurven: Wägungen liegen je Laktation an
// verschiedenen Laktationstagen — für den Vergleich "an derselben Stelle"
// wird jede Laktation an jedem Tag geglättet geschätzt (getestet).

/** Wägung in der Grafik (Laktationstag, Wert in der gezeigten Einheit) */
export interface SeriesPoint {
  dim: number
  value: number
}

/** Bandbreite der Glättung in Tagen (Gauss-Kern): Wägungen ~monatlich,
 * eine Wägung 30 Tage entfernt zählt noch rund ein Drittel. */
export const SMOOTH_DAYS = 20
/** Über die erste/letzte Wägung hinaus höchstens so weit schätzen. */
export const EDGE_DAYS = { before: 10, after: 15 }
/** So nahe an einer Wägung gilt der Wert als gemessen. */
export const NEAR_DAYS = 3

export interface Estimate {
  value: number
  /** Wägung innert NEAR_DAYS — dann deren Wert statt der Glättung */
  measured: boolean
}

/** Geglätteter Wert am Tag `day`: lokal lineare Regression mit Gauss-
 * Gewichten (folgt der Steigung auch am Rand, anders als ein gleitendes
 * Mittel), bei nur einer Wägung in Reichweite deren Wert. Ausserhalb der
 * gewogenen Spanne (plus kleiner Rand) null — keine Hochrechnung ins Blaue. */
export function smoothAt(points: SeriesPoint[], day: number, bandwidth = SMOOTH_DAYS): Estimate | null {
  if (points.length === 0) return null
  const sorted = [...points].sort((a, b) => a.dim - b.dim)
  if (day < sorted[0].dim - EDGE_DAYS.before || day > sorted[sorted.length - 1].dim + EDGE_DAYS.after) return null
  const near = sorted.reduce((best, p) => (Math.abs(p.dim - day) < Math.abs(best.dim - day) ? p : best))
  if (Math.abs(near.dim - day) <= NEAR_DAYS) return { value: near.value, measured: true }
  let sw = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const p of sorted) {
    const w = Math.exp(-0.5 * ((p.dim - day) / bandwidth) ** 2)
    const x = p.dim - day
    sw += w
    sx += w * x
    sy += w * p.value
    sxx += w * x * x
    sxy += w * x * p.value
  }
  if (sw < 1e-9) return null
  const det = sw * sxx - sx * sx
  // Zu wenig Spreizung für eine Steigung → gewichtetes Mittel
  if (Math.abs(det) < 1e-6 * sw * sw) return { value: sy / sw, measured: false }
  // Achsenabschnitt bei x = 0, also am Tag `day`
  const value = (sxx * sy - sx * sxy) / det
  // Nicht über die Spanne der beteiligten Wägungen hinausschiessen
  const lo = Math.min(...sorted.map((p) => p.value))
  const hi = Math.max(...sorted.map((p) => p.value))
  return { value: Math.min(hi, Math.max(lo, value)), measured: false }
}

/** Mittel mehrerer Schätzungen (frühere Laktationen), null wenn keine. */
export function meanOf(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}
