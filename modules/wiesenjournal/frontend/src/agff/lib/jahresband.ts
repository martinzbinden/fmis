// Jahresband und Kennzahlen je Parzelle (Etappe 2): eine Zeile pro Parzelle mit den Wochen des Jahres als Feldern (Weide als
// Balken, Schnitt als Buchstabe, Düngung als Dreieck, Pflege als Punkt). Für die Ansicht «Jahr» und den Steckbrief.
// Nichts wird gespeichert; alles kommt aus den Einträgen (mit der Weide aus den Herden).

import type { Store } from '../db/store'
import { addDaysIso, todayIso, USAGE_COLOR_FAMILY, USAGE_TYPE_LABEL, USAGE_TYPE_LETTER } from './format'
import { nutzungen } from './herden'
import { isoWoche, montag } from './ansicht'
import type { Parcel } from '../types'

const SCHNITT = new Set(['eingrasen', 'silage', 'duerrfutter_bel', 'duerrfutter_unbel'])

export interface Woche {
  /** Weidetage in der Woche (0–7) */
  weide: number
  /** Schnitt der Woche als Buchstabe (E, S, Db, Du) und Farbfamilie */
  schnitt: { buchstabe: string; familie: string } | null
  duengung: boolean
  pflege: boolean
  /** erster Tag mit einem Eintrag (zum Hinspringen) */
  ersterTag: string | null
  /** Kurztext für den Tooltip und Screenreader */
  text: string[]
}

export interface Kennzahlen {
  nutzungen: number
  schnitte: number
  weidetage: number
  duengungen: number
  /** N gesamt je ha im Jahr */
  n_kg_ha: number | null
  letzteNutzung: { datum: string; text: string; art: string } | null
  letzteDuengung: { datum: string; text: string } | null
}

export interface Jahresband {
  /** Montag jeder Spalte (KW 1 … 52/53 des Jahres) */
  wochen: string[]
  /** je Parzelle die Felder in derselben Reihenfolge */
  baender: Map<string, Woche[]>
  kennzahlen: Map<string, Kennzahlen>
}

/** Montage der ISO-Wochen, die zum Jahr gehören. */
export function wochenDesJahres(jahr: number): string[] {
  const out: string[] = []
  let m = montag(`${jahr}-01-04`) // Woche 1 enthält den 4. Januar
  while (isoWoche(m)[0] === jahr) {
    out.push(m)
    m = addDaysIso(m, 7)
  }
  return out
}

const leer = (): Woche => ({ weide: 0, schnitt: null, duengung: false, pflege: false, ersterTag: null, text: [] })

export function jahresband(s: Store, jahr: number, parcels: Parcel[], heute = todayIso()): Jahresband {
  const wochen = wochenDesJahres(jahr)
  const von = wochen[0]
  const bis = addDaysIso(wochen[wochen.length - 1], 6)
  const index = new Map(wochen.map((w, i) => [w, i]))
  const ids = new Set(parcels.map((p) => p.id))
  const baender = new Map<string, Woche[]>()
  const kennzahlen = new Map<string, Kennzahlen>()
  for (const p of parcels) {
    baender.set(p.id, wochen.map(leer))
    kennzahlen.set(p.id, { nutzungen: 0, schnitte: 0, weidetage: 0, duengungen: 0, n_kg_ha: null, letzteNutzung: null, letzteDuengung: null })
  }
  const feld = (pid: string, d: string) => {
    const i = index.get(montag(d))
    const w = i == null ? undefined : baender.get(pid)?.[i]
    if (w && (!w.ersterTag || d < w.ersterTag)) w.ersterTag = d
    return w
  }
  const weideTage = new Map<string, Set<string>>() // je Parzelle und Woche die Tage (mehrere Herden zählen einmal)
  for (const u of nutzungen(s, von, bis)) {
    if (!ids.has(u.parcel_id)) continue
    const w = feld(u.parcel_id, u.entry_date)
    const k = kennzahlen.get(u.parcel_id)!
    const imJahr = u.entry_date.startsWith(String(jahr))
    if (u.usage_type === 'weide') {
      const key = `${u.parcel_id}|${montag(u.entry_date)}`
      const tage = weideTage.get(key) ?? new Set<string>()
      if (!tage.has(u.entry_date)) {
        tage.add(u.entry_date)
        if (w) w.weide = tage.size
        if (imJahr) k.weidetage++
      }
      weideTage.set(key, tage)
    } else if (SCHNITT.has(u.usage_type)) {
      if (w && !w.schnitt) w.schnitt = { buchstabe: USAGE_TYPE_LETTER[u.usage_type] ?? '?', familie: USAGE_COLOR_FAMILY[u.usage_type] ?? 'sonstig' }
      if (imJahr) k.schnitte++
    } else if (w) w.pflege = true
    if (!imJahr) continue
    k.nutzungen++
    if (u.entry_date <= heute && (!k.letzteNutzung || u.entry_date > k.letzteNutzung.datum))
      k.letzteNutzung = { datum: u.entry_date, text: USAGE_TYPE_LABEL[u.usage_type] ?? u.usage_type, art: u.usage_type }
    if (w && !w.text.includes(USAGE_TYPE_LABEL[u.usage_type] ?? u.usage_type)) w.text.push(USAGE_TYPE_LABEL[u.usage_type] ?? u.usage_type)
  }
  const gaben = new Map(s.rows('fertilization_entries').filter((f) => f.entry_date >= von && f.entry_date <= bis).map((f) => [f.id, f]))
  const nSumme = new Map<string, number>()
  const gezaehlt = new Set<string>()
  for (const x of s.rows('fertilization_shares')) {
    const f = gaben.get(x.entry_id)
    if (!f || !ids.has(x.parcel_id)) continue
    const w = feld(x.parcel_id, f.entry_date)
    if (w) {
      w.duengung = true
      if (!w.text.includes(f.code)) w.text.push(f.code)
    }
    if (!f.entry_date.startsWith(String(jahr))) continue
    const k = kennzahlen.get(x.parcel_id)!
    const key = `${x.parcel_id}|${f.id}`
    if (!gezaehlt.has(key)) {
      gezaehlt.add(key)
      k.duengungen++
    }
    nSumme.set(x.parcel_id, (nSumme.get(x.parcel_id) ?? 0) + (Number(x.n_kg) || 0))
    if (f.entry_date <= heute && (!k.letzteDuengung || f.entry_date > k.letzteDuengung.datum))
      k.letzteDuengung = { datum: f.entry_date, text: `${f.code}${f.amount != null ? ` ${Number(f.amount)} ${f.unit === 'm3' ? 'm³' : f.unit}` : ''}` }
  }
  for (const p of parcels) {
    const ha = (Number(p.area_a) || 0) / 100
    const n = nSumme.get(p.id)
    if (n != null && ha > 0) kennzahlen.get(p.id)!.n_kg_ha = Math.round(n / ha)
  }
  return { wochen, baender, kennzahlen }
}

/** «vor 13 T.», «heute», «in 3 T.» */
export function vorTagen(datum: string, heute = todayIso()): string {
  const t = Math.round((Date.parse(`${heute}T12:00:00Z`) - Date.parse(`${datum}T12:00:00Z`)) / 86400000)
  if (t === 0) return 'heute'
  if (t === 1) return 'gestern'
  return t > 0 ? `vor ${t} T.` : `in ${-t} T.`
}
