// Wählbare Eigenschaften der Dashboard-Karten (pages/Board.tsx): die Auswahl gilt je Gerät (localStorage).

export type CardFieldKey = 'service' | 'lambValue' | 'milk' | 'scc' | 'spark' | 'ltl' | 'zw' | 'litter' | 'interval' | 'meat' | 'weaned' | 'lambMilk' | 'lambing' | 'weighings' | 'milkFeed' | 'dailyMilk'

export interface CardFieldDef {
  key: CardFieldKey
  label: string
  hint: string
  /** nur für diese Tierart (sonst beide) */
  species?: 'sheep' | 'cattle'
}

export const CARD_FIELDS: CardFieldDef[] = [
  { key: 'weaned', label: 'Abgesetzte Lämmer letzter Wurf', hint: 'Lämmer des letzten Wurfs, die erfolgreich abgesetzt wurden (blaue Umriss-Lämmer mit Haken); saugende sind grün gefüllt' },
  { key: 'lambMilk', label: 'Milch der Lämmer (Schätzung)', hint: 'Aus dem Zuwachs der Lämmer des letzten Wurfs: Wägung bei Geburt oder Ohrmarke und beim Absetzen (Einstellungen: Faktor, Altersgrenze)', species: 'sheep' },
  { key: 'lambValue', label: 'Zucht-Mehrwert (Jungtiere)', hint: 'Weibliche Jungtiere unter 12 Monaten: erwartete Milch aus Mutterleistung und Vater-Zuchtwert, in Franken gegenüber einem Durchschnittstier (Einstellungen in der Lämmerauswahl)' },
  { key: 'milk', label: 'Milch: Index und Gleichaltrige', hint: 'Leistungsindex im Herdenvergleich (Mittel 100) und Leistung in % der Gleichaltrigen' },
  { key: 'scc', label: 'Zellzahl: Index und Gleichaltrige', hint: 'Zellzahl-Index (Herdenmittel 100), Ø 12 Monate und in % der Gleichaltrigen (tiefer ist besser)' },
  { key: 'spark', label: 'Laktationen als Minigrafik', hint: 'Leistungsniveau je Laktation gegen die Herde (gestrichelt = 100 %)' },
  { key: 'ltl', label: 'Lebenstagleistung', hint: 'Milch je Lebenstag in kg' },
  { key: 'zw', label: 'Zuchtwert (GZW / ISET)', hint: 'Gesamtzuchtwert aus dem Herdebuch' },
  { key: 'litter', label: 'Wurfgrösse', hint: 'Letzter Wurf und Mittel aller Würfe', species: 'sheep' },
  { key: 'interval', label: 'Zwischenablammzeit', hint: 'Mittlere Tage zwischen zwei Geburten' },
  { key: 'service', label: 'Letzte Belegung', hint: 'Datum (bei Natursprung mit Bockzeit von–bis), KB oder Natursprung, Vatertier und Tage seit der Belegung; Anzahl Belegungen seit der letzten Geburt' },
  { key: 'lambing', label: 'Ablammung: Datum und Tage', hint: 'Letzte Geburt mit Datum und Tagen seit der Geburt' },
  { key: 'weighings', label: 'Letzte Wägung', hint: 'Zuletzt gewogene Milch (auch private Milchwägung ohne Labor), Zellzahl der letzten Prüfung und Anzahl offizieller Prüfungen (mit Gehalten, SMG) dieser Laktation' },
  { key: 'dailyMilk', label: 'Tagesmilch, korrigiert um die Lämmer', hint: 'Gemolken (letzte Wägung) plus Milch der saugenden Lämmer; Lämmer am Eimer zählen nicht' },
  { key: 'milkFeed', label: 'Milch gegen Futter bis Geburt', hint: 'Milchgeld bis zum Trockenstellen minus Futterkosten bis zur nächsten Geburt (Einstellungen erscheinen oben, wenn gewählt)' },
  { key: 'meat', label: 'Geschätzter Fleischwert', hint: 'Schlachterlös nach Alter am Schlachttermin und Proviande-Preis, nach Abzügen (Einstellungen: «⚙️ Einstellungen»)', species: 'sheep' },
]

export const DEFAULT_CARD_FIELDS: CardFieldKey[] = ['weaned', 'milk', 'scc', 'spark']

const storageKey = (moduleKey: string) => `${moduleKey}_board_card_fields`

export function loadCardFields(moduleKey: string): CardFieldKey[] {
  try {
    // früherer Knopf «🥩 Fleischwert» (bis 11.2026): eingeschaltet → Feld «Geschätzter Fleischwert» auf der Karte
    const meatOn = localStorage.getItem(`${moduleKey}_meat_on`)
    if (meatOn != null) {
      localStorage.removeItem(`${moduleKey}_meat_on`)
      if (meatOn === '1') {
        const now = loadCardFields(moduleKey)
        if (!now.includes('meat')) saveCardFields(moduleKey, [...now, 'meat'])
      }
    }
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
