// Parzellen-Finder (UI-Prüfung Etappe 1, Befund U1): Suche, Filter-Chips, Favoriten, Sortierung, Gruppen. Ein Bauteil für
// Raster, Parzellenliste und alle Auswahllisten. Die Ansichten teilen einen Zustand (Entscheid des Betriebs 15.11.2026: wer im
// Raster nach «Eich» filtert, sieht im Jahresblatt dieselbe Auswahl); Auswahllisten in Dialogen haben eine eigene Suche.

import type { Store } from '../db/store'
import { addDaysIso, todayIso } from './format'
import { nutzungen } from './herden'
import { geschnitten, letzteDuengung } from './fragen'
import type { Parcel } from '../types'

export type Chip = 'fav' | 'letzte' | 'herde' | 'futter' | 'acker' | 'weide' | 'n30' | 'ungeschnitten'
export type Sortierung = 'eigen' | 'name' | 'flaeche' | 'zuletzt'

export interface FinderZustand {
  suche: string
  chips: Chip[]
  sort: Sortierung
}

export const FINDER_LEER: FinderZustand = { suche: '', chips: [], sort: 'eigen' }

export const CHIP_TEXT: Record<Chip, string> = {
  fav: '★ Favoriten',
  letzte: 'Letzte 14 Tage',
  herde: '🐄 Herde darauf',
  futter: 'Futter',
  acker: 'Acker',
  weide: 'Weiden',
  // Fragen als Chips (Etappe 6, lib/fragen.ts)
  n30: 'seit 30 T. nicht gedüngt',
  ungeschnitten: 'noch nicht geschnitten',
}
export const SORT_TEXT: Record<Sortierung, string> = { eigen: 'eigene Reihenfolge', name: 'Name', flaeche: 'Fläche', zuletzt: 'zuletzt benutzt' }

/** Was der Finder über die Parzellen wissen muss (aus den Einträgen abgeleitet, nichts gespeichert). */
export interface FinderDaten {
  /** letzter Eintrag (Nutzung oder Düngung) je Parzelle bis heute */
  zuletzt: Map<string, string>
  /** Parzellen mit einer Herde darauf (heute) */
  herde: Set<string>
  /** Parzellen mit Weide im Jahr */
  weide: Set<string>
  /** letzte Düngung je Parzelle bis heute (Frage «seit 30 Tagen nicht gedüngt») */
  duengung: Map<string, string>
  /** Parzellen mit einem Schnitt im Jahr (Frage «noch nicht geschnitten») */
  geschnitten: Set<string>
  heute: string
}

