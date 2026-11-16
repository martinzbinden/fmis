// Regenmengen für den Betriebsstandort, automatisch von graswachstum.ch (Wunsch des Betriebs 16.11.2026).
//
// Quelle: Datenexplorer graswachstum.ch/growth (Daten auf apps.graswachstum.ch, täglich von r-grassgrowth erzeugt).
// Er stellt MeteoSchweiz-Niederschlag (RhiresD/RprelimD, 1-km-Gitter) auf ein Gitter von rund 2 km, je Jahr ein Ordner:
//   ebenen/tage/niederschlag_<Jahr>/index.json  – Gitter (x0…x1 Länge, y0…y1 Breite, ncol × nrow), Kachelgrösse, Starttag
//   ebenen/tage/niederschlag_<Jahr>/<kx>_<ky>.json – Kachel: d[Zeile × w + Spalte] = Tageswerte in Zehntel-mm ab Starttag
// Abruf direkt aus dem Browser (CORS offen). An graswachstum.ch geht nur, welche Kachel (rund 40 × 40 km) gebraucht wird.
//
// Standort: Median der Parzellenmitten des Jahres (eine weit entfernte Alp verschiebt ihn nicht). Die Werte liegen nur auf
// dem Gerät (Einstellung «regen» in `settings`, nicht in der Cloud). Ein Eintrag von Hand in der Tagesmeldung
// (daily_farm_log.niederschlag_mm) geht immer vor.

import { centerLatLng } from './geo'
import type { Store } from '../db/store'

export const REGEN_BASIS = 'https://apps.graswachstum.ch/growth/ebenen/tage/'
export const REGEN_QUELLE = 'MeteoSchweiz (1-km-Gitter), über graswachstum.ch'
/** Geräte-Einstellung (store.ts GERAET_EINSTELLUNGEN) */
export const REGEN_KEY = 'regen'

/** frühestens wieder holen: laufendes Jahr (neue Tage kommen jede Nacht), frühere Jahre (vorläufige Werte werden ersetzt),
 * Jahr ohne Daten auf graswachstum.ch */
const ALTER_LAUFEND_MS = 6 * 3600_000
const ALTER_FRUEHER_MS = 30 * 86400_000
const ALTER_FEHLT_MS = 12 * 3600_000
/** nach einem Netzfehler nicht gleich wieder versuchen */
const PAUSE_NACH_FEHLER_MS = 10 * 60_000

export interface RegenGitter {
  x0: number
  x1: number
  y0: number
  y1: number
  ncol: number
  nrow: number
}
export interface RegenIndex extends RegenGitter {
  kachel: number
  start: string
  tage: number
}

/** Zwischenspeicher je Jahr */
export interface RegenJahr {
  /** gefunden: Werte vorhanden; fehlt: kein Gitter für dieses Jahr oder Standort ausserhalb */
  fehlt: boolean
  gitter: RegenGitter | null
  /** «Spalte_Zeile» der Zelle, für die die Werte gelten */
  zelle: string | null
  start: string | null
  /** Zehntel-mm je Tag ab start; null = kein Wert */
  mm10: (number | null)[]
  /** Zeitpunkt des Abrufs (ISO) */
  geholt: string
}
export type RegenSpeicher = Record<string, RegenJahr>

export class RegenFehler extends Error {}

type Fetch = (url: string) => Promise<Response>

