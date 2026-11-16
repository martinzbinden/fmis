// Weide/Auslauf-Automatik auf «Heute» (Wunsch des Betriebs 16.11.2026): «trägt vor, was möglich ist, fragt das Nötigste,
// lässt Parzellen bestätigen». Hergeleitet aus vorhandenen Bausteinen, nichts Neues gespeichert, bevor man bestätigt:
// - Herden: wo sie heute laut Aufenthalt sind, sonst wo sie gestern waren (weiterführen);
// - Weide von Hand von gestern, die heute fehlt (wie gestern), mit Tieren und laufender Dauer;
// - Laufhof je Kategorie: von Hand gestern gesetzt → vorschlagen; sonst die Automatik (X auf der Weide, L/0 aus dem
//   Stall); nur wo nichts herzuleiten ist, wird gefragt.
// Speichern über umziehen(), schnellErfassen(), laufhofSetzen(), mit einem gemeinsamen Rückgängig.

import type { Store } from '../db/store'
import { addDaysIso, ANIMAL_CATEGORY_LABEL } from './format'
import { aufenthaltAm, herdenListe, herdenStand, herdenZuruecksetzen, nutzungen, stallAuslauf, umziehen, type Ziel } from './herden'
import { laufhofSetzen } from './laufhof'
import { KUERZEL, rueckgaengig, schnellErfassen, type Tiere } from './schnell'
import { laufhofGestern, wieGestern } from './tageskarte'
import type { AnimalCategory, DailyFarmLog, Herde, HerdenAufenthalt, LaufhofWert, Parcel } from '../types'

export type HerdeEntscheid = { art: 'bleibt' } | { art: 'weide'; parcel_id: string } | { art: 'stall'; auslauf: 'L' | '0' }

export interface HerdenZeile {
  herde: Herde
  /** Aufenthalt heute; null: heute noch nichts erfasst (dann `gestern`) */
  heute: HerdenAufenthalt | null
  gestern: HerdenAufenthalt | null
  /** Tage am selben Ort bis heute */
  seit: number
}

export interface WeideZeile {
  key: string
  parcel: Parcel
  tiere: Tiere
  /** Weidetage am Stück bis gestern */
  tage: number
}

export interface LaufhofZeile {
  kategorie: AnimalCategory
  /** von Hand gesetzt (heute) – dann nichts zu tun */
  heute: LaufhofWert
  /** Vorschlag: zu setzender Wert (null = Automatik) */
  vorschlag: LaufhofWert
  /** was die Automatik heute zeigt bzw. zeigen wird */
  anzeige: 'X' | 'L' | '0' | ''
  quelle: 'gesetzt' | 'gestern' | 'weide' | 'stall' | 'frage'
}

export interface Automatik {
  datum: string
  herden: HerdenZeile[]
  weiden: WeideZeile[]
  laufhof: LaufhofZeile[]
}

const tageZwischen = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

/** Vorschlag für den Tag aus Herden, «wie gestern» und Laufhof-Automatik. */
export function automatikVorschlag(s: Store, datum: string, parcels: Parcel[], kategorien: readonly AnimalCategory[]): Automatik {
  const gestern = addDaysIso(datum, -1)
  const herden: HerdenZeile[] = herdenListe(s)
    .filter((h) => h.aktiv)
    .map((h) => {
      const heute = aufenthaltAm(s, h.id, datum)
      const gest = aufenthaltAm(s, h.id, gestern)
      const a = heute ?? gest
      return { herde: h, heute, gestern: gest, seit: a ? tageZwischen(a.von, datum) + 1 : 0 }
    })
    .filter((z) => z.heute || z.gestern)

  // Weide von Hand von gestern, die heute fehlt; Dauer = Tage am Stück mit derselben Tierart
  const weiden: WeideZeile[] = wieGestern(s, datum, parcels)
    .filter((v) => v.kuerzel.key === 'X' && v.tiere)
    .map((v) => {
      let n = 0
      for (let d = gestern; n < 400; d = addDaysIso(d, -1)) {
        const da = s.rows('usage_entries').some((u) => u.parcel_id === v.parcel.id && u.entry_date === d && u.usage_type === 'weide' && u.animal_category === v.tiere!.animal_category)
        if (!da) break
        n++
      }
      return { key: v.key, parcel: v.parcel, tiere: v.tiere!, tage: n }
    })

  // Laufhof: heute von Hand gesetzt bleibt; sonst gestern von Hand gesetzt; sonst Automatik (Weide heute bzw. vorgeschlagen,
  // Herde im Stall); sonst fragen
  const log = s.rows('daily_farm_log').find((l) => l.entry_date === datum)
  const gestrig = new Map(laufhofGestern(s, datum, kategorien).map((l) => [l.kategorie, l.wert]))
  const weideHeute = new Set(nutzungen(s, datum, datum).filter((u) => u.usage_type === 'weide' && u.animal_category).map((u) => u.animal_category!))
  for (const w of weiden) weideHeute.add(w.tiere.animal_category)
  for (const z of herden) if (!z.heute && z.gestern?.ort === 'weide') weideHeute.add(z.herde.kategorie)
  const stall = stallAuslauf(s, datum, datum).get(datum) ?? new Map<AnimalCategory, 'L' | '0'>()
  for (const z of herden) if (!z.heute && z.gestern?.ort === 'stall' && z.gestern.auslauf) stall.set(z.herde.kategorie, z.gestern.auslauf)
  const laufhof: LaufhofZeile[] = kategorien.map((k) => {
    const gesetzt = (log?.[`laufhof_${k}` as keyof DailyFarmLog] ?? null) as LaufhofWert
    if (gesetzt) return { kategorie: k, heute: gesetzt, vorschlag: gesetzt, anzeige: gesetzt, quelle: 'gesetzt' }
    const g = gestrig.get(k)
    if (g) return { kategorie: k, heute: null, vorschlag: g, anzeige: g, quelle: 'gestern' }
    if (weideHeute.has(k)) return { kategorie: k, heute: null, vorschlag: null, anzeige: 'X', quelle: 'weide' }
    const st = stall.get(k)
    if (st) return { kategorie: k, heute: null, vorschlag: null, anzeige: st, quelle: 'stall' }
    return { kategorie: k, heute: null, vorschlag: null, anzeige: '', quelle: 'frage' }
  })
  return { datum, herden, weiden, laufhof }
}

