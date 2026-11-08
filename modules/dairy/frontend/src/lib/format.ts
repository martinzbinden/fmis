import { localTodayIso } from '@fmis/core/dates'

// pglite liefert numeric-Spalten als string (Präzisionserhalt) — zentrale
// Konvertierungs- und Format-Helfer.

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? null : n
}

export function fmtKg(v: unknown): string {
  const n = num(v)
  return n == null ? '–' : `${n.toFixed(1)} kg`
}

export function fmtPct(v: unknown): string {
  const n = num(v)
  return n == null ? '–' : `${n.toFixed(2)}%`
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '–'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('de-CH')
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '–'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Heute in LOKALER Zeit (core/frontend/src/dates.ts). */
export function todayIso(): string {
  return localTodayIso()
}

// localTodayIso: früher hier, jetzt zentral — todayIso() ist ebenfalls lokal.
export { localTodayIso }

/** pglite liefert date-Spalten als Date (UTC-Mitternacht) — für Vergleiche
 * und Rechnungen den reinen YYYY-MM-DD-String. */
export function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

/** Ganze Tage von a nach b (b − a), in UTC gerechnet. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Alter kurz: «12 T.», «7 Mt.», «3 J. 2 Mt.» (Tier-Info, Merklisten). */
export function fmtAge(birth: unknown, today: string): string {
  const b = isoDate(birth)
  if (!b) return 'Alter ?'
  const day = 86_400_000
  const months = Math.floor((Date.parse(today) - Date.parse(b)) / (30.4375 * day))
  // junge Tiere bis 3 Monate in Tagen
  if (months < 3) return `${Math.round((Date.parse(today) - Date.parse(b)) / day)} T.`
  if (months < 24) return `${months} Mt.`
  return `${Math.floor(months / 12)} J. ${months % 12} Mt.`
}
