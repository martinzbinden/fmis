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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
