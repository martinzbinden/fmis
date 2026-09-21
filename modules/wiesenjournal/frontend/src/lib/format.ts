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

/** pglite liefert `date`-Spalten als JS-Date (UTC-Mitternacht) — für
 * Raster-Indizes/Vergleiche brauchen wir den reinen YYYY-MM-DD-String. */
export function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export const USAGE_TYPE_LABEL: Record<string, string> = {
  weide: 'Weide',
  eingrasen: 'Eingrasen',
  silage: 'Silage',
  duerrfutter_bel: 'Dürrfutter belüftet',
  duerrfutter_unbel: 'Dürrfutter unbelüftet',
  weide_putzen: 'Weide putzen',
  blacken_stechen: 'Blacken stechen',
  blacken_einzelstock: 'Blacken Einzelstockbehandlung',
  blacken_flaeche: 'Blacken Flächenbehandlung',
  uebersaat: 'Übersaat',
  aufwuchshoehe: 'Grasaufwuchshöhe',
  pflug: 'Pflug',
  saat: 'Saat',
  striegeln: 'Striegeln',
  saeuberungsschnitt: 'Säuberungsschnitt',
  sonstig: 'Sonstiges',
}

// Legenden-Buchstaben wie im Papier-/Excel-Journal (Titelseite der Excel).
export const USAGE_TYPE_LETTER: Record<string, string> = {
  eingrasen: 'E',
  silage: 'S',
  duerrfutter_bel: 'Db',
  duerrfutter_unbel: 'Du',
  weide_putzen: 'P',
  blacken_stechen: 'B',
  blacken_einzelstock: 'BE',
  blacken_flaeche: 'BF',
  uebersaat: 'Ü',
  aufwuchshoehe: 'H',
  pflug: 'Pf',
  saat: 'Sa',
  striegeln: 'St',
  saeuberungsschnitt: 'Ss',
  sonstig: '…',
}

export const ANIMAL_CATEGORIES = ['kuehe', 'rinder', 'kaelber', 'galtkuehe', 'schafe', 'legehennen'] as const
export const ANIMAL_CATEGORY_LETTER: Record<string, string> = {
  kuehe: 'X',
  rinder: 'Y',
  kaelber: 'Z',
  galtkuehe: 'G',
  schafe: 'W',
  legehennen: 'V',
}
export const ANIMAL_CATEGORY_LABEL: Record<string, string> = {
  kuehe: 'Kühe',
  rinder: 'Rinder',
  kaelber: 'Kälber',
  galtkuehe: 'Galtkühe',
  schafe: 'Schafe',
  legehennen: 'Legehennen',
}

export const YIELD_UNIT_LABEL: Record<string, string> = {
  rb: 'Rundballen',
  fu: 'Fuder',
  st: 'Stück',
  kg: 'kg',
  dt_ts: 'dt TS',
}

/** Kurzform eines Nutzungseintrags fürs Raster: Weide = Tierart-Buchstabe
 * (klein bei reiner Tagweide), sonst Legenden-Kürzel; 'sonstig' = Anfang
 * des Freitexts. */
export function usageLegend(e: {
  usage_type: string
  animal_category: string | null
  day_only: boolean
  label: string | null
}): string {
  if (e.usage_type === 'weide') {
    const letter = ANIMAL_CATEGORY_LETTER[e.animal_category ?? ''] ?? 'X'
    return e.day_only ? letter.toLowerCase() : letter
  }
  if (e.usage_type === 'sonstig') return (e.label ?? '…').slice(0, 3)
  return USAGE_TYPE_LETTER[e.usage_type] ?? '?'
}

/** Lesbare Beschreibung eines Nutzungseintrags (Journal-Liste, Tooltips). */
export function usageDescription(e: {
  usage_type: string
  animal_category: string | null
  day_only: boolean
  animal_count: number | null
  label: string | null
  value_num: number | null
  yield_amount: number | null
  yield_unit: string | null
}): string {
  const parts: string[] = []
  if (e.usage_type === 'weide') {
    parts.push(e.day_only ? 'Tagweide' : 'Weide')
    if (e.animal_category) parts.push(ANIMAL_CATEGORY_LABEL[e.animal_category])
    if (e.animal_count) parts.push(`${e.animal_count} Tiere`)
  } else {
    parts.push(USAGE_TYPE_LABEL[e.usage_type] ?? e.usage_type)
    if (e.label) parts.push(e.label)
    if (e.value_num != null) {
      parts.push(e.usage_type === 'aufwuchshoehe' ? `${e.value_num} cm` : `${e.value_num} kg/ha`)
    }
    if (e.yield_amount != null) parts.push(`${e.yield_amount} ${YIELD_UNIT_LABEL[e.yield_unit ?? ''] ?? ''}`.trim())
  }
  return parts.join(' · ')
}

export const PARCEL_CATEGORY_LABEL: Record<string, string> = {
  futter: 'Futterfläche',
  acker: 'Ackerkultur',
  andere: 'Andere',
}
export const PARCEL_CATEGORY_COLOR: Record<string, string> = {
  futter: '#16a34a',
  acker: '#b45309',
  andere: '#6b7280',
}
export const PARCEL_SOURCE_LABEL: Record<string, string> = {
  fields: 'GELAN',
  excel: 'Excel',
  manual: 'manuell',
}

export const DUENGUNG_CODES = ['RGv', 'RGk', 'RMI', 'RMs', 'SG', 'SM', 'A', 'H', 'V'] as const

export const INTENSITAET_LABEL: Record<string, string> = {
  i: 'intensiv',
  wi: 'wenig intensiv',
  e: 'extensiv',
  mi: 'mittel-intensiv',
}

export const WEED_TYPE_LABEL: Record<string, string> = {
  blacken: 'Blacken',
  disteln: 'Disteln',
  andere: 'Andere',
}

export const WEED_TYPE_COLOR: Record<string, string> = {
  blacken: '#16a34a',
  disteln: '#ca8a04',
  andere: '#6b7280',
}