export function zelleFuer(g: RegenGitter, lng: number, lat: number): { col: number; row: number } | null {
  const col = Math.floor(((lng - g.x0) / (g.x1 - g.x0)) * g.ncol)
  const row = Math.floor(((g.y1 - lat) / (g.y1 - g.y0)) * g.nrow)
  if (!(col >= 0 && col < g.ncol && row >= 0 && row < g.nrow)) return null
  return { col, row }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Betriebsstandort: Median der Mitten aller Parzellen mit Geometrie (bevorzugt die des Jahres). */
export function standortFuer(parcels: { season_year: number; base_geometry: string | null }[], jahr: number): { lat: number; lng: number } | null {
  const mitten = (liste: typeof parcels) => liste.map((p) => centerLatLng(p.base_geometry)).filter((m): m is [number, number] => !!m)
  let m = mitten(parcels.filter((p) => p.season_year === jahr))
  if (!m.length) {
    // ohne Parzellen in diesem Jahr: das nächstliegende Jahr mit Parzellen
    const jahre = [...new Set(parcels.map((p) => p.season_year))].sort((a, b) => Math.abs(a - jahr) - Math.abs(b - jahr) || b - a)
    for (const j of jahre) if ((m = mitten(parcels.filter((p) => p.season_year === j))).length) break
  }
  if (!m.length) return null
  return { lat: median(m.map((x) => x[0])), lng: median(m.map((x) => x[1])) }
}

async function json(url: string, f: Fetch): Promise<unknown | null> {
  let r: Response
  try {
    r = await f(url)
  } catch {
    throw new RegenFehler('graswachstum.ch ist nicht erreichbar.')
  }
  if (r.status === 404 || r.status === 403) return null
  if (!r.ok) throw new RegenFehler(`graswachstum.ch antwortet mit Fehler ${r.status}.`)
  try {
    return await r.json()
  } catch {
    throw new RegenFehler('graswachstum.ch liefert keine lesbaren Daten.')
  }
}

function istIndex(x: unknown): x is RegenIndex {
  const i = x as RegenIndex
  return !!i && [i.x0, i.x1, i.y0, i.y1, i.ncol, i.nrow, i.kachel, i.tage].every((v) => typeof v === 'number') && /^\d{4}-\d{2}-\d{2}$/.test(String(i.start))
}

/** Tageswerte eines Jahres an der Zelle des Standorts holen (zwei kleine Abrufe: Index und eine Kachel). */
export async function regenHolen(jahr: number, lng: number, lat: number, f: Fetch = (u) => fetch(u), jetzt = new Date()): Promise<RegenJahr> {
  const basis = `${REGEN_BASIS}niederschlag_${jahr}/`
  const geholt = jetzt.toISOString()
  const leer = (gitter: RegenGitter | null = null): RegenJahr => ({ fehlt: true, gitter, zelle: null, start: null, mm10: [], geholt })
  const ix = await json(basis + 'index.json', f)
  if (ix == null) return leer()
  if (!istIndex(ix)) throw new RegenFehler('graswachstum.ch liefert ein unbekanntes Format.')
  const gitter: RegenGitter = { x0: ix.x0, x1: ix.x1, y0: ix.y0, y1: ix.y1, ncol: ix.ncol, nrow: ix.nrow }
  const z = zelleFuer(gitter, lng, lat)
  if (!z) return leer(gitter)
  const ka = (await json(`${basis}${Math.floor(z.col / ix.kachel)}_${Math.floor(z.row / ix.kachel)}.json`, f)) as { w?: number; d?: unknown[] } | null
  let v = ka?.d && typeof ka.w === 'number' ? ka.d[(z.row % ix.kachel) * ka.w + (z.col % ix.kachel)] : null
  if (v == null) return { ...leer(gitter), zelle: `${z.col}_${z.row}` }
  if (!Array.isArray(v)) v = [v]
  const mm10 = (v as unknown[]).slice(0, ix.tage).map((x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null))
  return { fehlt: false, gitter, zelle: `${z.col}_${z.row}`, start: ix.start, mm10, geholt }
}

const tagMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))

/** Niederschlag in mm an einem Tag (ISO) aus dem Zwischenspeicher, sonst null. */
export function regenAm(speicher: RegenSpeicher, iso: string): number | null {
  const e = speicher[iso.slice(0, 4)]
  if (!e || e.fehlt || !e.start) return null
  const i = Math.round((tagMs(iso) - tagMs(e.start)) / 86400_000)
  const v = i >= 0 ? e.mm10[i] : null
  return v == null ? null : v / 10
}

/** letzter Tag mit Wert (ISO), z.B. für «Stand 14.11.» */
export function regenStand(e: RegenJahr | undefined): string | null {
  if (!e || e.fehlt || !e.start) return null
  for (let i = e.mm10.length - 1; i >= 0; i--) if (e.mm10[i] != null) return new Date(tagMs(e.start) + i * 86400_000).toISOString().slice(0, 10)
  return null
}

/** Niederschlag eines Tages: von Hand eingetragen geht vor, sonst der automatische Wert; null = keiner. */
export function regenTag(speicher: RegenSpeicher, iso: string, hand: number | null | undefined): { mm: number; vonHand: boolean } | null {
  if (hand != null && Number.isFinite(Number(hand))) return { mm: Number(hand), vonHand: true }
  const a = regenAm(speicher, iso)
  return a == null ? null : { mm: a, vonHand: false }
}

/**
 * Summe über `tage` Tage bis und mit `bis` (je Tag wie regenTag). `fehlen` = Tage ohne Wert (z.B. die letzten zwei Tage,
 * die MeteoSchweiz noch nicht geliefert hat), `auto` = Tage mit automatischem Wert, `letzter` = letzter Tag mit Wert.
 */
export function regenSumme(
  speicher: RegenSpeicher,
  bis: string,
  tage: number,
  hand: (iso: string) => number | null | undefined,
): { mm: number; fehlen: number; auto: number; letzter: string | null } {
  let mm = 0
  let fehlen = 0
  let auto = 0
  let letzter: string | null = null
  for (let i = tage - 1; i >= 0; i--) {
    const iso = new Date(tagMs(bis) - i * 86400_000).toISOString().slice(0, 10)
    const t = regenTag(speicher, iso, hand(iso))
    if (t) {
      mm += t.mm
      if (!t.vonHand) auto++
      letzter = iso
    } else fehlen++
  }
  return { mm: Math.round(mm * 10) / 10, fehlen, auto, letzter }
}