export interface AutomatikWahl {
  herden: Record<string, HerdeEntscheid>
  /** je Weide-Vorschlag: übernehmen (mit allenfalls geänderter Parzelle bzw. Anzahl) oder nicht */
  weiden: Record<string, { an: boolean; parcel: Parcel; tiere: Tiere }>
  /** je Kategorie der zu setzende Wert (null = Automatik); fehlt = nichts ändern */
  laufhof: Partial<Record<AnimalCategory, LaufhofWert>>
}

/** Vorgabe: alles übernehmen, wie vorgeschlagen. */
export function vorgabeWahl(a: Automatik): AutomatikWahl {
  return {
    herden: Object.fromEntries(a.herden.map((z) => [z.herde.id, { art: 'bleibt' } as HerdeEntscheid])),
    weiden: Object.fromEntries(a.weiden.map((w) => [w.key, { an: true, parcel: w.parcel, tiere: w.tiere }])),
    laufhof: Object.fromEntries(a.laufhof.filter((l) => l.quelle === 'gestern').map((l) => [l.kategorie, l.vorschlag])),
  }
}

/** Bestätigte Wahl speichern; ein Rückgängig für alles. */
export function automatikSpeichern(s: Store, a: Automatik, w: AutomatikWahl): { text: string; rueck: () => void; anzahl: number } {
  const herdenIds = a.herden.map((z) => z.herde.id)
  const stand = herdenStand(s, herdenIds)
  const log = s.rows('daily_farm_log').find((l) => l.entry_date === a.datum)
  const laufhofVorher = new Map(a.laufhof.map((l) => [l.kategorie, (log?.[`laufhof_${l.kategorie}` as keyof DailyFarmLog] ?? null) as LaufhofWert]))
  const teile: string[] = []
  const erfasst = s.batch(() => {
    let umgezogen = 0
    for (const z of a.herden) {
      const e = w.herden[z.herde.id] ?? { art: 'bleibt' }
      let ziel: Ziel | null = null
      if (e.art === 'weide') ziel = { ort: 'weide', parcel_id: e.parcel_id }
      else if (e.art === 'stall') ziel = { ort: 'stall', auslauf: e.auslauf }
      else if (!z.heute && z.gestern) ziel = z.gestern.ort === 'weide' ? { ort: 'weide', parcel_id: z.gestern.parcel_id!, tagweide: z.gestern.tagweide } : { ort: 'stall', auslauf: z.gestern.auslauf ?? 'L' }
      if (ziel) {
        umziehen(s, [z.herde.id], ziel, a.datum)
        umgezogen++
      }
    }
    if (umgezogen) teile.push(`${umgezogen} ${umgezogen === 1 ? 'Herde' : 'Herden'}`)
    const neu = a.weiden.flatMap((v) => {
      const x = w.weiden[v.key]
      return x?.an ? schnellErfassen(s, x.parcel, [a.datum], KUERZEL[0], { tiere: x.tiere }) : []
    })
    if (neu.length) teile.push(`${neu.length} ${neu.length === 1 ? 'Weide' : 'Weiden'}`)
    let lh = 0
    for (const [k, v] of Object.entries(w.laufhof) as [AnimalCategory, LaufhofWert][]) {
      if ((laufhofVorher.get(k) ?? null) === v) continue
      laufhofSetzen(s, a.datum, k, v)
      lh++
      teile.push(`Laufhof ${ANIMAL_CATEGORY_LABEL[k]} ${v ?? 'auto'}`)
    }
    return { neu, lh, umgezogen }
  })
  return {
    anzahl: erfasst.neu.length + erfasst.lh + erfasst.umgezogen,
    text: teile.length ? `Weide/Auslauf: ${teile.join(', ')}` : 'Weide/Auslauf: alles wie erfasst',
    rueck: () =>
      s.batch(() => {
        rueckgaengig(s, erfasst.neu)
        if (erfasst.umgezogen) herdenZuruecksetzen(s, herdenIds, stand)
        for (const [k] of Object.entries(w.laufhof) as [AnimalCategory, LaufhofWert][]) {
          const vorher = laufhofVorher.get(k) ?? null
          laufhofSetzen(s, a.datum, k, vorher)
        }
      }),
  }
}
