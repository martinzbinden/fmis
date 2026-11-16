// Drei Ansichten (Etappe 2, Entscheid des Betriebs 15.11.2026): «Heute» (B), «Raster» (A), «Jahr» (C). Jede ist vollwertig; die
// Startansicht wählt man je Gerät (localStorage), Vorgabe am Handy «Heute», am Desktop «Raster». Die anderen sind mit einem
// Tipp erreichbar (Umschalter oben, Menü unten). Der Tag, auf dem man steht, gilt in allen drei Ansichten (Sitzung).

import { todayIso } from './format'

export type Ansicht = 'heute' | 'raster' | 'jahr'

export const ANSICHTEN: { key: Ansicht; label: string; icon: string; pfad: string; text: string }[] = [
  { key: 'heute', label: 'Heute', icon: '☀️', pfad: '/tag', text: 'Ein Tag mit Herden, Laufhof und «wie gestern»; Tätigkeiten mit einem Tipp. Für unterwegs am Handy.' },
  { key: 'raster', label: 'Raster', icon: '📅', pfad: '/raster', text: 'Alle Parzellen und Tage als Tabelle, Eintragen mit Kürzeln. Am schnellsten mit Maus und Tastatur.' },
  { key: 'jahr', label: 'Jahr', icon: '🗓️', pfad: '/jahr', text: 'Das ganze Jahr auf einem Blatt, Wochen als Spalten. Zum Überblicken und Kontrollieren.' },
]

const START = 'journal_startansicht'
const GEFRAGT = 'journal_startansicht_gefragt'
const TAG = 'journal_tag'

function lesen(k: string, speicher: () => Storage = () => localStorage): string | null {
  try {
    return speicher().getItem(k)
  } catch {
    return null
  }
}
function schreiben(k: string, v: string, speicher: () => Storage = () => localStorage) {
  try {
    speicher().setItem(k, v)
  } catch {
    // ohne Speicher gilt die Vorgabe
  }
}

/** Vorgabe nach Bildschirm: ab 1024 px (Desktop-Menü) das Raster, sonst Heute. */
export function vorgabeAnsicht(breit = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches): Ansicht {
  return breit ? 'raster' : 'heute'
}

const istAnsicht = (v: unknown): v is Ansicht => v === 'heute' || v === 'raster' || v === 'jahr'

export function startAnsicht(): Ansicht {
  const v = lesen(START)
  return istAnsicht(v) ? v : vorgabeAnsicht()
}

export function startAnsichtSetzen(a: Ansicht): void {
  schreiben(START, a)
  schreiben(GEFRAGT, '1')
  hoerer.forEach((h) => h())
}

/** Beim ersten Start einmal nach der Startansicht fragen. */
export const startGefragt = () => lesen(GEFRAGT) === '1'
export function startFrageSchliessen(): void {
  schreiben(GEFRAGT, '1')
  hoerer.forEach((h) => h())
}

/** Ansichten in Menü-Reihenfolge: die Startansicht zuerst, die übrigen in fester Reihenfolge. */
export function ansichtenReihenfolge(start = startAnsicht()) {
  return [...ANSICHTEN].sort((a, b) => (a.key === start ? -1 : b.key === start ? 1 : 0))
}

// ---------- gemeinsamer Tag ----------

const hoerer = new Set<() => void>()
export function ansichtAbonnieren(h: () => void): () => void {
  hoerer.add(h)
  return () => hoerer.delete(h)
}

/** Tag, auf dem man in den Ansichten steht (Sitzung); ohne Wahl heute. */
export function gemeinsamerTag(): string {
  const v = lesen(TAG, () => sessionStorage)
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayIso()
}

export function gemeinsamerTagSetzen(d: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d === lesen(TAG, () => sessionStorage)) return
  schreiben(TAG, d, () => sessionStorage)
  hoerer.forEach((h) => h())
}

/** Pfad einer Ansicht zum gemeinsamen Tag. */
export function ansichtPfad(a: Ansicht, tag = gemeinsamerTag()): string {
  if (a === 'heute') return tag === todayIso() ? '/tag' : `/tag/${tag}`
  return a === 'raster' ? '/raster' : '/jahr'
}

/** ISO-Woche (Montag als erster Tag) eines Datums: [Jahr, Woche]. */
export function isoWoche(iso: string): [number, number] {
  const d = new Date(`${iso}T12:00:00Z`)
  const tag = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - tag + 3) // Donnerstag derselben Woche
  const jahr = d.getUTCFullYear()
  const erster = new Date(Date.UTC(jahr, 0, 4))
  const woche = 1 + Math.round(((d.getTime() - erster.getTime()) / 86400000 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7)
  return [jahr, woche]
}

/** Montag der Woche eines Datums. */
export function montag(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
