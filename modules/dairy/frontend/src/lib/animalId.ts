/**
 * Normalisierter Schlüssel einer Tier-ID für Abstammung, Belegungen und
 * Geburten. Schweizer Schafe tragen im Herdebuch-Export die Langform
 * "CH113" + 8 Ziffern + Prüfziffer, auf der Ohrmarke (und in der TVD) aber die
 * Kurzform "CH" + dieselben 8 Ziffern, gedruckt oft mit Punkt ("CH2004.1511").
 * Beide ergeben hier "CH20041511" — gleiche Regel wie
 * core/backend/fmis_core/agrident.py:sheep_short_tag. Alle anderen IDs
 * (Rinder "CH120…", ausländische Stiere/Widder "FR0099…") bleiben unverändert,
 * nur Leerzeichen und Punkte fallen weg.
 */
export function animalKey(id: string | null | undefined): string | null {
  if (!id) return null
  const compact = id.replace(/[\s.]/g, '').toUpperCase()
  if (compact === '' || /^[A-Z]{2}0*$/.test(compact)) return null
  const sheepLong = /^CH113(\d{8})\d$/.exec(compact)
  if (sheepLong) return `CH${sheepLong[1]}`
  return compact
}
