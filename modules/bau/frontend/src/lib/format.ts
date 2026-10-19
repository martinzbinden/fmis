import { localTodayIso } from '@fmis/core/dates'

/** Heute in lokaler Zeit (core/frontend/src/dates.ts). */
export const todayIso = localTodayIso

/** pglite liefert date-Spalten als Date (UTC-Mitternacht) — für Vergleiche den reinen YYYY-MM-DD-String. */
export function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

export function fmtDate(v: unknown): string {
  const iso = isoDate(v)
  if (!iso) return '–'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function fmtDateTime(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })
}

/** numeric-Spalten kommen als String zurück. */
export function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
