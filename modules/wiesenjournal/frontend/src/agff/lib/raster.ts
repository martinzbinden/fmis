// Raster plus (Etappe 4): Zeitraum, Bereich über mehrere Parzellen und Tage, Leeren, Kopieren/Einfügen, Füllen. Gespeichert
// wird wie bei den Kürzeln (usage_entries, Düngung über deleteFertilizationEntry); jede Aktion liefert ihr Rückgängig.

import type { Store } from '../db/store'
import { addDaysIso } from './format'
import { deleteFertilizationEntry } from './fertilization'
import type { FertilizationEntry, FertilizationShare, UsageEntry } from '../types'

// ---------- Zeitraum ----------

export type Spanne = 'woche' | 'monat' | 'saison'
export const SPANNE_TEXT: Record<Spanne, string> = { woche: 'Woche', monat: 'Monat', saison: 'Saison' }
const SPANNE_KEY = 'journal_raster_spanne'

/** Gewählter Zeitraum dieses Geräts; ohne Wahl am Handy die Woche (E8), am Desktop der Monat. */
export function spanneLesen(breit: boolean): Spanne {
  try {
    const v = localStorage.getItem(SPANNE_KEY)
    if (v === 'woche' || v === 'monat' || v === 'saison') return v
  } catch {
    // ohne Speicher die Vorgabe
  }
  return breit ? 'monat' : 'woche'
}
export function spanneMerken(s: Spanne): void {
  try {
    localStorage.setItem(SPANNE_KEY, s)
  } catch {
    // nur für diese Sitzung
  }
}

/** Zellbreite: Woche = 7 Tage füllen die Breite, Monat = 31 Tage, Saison = schmal (Überblick). */
export function zellbreite(spanne: Spanne, flaeche: number): number {
  if (spanne === 'woche') return Math.max(34, Math.floor(flaeche / 7))
  if (spanne === 'monat') return Math.max(22, Math.floor(flaeche / 31))
  return 14
}

/** Erster Tag des Monats davor bzw. danach (Blättern im Monat). */
export function monatSprung(d: string, richtung: 1 | -1): string {
  const [j, m] = d.split('-').map(Number)
  const n = new Date(Date.UTC(j, m - 1 + richtung, 1))
  return n.toISOString().slice(0, 10)
}

// ---------- Bereich ----------

export interface Bereich {
  pids: string[]
  tage: string[]
}

/** Alle Tage zwischen zwei Daten (beliebige Reihenfolge), aufsteigend. */
export function tageZwischen(a: string, b: string): string[] {
  const [von, bis] = a <= b ? [a, b] : [b, a]
  const out: string[] = []
  for (let d = von; d <= bis; d = addDaysIso(d, 1)) out.push(d)
  return out
}

/** Parzellen zwischen zwei Zeilen in Anzeigereihenfolge. */
export function zeilenZwischen(reihenfolge: string[], a: string, b: string): string[] {
  const i = reihenfolge.indexOf(a)
  const j = reihenfolge.indexOf(b)
  if (i < 0 || j < 0) return [a]
  return reihenfolge.slice(Math.min(i, j), Math.max(i, j) + 1)
}

// ---------- Leeren ----------

/** Gespeicherte Einträge im Bereich löschen (Weide aus Herden bleibt; die übersteuert man mit «nicht hier»). */
export function leeren(s: Store, b: Bereich): { anzahl: number; rueck: () => void } {
  const pids = new Set(b.pids)
  const tage = new Set(b.tage)
  const usage: UsageEntry[] = s.rows('usage_entries').filter((u) => pids.has(u.parcel_id) && tage.has(u.entry_date))
  const fert: FertilizationEntry[] = s.rows('fertilization_entries').filter((f) => f.parcel_id && pids.has(f.parcel_id) && tage.has(f.entry_date))
  const shares: FertilizationShare[] = s.rows('fertilization_shares').filter((x) => fert.some((f) => f.id === x.entry_id))
  s.batch(() => {
    for (const u of usage) s.softDelete('usage_entries', u.id)
    for (const f of fert) deleteFertilizationEntry(s, f.id)
  })
  return {
    anzahl: usage.length + fert.length,
    rueck: () =>
      s.batch(() => {
        for (const u of usage) s.put('usage_entries', { ...u, deleted_at: null })
        for (const f of fert) s.put('fertilization_entries', { ...f, deleted_at: null })
        for (const x of shares) s.put('fertilization_shares', { ...x, deleted_at: null })
      }),
  }
}

// ---------- Kopieren, Einfügen, Füllen ----------

/** Nutzungen einer Zelle als Vorlage (ohne Kennung, Parzelle, Datum). Düngungen kopiert man über den Tagesdialog. */
export type Vorlage = Omit<UsageEntry, 'id' | 'parcel_id' | 'entry_date' | 'updated_at' | 'deleted_at' | 'herde_aufenthalt_id'>[]

export function kopieren(s: Store, pid: string, d: string): Vorlage {
  return s
    .rows('usage_entries')
    .filter((u) => u.parcel_id === pid && u.entry_date === d)
    .map(({ id: _id, parcel_id: _p, entry_date: _d, updated_at: _u, deleted_at: _x, herde_aufenthalt_id: _h, ...rest }) => rest)
}

/** Vorlage in jede Zelle des Bereichs einfügen (zusätzlich zu dem, was dort steht). */
export function einfuegen(s: Store, v: Vorlage, b: Bereich): { anzahl: number; rueck: () => void } {
  const ids: string[] = []
  s.batch(() => {
    for (const pid of b.pids)
      for (const d of b.tage)
        for (const u of v) {
          const id = crypto.randomUUID()
          s.put('usage_entries', { ...u, id, parcel_id: pid, entry_date: d })
          ids.push(id)
        }
  })
  return { anzahl: ids.length, rueck: () => s.batch(() => ids.forEach((id) => s.softDelete('usage_entries', id))) }
}

/** «Wie links» (Ctrl+R): jede Zeile des Bereichs übernimmt die Nutzungen des Tags vor dem Bereich. */
export function fuellen(s: Store, b: Bereich): { anzahl: number; rueck: () => void } {
  const vortag = addDaysIso(b.tage[0], -1)
  const teile = b.pids.map((pid) => einfuegen(s, kopieren(s, pid, vortag), { pids: [pid], tage: b.tage }))
  return { anzahl: teile.reduce((a, t) => a + t.anzahl, 0), rueck: () => teile.forEach((t) => t.rueck()) }
}