export function finderDaten(s: Store, jahr: number, heute = todayIso()): FinderDaten {
  const von = `${jahr}-01-01`
  const bis = heute < `${jahr}-12-31` ? heute : `${jahr}-12-31`
  const zuletzt = new Map<string, string>()
  const weide = new Set<string>()
  const merke = (pid: string | null | undefined, d: string) => {
    if (pid && d <= bis && (zuletzt.get(pid) ?? '') < d) zuletzt.set(pid, d)
  }
  for (const u of nutzungen(s, von, `${jahr}-12-31`)) {
    merke(u.parcel_id, u.entry_date)
    if (u.usage_type === 'weide') weide.add(u.parcel_id)
  }
  const gaben = new Map<string, string>()
  for (const f of s.rows('fertilization_entries'))
    if (f.entry_date >= von && f.entry_date <= `${jahr}-12-31`) {
      gaben.set(f.id, f.entry_date)
      merke(f.parcel_id, f.entry_date)
    }
  for (const x of s.rows('fertilization_shares')) if (gaben.has(x.entry_id)) merke(x.parcel_id, gaben.get(x.entry_id)!)
  const herde = new Set<string>()
  for (const a of s.rows('herden_aufenthalte')) if (a.ort === 'weide' && a.parcel_id && a.von <= heute && (a.bis == null || a.bis >= heute)) herde.add(a.parcel_id)
  const duengung = new Map([...letzteDuengung(s, heute)].map(([k, v]) => [k, v.datum]))
  return { zuletzt, herde, weide, duengung, geschnitten: geschnitten(s, jahr, heute), heute }
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Trifft die Suche? Name, Kultur, Wiesentyp, Bemerkung; mehrere Wörter müssen alle vorkommen. */
export function passtSuche(p: Parcel, suche: string): boolean {
  const woerter = norm(suche).split(/\s+/).filter(Boolean)
  if (!woerter.length) return true
  const text = norm([p.name, p.name_import, p.kultur_name_de, p.kultur_code, p.wiesentyp, p.notes].filter(Boolean).join(' '))
  return woerter.every((w) => text.includes(w))
}

const istWeide = (p: Parcel, d: FinderDaten) => d.weide.has(p.id) || /weide/i.test(`${p.name} ${p.kultur_name_de ?? ''} ${p.wiesentyp ?? ''}`)

export function passtChips(p: Parcel, chips: Chip[], d: FinderDaten): boolean {
  for (const c of chips) {
    if (c === 'fav' && !p.favorit) return false
    if (c === 'letzte' && (d.zuletzt.get(p.id) ?? '') < addDaysIso(d.heute, -14)) return false
    if (c === 'herde' && !d.herde.has(p.id)) return false
    if (c === 'futter' && p.category !== 'futter') return false
    if (c === 'acker' && p.category !== 'acker') return false
    if (c === 'weide' && !istWeide(p, d)) return false
    if (c === 'n30' && (p.category === 'andere' || (d.duengung.get(p.id) ?? '') >= addDaysIso(d.heute, -30))) return false
    if (c === 'ungeschnitten' && (p.category !== 'futter' || d.geschnitten.has(p.id))) return false
  }
  return true
}

/** Chip umschalten; Futter und Acker schliessen sich aus. */
export function chipUmschalten(chips: Chip[], c: Chip): Chip[] {
  if (chips.includes(c)) return chips.filter((x) => x !== c)
  const ohne = c === 'futter' ? chips.filter((x) => x !== 'acker') : c === 'acker' ? chips.filter((x) => x !== 'futter') : chips
  return [...ohne, c]
}

function vergleich(sort: Sortierung, d: FinderDaten) {
  const name = (a: Parcel, b: Parcel) => a.name.localeCompare(b.name, 'de', { numeric: true })
  if (sort === 'name') return name
  if (sort === 'flaeche') return (a: Parcel, b: Parcel) => (Number(b.area_a) || 0) - (Number(a.area_a) || 0) || name(a, b)
  if (sort === 'zuletzt') return (a: Parcel, b: Parcel) => (d.zuletzt.get(b.id) ?? '').localeCompare(d.zuletzt.get(a.id) ?? '') || name(a, b)
  return (a: Parcel, b: Parcel) =>
    (a.farm_name ?? '￿').localeCompare(b.farm_name ?? '￿') || a.category.localeCompare(b.category) || a.sort_order - b.sort_order || name(a, b)
}

export interface FinderGruppe {
  key: string
  titel: string
  parcels: Parcel[]
}

const KATEGORIE_TITEL: Record<string, string> = { futter: 'Futterflächen', acker: 'Acker', andere: 'Andere Flächen' }

/**
 * Filtern, sortieren, gruppieren: Favoriten als eigene Gruppe zuoberst; bei eigener Reihenfolge danach je Kategorie,
 * sonst eine Gruppe «Alle Parzellen».
 */
export function finden(parcels: Parcel[], z: FinderZustand, d: FinderDaten): { gruppen: FinderGruppe[]; liste: Parcel[] } {
  const passend = parcels.filter((p) => passtSuche(p, z.suche) && passtChips(p, z.chips, d)).sort(vergleich(z.sort, d))
  const fav = passend.filter((p) => p.favorit)
  const rest = passend.filter((p) => !p.favorit)
  const gruppen: FinderGruppe[] = []
  if (fav.length) gruppen.push({ key: 'fav', titel: '★ Favoriten', parcels: fav })
  if (z.sort === 'eigen') {
    for (const k of ['futter', 'acker', 'andere']) {
      const g = rest.filter((p) => p.category === k)
      if (g.length) gruppen.push({ key: k, titel: KATEGORIE_TITEL[k], parcels: g })
    }
  } else if (rest.length) gruppen.push({ key: 'alle', titel: fav.length ? 'Übrige' : 'Alle Parzellen', parcels: rest })
  return { gruppen, liste: gruppen.flatMap((g) => g.parcels) }
}

// ---------- gemeinsamer Zustand der Ansichten (pro Gerät) ----------

const KEY = 'journal_finder'
let zustand: FinderZustand = laden()
const hoerer = new Set<() => void>()

function laden(): FinderZustand {
  try {
    const z = JSON.parse(sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY) ?? 'null') as Partial<FinderZustand> | null
    if (!z) return FINDER_LEER
    return { suche: typeof z.suche === 'string' ? z.suche : '', chips: Array.isArray(z.chips) ? (z.chips as Chip[]) : [], sort: (z.sort as Sortierung) ?? 'eigen' }
  } catch {
    return FINDER_LEER
  }
}

export const finderZustand = () => zustand
export function finderAbonnieren(h: () => void): () => void {
  hoerer.add(h)
  return () => hoerer.delete(h)
}
/** Zustand setzen; Chips und Sortierung bleiben auf dem Gerät, die Suche nur in dieser Sitzung. */
export function finderSetzen(neu: Partial<FinderZustand>): void {
  zustand = { ...zustand, ...neu }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(zustand))
    localStorage.setItem(KEY, JSON.stringify({ ...zustand, suche: '' }))
  } catch {
    // ohne Speicher nur bis zum Neuladen
  }
  hoerer.forEach((h) => h())
}

/** Stern: Favorit umschalten; ein Stern setzt auch «immer zeigen» (Entscheid E5). */
export function sternUmschalten(s: Store, p: Pick<Parcel, 'id' | 'favorit'>): void {
  s.put('parcels', p.favorit ? { id: p.id, favorit: false } : { id: p.id, favorit: true, immer_zeigen: true })
}