/** Tag mit Niederschlag (wie MeteoSchweiz: ab 1 mm) */
export const REGENTAG_MM = 1

export interface RegenTagZeile {
  datum: string
  mm: number | null
  quelle: 'hand' | 'auto' | null
}

/** Tageswerte eines Jahres bis und mit `bis` (spätere Tage fehlen ohnehin), je Tag wie regenTag. */
export function regenJahr(speicher: RegenSpeicher, jahr: number, bis: string, hand: (iso: string) => number | null | undefined): RegenTagZeile[] {
  const out: RegenTagZeile[] = []
  const ende = Math.min(tagMs(bis), Date.UTC(jahr, 11, 31))
  for (let t = Date.UTC(jahr, 0, 1); t <= ende; t += 86400_000) {
    const datum = new Date(t).toISOString().slice(0, 10)
    const r = regenTag(speicher, datum, hand(datum))
    out.push({ datum, mm: r ? r.mm : null, quelle: r ? (r.vonHand ? 'hand' : 'auto') : null })
  }
  return out
}

export interface RegenMonat {
  /** 1–12 */
  monat: number
  mm: number
  /** Tage ab REGENTAG_MM */
  regentage: number
  /** Tage mit Wert, davon von Hand */
  mitWert: number
  vonHand: number
  /** Tage des Monats bis `bis` */
  tage: number
}

/** Monatssummen aus regenJahr (nur Monate bis `bis`). */
export function regenMonate(zeilen: RegenTagZeile[]): RegenMonat[] {
  const m = new Map<number, RegenMonat>()
  for (const z of zeilen) {
    const k = Number(z.datum.slice(5, 7))
    const e = m.get(k) ?? { monat: k, mm: 0, regentage: 0, mitWert: 0, vonHand: 0, tage: 0 }
    e.tage++
    if (z.mm != null) {
      e.mm += z.mm
      e.mitWert++
      if (z.quelle === 'hand') e.vonHand++
      if (z.mm >= REGENTAG_MM) e.regentage++
    }
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => a.monat - b.monat).map((e) => ({ ...e, mm: Math.round(e.mm * 10) / 10 }))
}

export interface RegenKennzahlen {
  /** Tage im Zeitraum (von–bis) und davon mit Wert */
  tage: number
  mitWert: number
  vonHand: number
  mm: number
  /** Tage ab REGENTAG_MM */
  regentage: number
  /** letzter Tag ab REGENTAG_MM */
  letzterRegen: { datum: string; mm: number } | null
  /** längste Folge von Tagen mit Wert unter REGENTAG_MM (ein Tag ohne Wert unterbricht sie) */
  trocken: { tage: number; von: string; bis: string } | null
  groesster: { datum: string; mm: number } | null
  /** letzter Tag mit Wert */
  letzter: string | null
}

/** Kennzahlen über einen Zeitraum (auch über den Jahreswechsel), je Tag wie regenTag. */
export function regenKennzahlen(speicher: RegenSpeicher, von: string, bis: string, hand: (iso: string) => number | null | undefined): RegenKennzahlen {
  const k: RegenKennzahlen = { tage: 0, mitWert: 0, vonHand: 0, mm: 0, regentage: 0, letzterRegen: null, trocken: null, groesster: null, letzter: null }
  let lauf: { tage: number; von: string; bis: string } | null = null
  for (let t = tagMs(von); t <= tagMs(bis); t += 86400_000) {
    const iso = new Date(t).toISOString().slice(0, 10)
    k.tage++
    const r = regenTag(speicher, iso, hand(iso))
    if (!r) {
      lauf = null
      continue
    }
    k.mitWert++
    if (r.vonHand) k.vonHand++
    k.mm += r.mm
    k.letzter = iso
    if (!k.groesster || r.mm > k.groesster.mm) k.groesster = { datum: iso, mm: r.mm }
    if (r.mm >= REGENTAG_MM) {
      k.regentage++
      k.letzterRegen = { datum: iso, mm: r.mm }
      lauf = null
    } else {
      const neu: { tage: number; von: string; bis: string } = lauf ? { tage: lauf.tage + 1, von: lauf.von, bis: iso } : { tage: 1, von: iso, bis: iso }
      lauf = neu
      if (!k.trocken || neu.tage > k.trocken.tage) k.trocken = { ...neu }
    }
  }
  k.mm = Math.round(k.mm * 10) / 10
  return k
}

