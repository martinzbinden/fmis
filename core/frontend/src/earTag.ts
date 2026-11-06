/**
 * Normalisierter Schlüssel einer Tier-ID für Abstammung, Belegungen und
 * Geburten. Schweizer Schafe tragen im Herdebuch-Export die Langform
 * "CH113" + 8 Ziffern + Prüfziffer, auf der Ohrmarke (und in der TVD) aber die
 * Kurzform "CH" + dieselben 8 Ziffern, gedruckt oft mit Punkt ("CH9000.0130").
 * Beide ergeben hier "CH90000130" — gleiche Regel wie
 * core/backend/fmis_core/agrident.py:sheep_short_tag. Alle anderen IDs
 * (Rinder "CH120…", ausländische Stiere/Widder "FR0099…") bleiben unverändert,
 * nur Leerzeichen und Punkte fallen weg. Von Hand ohne «CH» getippte
 * Nummern ("9000.0130", "120900000203") bekommen das «CH» dazu — sonst würde
 * die eigene Mutter als neues Lamm nicht erkannt.
 */
export function animalKey(id: string | null | undefined): string | null {
  if (!id) return null
  let compact = id.replace(/[\s.]/g, '').toUpperCase()
  if (compact === '' || /^[A-Z]{2}0*$/.test(compact)) return null
  if (/^\d{8}$/.test(compact) || /^120\d{9}$/.test(compact)) compact = `CH${compact}`
  const sheepLong = /^CH113(\d{8})\d$/.exec(compact)
  if (sheepLong) return `CH${sheepLong[1]}`
  return compact
}

/** Ist eine von Hand eingetragene Ohrmarke vollständig? Gibt den Grund
 * zurück, wenn nicht — Ländercode und mindestens 8 Ziffern (Schafe "9000.0130",
 * Rinder "120 9000 0020 3"); nur die letzten Ziffern oder Buchstaben reichen nicht. */
export function earTagProblem(input: string | null | undefined): string | null {
  const key = animalKey(input)
  if (!key) return 'Ohrmarke fehlt.'
  if (!/^[A-Z]{2}\d{8,14}$/.test(key)) return `Ohrmarke «${(input ?? '').trim()}» ist unvollständig – die ganze Nummer eintragen, z.B. 9000.0130.`
  return null
}

/**
 * Ohrmarke für Listen: nur die Nummer, die auf der Marke steht — bei
 * Schafen die 8 Ziffern der TVD-Nummer ("9000.0130" aus CH113900001305 oder
 * CH9000.0130), bei Rindern die 9 Ziffern nach "CH120" ("9000.0020.3", wie im
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
