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

/**
 * Ohrmarke für Listen: nur die Nummer, die auf der Marke steht — bei
 * Schafen die 8 Ziffern der TVD-Nummer ("2004.1511" aus CH113200415115 oder
 * CH2004.1511), bei Rindern die 9 Ziffern nach "CH120" ("1361.5253.3", wie im
 * Prüfbericht ohne den Länder-/Artcode). Andere IDs (z.B. ausländische
 * KB-Stiere) bleiben unverändert.
 */
export function shortEarTag(id: string | null | undefined): string {
  if (!id) return ''
  const key = animalKey(id)
  if (!key) return id
  const sheep = /^CH(\d{8})$/.exec(key)
  if (sheep) return `${sheep[1].slice(0, 4)}.${sheep[1].slice(4)}`
  const cattle = /^CH120(\d{9})$/.exec(key)
  if (cattle) return `${cattle[1].slice(0, 4)}.${cattle[1].slice(4, 8)}.${cattle[1].slice(8)}`
  return id
}

/** Bezeichnung in Listen: Ohrmarke (kurz) und Name, falls vorhanden. */
export function animalLabel(a: { ear_tag: string; name: string | null }): string {
  const tag = shortEarTag(a.ear_tag)
  return a.name ? `${tag} ${a.name}` : tag
}