/**
 * Regen für Fragen und Steckbrief: automatisch (graswachstum.ch, auf dem Gerät) mit Einträgen von Hand aus der
 * Tagesmeldung; null, wenn es weder das eine noch das andere gibt.
 */
export function regenAusStore(s: Store) {
  const speicher = s.getSetting<RegenSpeicher>(REGEN_KEY, {})
  const hand = new Map(s.rows('daily_farm_log').filter((l) => l.niederschlag_mm != null).map((l) => [l.entry_date, Number(l.niederschlag_mm)]))
  if (!hand.size && !Object.values(speicher).some((e) => !e.fehlt)) return null
  const vonHand = (d: string) => hand.get(d)
  /** Summe über die Tage nach `d` bis und mit `bis`, z.B. «4.2 mm» oder «4.2 mm (bis 14.11.)»; ohne Werte «noch offen» */
  const nach = (d: string, bis: string) => {
    const n = Math.round((tagMs(bis) - tagMs(d)) / 86400_000)
    if (n <= 0) return '0 mm'
    const r = regenSumme(speicher, bis, n, vonHand)
    if (!r.letzter) return 'noch offen'
    return `${fmtRegen(r.mm)} mm${r.fehlen ? ` (bis ${Number(r.letzter.slice(8, 10))}.${Number(r.letzter.slice(5, 7))}.)` : ''}`
  }
  /** Tag `d` plus `n` Tage (ISO) */
  const plus = (d: string, n: number) => new Date(tagMs(d) + n * 86400_000).toISOString().slice(0, 10)
  return { speicher, vonHand, nach, plus, am: (d: string) => regenTag(speicher, d, vonHand(d))?.mm ?? null }
}

/** mm ohne überflüssige Nachkommastelle: 12, 0.4, 13.7 */
export function fmtRegen(mm: number): string {
  return String(Math.round(mm * 10) / 10)
}

/** Muss dieses Jahr (neu) geholt werden? */
export function brauchtAbruf(e: RegenJahr | undefined, jahr: number, ort: { lat: number; lng: number }, jetzt = new Date()): boolean {
  const laufend = jetzt.getFullYear()
  if (jahr > laufend) return false
  if (!e) return true
  // Standort in eine andere Zelle gewandert (Parzellen geändert)
  if (e.gitter) {
    const z = zelleFuer(e.gitter, ort.lng, ort.lat)
    if ((z ? `${z.col}_${z.row}` : null) !== e.zelle) return true
  }
  const alter = jetzt.getTime() - new Date(e.geholt).getTime()
  if (!(alter >= 0)) return true
  if (e.fehlt) return alter > ALTER_FEHLT_MS
  return alter > (jahr === laufend ? ALTER_LAUFEND_MS : ALTER_FRUEHER_MS)
}

export type RegenErgebnis = 'aktuell' | 'geholt' | 'ohne-standort' | 'offline' | 'pause' | 'fehler'

const abrufe = new Map<number, Promise<RegenErgebnis>>()
const fehlerUm = new Map<number, number>()

/**
 * Holt die Regenmengen eines Jahres, wenn nötig, und legt sie im Gerät ab. Still: ohne Netz oder bei Fehlern bleibt der
 * bisherige Stand stehen. Mehrfache Aufrufe gleichzeitig holen nur einmal.
 */
export function regenAktualisieren(s: Store, jahr: number, opts: { fetch?: Fetch; jetzt?: Date; online?: boolean } = {}): Promise<RegenErgebnis> {
  const offen = abrufe.get(jahr)
  if (offen) return offen
  const p = (async (): Promise<RegenErgebnis> => {
    const jetzt = opts.jetzt ?? new Date()
    const ort = standortFuer(s.rows('parcels'), jahr)
    if (!ort) return 'ohne-standort'
    const speicher = s.getSetting<RegenSpeicher>(REGEN_KEY, {})
    if (!brauchtAbruf(speicher[jahr], jahr, ort, jetzt)) return 'aktuell'
    if (!(opts.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false))) return 'offline'
    if (jetzt.getTime() - (fehlerUm.get(jahr) ?? -Infinity) < PAUSE_NACH_FEHLER_MS) return 'pause'
    try {
      const e = await regenHolen(jahr, ort.lng, ort.lat, opts.fetch, jetzt)
      s.setSetting(REGEN_KEY, { ...s.getSetting<RegenSpeicher>(REGEN_KEY, {}), [jahr]: e })
      fehlerUm.delete(jahr)
      return 'geholt'
    } catch {
      fehlerUm.set(jahr, jetzt.getTime())
      return 'fehler'
    }
  })().finally(() => abrufe.delete(jahr))
  abrufe.set(jahr, p)
  return p
}

/** nur für Tests: Fehlerpause vergessen */
export function regenZuruecksetzen(): void {
  fehlerUm.clear()
}
