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

export function fmtChf(v: unknown): string {
  const n = num(v)
  return n == null ? '–' : `CHF ${n.toFixed(2)}`
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '–'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('de-CH')
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ageInDays(birthDate: string | null): number | null {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (24 * 60 * 60 * 1000))
}

export function fmtAge(birthDate: string | null): string {
  const days = ageInDays(birthDate)
  if (days == null) return '–'
  if (days < 60) return `${days} Tage`
  const months = Math.floor(days / 30.44)
  return `${months} Mt.`
}
