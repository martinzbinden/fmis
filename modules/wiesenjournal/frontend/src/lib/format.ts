// pglite liefert numeric-Spalten als string (Präzisionserhalt) — zentrale
// Konvertierungs- und Format-Helfer.

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? null : n
}

export function fmtArea(v: unknown): string {
  const n = num(v)
  return n == null ? '–' : `${n.toFixed(2)} a`
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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export const USAGE_TYPE_LABEL: Record<string, string> = {
  weide: 'Weide',
  weide_anzahl: 'Weide (mit Anzahl)',
  eingrasen: 'Eingrasen',
}

export const DUENGUNG_CODES = ['RGv', 'RGk', 'RMI', 'RMs', 'SG', 'SM', 'A', 'H', 'V'] as const

export const INTENSITAET_LABEL: Record<string, string> = {
  i: 'intensiv',
  wi: 'wenig intensiv',
  e: 'extensiv',
  mi: 'mittel-intensiv',
}
