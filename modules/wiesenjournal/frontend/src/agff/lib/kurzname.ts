// Kurznamen für Parzellen (Wunsch des Betriebs 16.11.2026): Der Import bildet Namen aus Kultur und Fläche («Extensiv genutzte
// Wiesen 13 a»). Die Fläche steht in jeder Liste ohnehin darunter, und lange Namen brechen im Raster um. Die App schlägt
// einzeilige Namen vor; man übernimmt sie einzeln oder alle, oder gibt eigene ein. Der Originalname bleibt in
// `name_import` und wird beim nächsten Import dort nachgeführt (parcelMerge), der eigene Name in `name` bleibt.

import type { Parcel } from '../types'

/** ab dieser Länge passt ein Name im Raster nicht mehr auf eine Zeile */
export const KURZ_MAX = 20

/** Fläche am Ende des Namens, wie sie der Import anhängt («… 13 a», «… 2.5 a») */
const FLAECHE = /\s+\d+(?:[.,]\d+)?\s*a$/

/** Feste Kurzformen für Kulturen, die sich mit den Regeln unten nicht gut kürzen lassen (geodienste.ch, GELAN). */
const FEST: [RegExp, string][] = [
  [/^Hecken-, Feld- und Ufergehölze/i, 'Hecke'],
  [/^Hochstamm-Feldobstbäume/i, 'Hochstamm'],
  [/^Silo- und Grünmais/i, 'Silomais'],
  [/^Weiden \(Heimweiden/i, 'Weide'],
  [/^Übrige Flächen innerhalb der landwirtschaftlichen Nutzfläche/i, 'Übrige Fläche LN'],
  [/^Übrige unproduktive Flächen/i, 'Unproduktive Fläche'],
  [/^Übrige offene Ackerfläche/i, 'Offene Ackerfläche'],
]

const REGELN: [RegExp, string][] = [
  [/\s*\([^)]*\)/g, ''], // «(ohne Weiden)»
  [/,\s*beitragsberechtigt$/i, ''],
  [/\s+zur Speiseölgewinnung$/i, ''],
  [/^Extensiv genutzte\s+/i, 'Ext. '],
  [/^Wenig intensiv genutzte\s+/i, 'Wenig int. '],
  [/^Intensiv genutzte\s+/i, 'Int. '],
  [/^Übrige\s+/i, ''],
  // Mehrzahl → Einzahl, Gross-/Kleinschreibung des Wortanfangs bleibt («Wiesen» → «Wiese», «Kunstwiesen» → «Kunstwiese»)
  [/(w)iesen\b/gi, '$1iese'],
  [/(w)eiden\b/gi, '$1eide'],
  [/(a)nlagen\b/gi, '$1nlage'],
  [/(r)üben\b/gi, '$1übe'],
  [/(b)lumen\b/gi, '$1lume'],
]

/** Kurzform eines Namens ohne Fläche (noch ohne Nummer gegen Doppel). */
export function kuerzen(name: string): string {
  let n = name.replace(FLAECHE, '').trim()
  const fest = FEST.find(([re]) => re.test(n))
  if (fest) return fest[1]
  for (const [re, ersatz] of REGELN) n = n.replace(re, ersatz)
  n = n.replace(/\s+/g, ' ').trim()
  return n ? n[0].toUpperCase() + n.slice(1) : name
}

/** Lohnt sich ein Vorschlag? Fläche im Namen oder zu lang für eine Zeile; eigene Namen (name_import gesetzt) nie. */
export function kuerzbar(p: Pick<Parcel, 'name' | 'name_import'>): boolean {
  if (p.name_import) return false
  return FLAECHE.test(p.name) || p.name.length > KURZ_MAX
}

export interface KurzVorschlag {
  parcel: Parcel
  vorschlag: string
}

/**
 * Vorschläge für alle kürzbaren Parzellen eines Jahres. Gleiche Kurzformen bekommen eine Nummer (nach Fläche, die
 * grösste zuerst), damit man sie unterscheiden kann; Namen, die es schon gibt, werden nicht noch einmal vergeben.
 */
export function kurzVorschlaege(parcels: Parcel[]): KurzVorschlag[] {
  const kandidaten = parcels.filter(kuerzbar)
  const vergeben = new Set(parcels.filter((p) => !kuerzbar(p)).map((p) => p.name.toLowerCase()))
  const gruppen = new Map<string, Parcel[]>()
  for (const p of kandidaten) {
    const k = kuerzen(p.name)
    gruppen.set(k, [...(gruppen.get(k) ?? []), p])
  }
  const out: KurzVorschlag[] = []
  for (const [k, ps] of gruppen) {
    const sortiert = [...ps].sort((a, b) => (Number(b.area_a) || 0) - (Number(a.area_a) || 0) || a.name.localeCompare(b.name, 'de', { numeric: true }))
    let nr = 0
    for (const p of sortiert) {
      let v = k
      if (ps.length > 1 || vergeben.has(k.toLowerCase())) {
        do v = `${k} ${++nr}`
        while (vergeben.has(v.toLowerCase()))
      }
      vergeben.add(v.toLowerCase())
      out.push({ parcel: p, vorschlag: v })
    }
  }
  return out.sort((a, b) => a.vorschlag.localeCompare(b.vorschlag, 'de', { numeric: true }))
}

/** Werte zum Speichern: eigener Name, Original bleibt in name_import. Leer oder gleich dem Original: zurück zum Original. */
export function umbenennen(p: Pick<Parcel, 'id' | 'name' | 'name_import'>, neu: string): Pick<Parcel, 'id' | 'name' | 'name_import'> {
  const original = p.name_import ?? p.name
  const n = neu.trim()
  if (!n || n === original) return { id: p.id, name: original, name_import: null }
  return { id: p.id, name: n, name_import: original }
}
