import type { Parcel } from '../types'

export type FilterChip = { value: string; kind: 'name' | 'kultur' | 'category' }

export type VirtualCategory = 'wiesen' | 'weiden' | 'acker' | 'bff'

export const VIRTUAL_CATEGORY_LABEL: Record<VirtualCategory, string> = {
  wiesen: 'Wiesen',
  weiden: 'Weiden',
  acker: 'Offene Ackerfläche',
  bff: 'BFF',
}

// Heuristik anhand des Kultur-Namens (kein eigenes BFF-Flag in den Daten,
// siehe modules/fields — die amtliche Liste kommt nur als Kultur-Code, keine
// BFF-Kennzeichnung). Deckt die gängigsten BFF-Typen ab, ersetzt aber keine
// verbindliche Prüfung gegen den GELAN-Beitragscode.
const BFF_NAME_PATTERNS = [
  /extensiv genutzte wiese/i,
  /wenig intensiv genutzte wiese/i,
  /extensiv genutzte weide/i,
  /waldweide/i,
  /hecke/i,
  /ufervegetation/i,
  /buntbrache/i,
  /rotationsbrache/i,
  /ackerschonstreifen/i,
  /saum auf ackerfläche/i,
  /blühstreifen/i,
  /nussbäume/i,
  /hochstamm/i,
  /streuefläche/i,
]

export function matchesVirtualCategory(p: Parcel, cat: VirtualCategory): boolean {
  const name = (p.kultur_name_de ?? '').toLowerCase()
  switch (cat) {
    case 'wiesen':
      return name.includes('wiese')
    case 'weiden':
      // "Kunstwiesen (ohne Weiden)" enthält "Weiden" nur in einer Verneinung
      // — keine Weide, sonst würde die Heuristik sie fälschlich mitzählen.
      return name.includes('weide') && !name.includes('ohne weide')
    case 'acker':
      return p.category === 'acker'
    case 'bff':
      return BFF_NAME_PATTERNS.some((re) => re.test(name))
  }
}

export function parcelMatchesChip(p: Parcel, chip: FilterChip): boolean {
  if (chip.kind === 'category') return matchesVirtualCategory(p, chip.value as VirtualCategory)
  if (chip.kind === 'kultur') return p.kultur_name_de === chip.value
  return p.name === chip.value
}
