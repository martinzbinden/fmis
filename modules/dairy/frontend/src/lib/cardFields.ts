// Wählbare Eigenschaften der Dashboard-Karten (pages/Board.tsx): die Auswahl gilt je Gerät (localStorage).

export type CardFieldKey = 'milk' | 'scc' | 'spark' | 'ltl' | 'zw' | 'litter' | 'interval' | 'meat' | 'weaned'

export interface CardFieldDef {
  key: CardFieldKey
  label: string
  hint: string
  /** nur für diese Tierart (sonst beide) */
  species?: 'sheep' | 'cattle'
}

export const CARD_FIELDS: CardFieldDef[] = [
  { key: 'weaned', label: 'Abgesetzte Lämmer letzter Wurf', hint: 'Lämmer des letzten Wurfs, die erfolgreich abgesetzt wurden (blaue Umriss-Lämmer mit Haken); saugende sind grün gefüllt' },
  { key: 'milk', label: 'Milch: Index und Gleichaltrige', hint: 'Leistungsindex im Herdenvergleich (Mittel 100) und Leistung in % der Gleichaltrigen' },
  { key: 'scc', label: 'Zellzahl: Index und Gleichaltrige', hint: 'Zellzahl-Index (Herdenmittel 100), Ø 12 Monate und in % der Gleichaltrigen (tiefer ist besser)' },
  { key: 'spark', label: 'Laktationen als Minigrafik', hint: 'Leistungsniveau je Laktation gegen die Herde (gestrichelt = 100 %)' },
  { key: 'ltl', label: 'Lebenstagleistung', hint: 'Milch je Lebenstag in kg' },
  { key: 'zw', label: 'Zuchtwert (GZW / ISET)', hint: 'Gesamtzuchtwert aus dem Herdebuch' },
  { key: 'litter', label: 'Wurfgrösse', hint: 'Letzter Wurf und Mittel aller Würfe', species: 'sheep' },
  { key: 'interval', label: 'Zwischenablammzeit', hint: 'Mittlere Tage zwischen zwei Geburten' },
  { key: 'meat', label: 'Geschätzter Fleischwert', hint: 'Schlachterlös nach Alter am Schlachttermin und Proviande-Preis, nach Abzügen (Einstellungen: Knopf «Fleischwert»)', species: 'sheep' },
]

export const DEFAULT_CARD_FIELDS: CardFieldKey[] = ['weaned', 'milk', 'scc', 'spark']

const storageKey = (moduleKey: string) => `${moduleKey}_board_card_fields`

export function loadCardFields(moduleKey: string): CardFieldKey[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(moduleKey)) ?? 'null') as unknown
    if (Array.isArray(raw)) return raw.filter((k): k is CardFieldKey => CARD_FIELDS.some((f) => f.key === k))
  } catch {
    // ohne localStorage gelten die Vorgaben
  }
  return DEFAULT_CARD_FIELDS
}

export function saveCardFields(moduleKey: string, keys: CardFieldKey[]): void {
  try {
    localStorage.setItem(storageKey(moduleKey), JSON.stringify(keys))
  } catch {
    // nur bis zum Neuladen
  }
}
