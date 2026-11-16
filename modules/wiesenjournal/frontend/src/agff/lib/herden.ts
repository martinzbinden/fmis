// Herden und ihre Aufenthalte (Etappe «Herde zieht um», Konzept docs/konzept-herden.md). Die Weide im Journal wird aus
// den Aufenthalten abgeleitet, nicht je Tag gespeichert – wie im FMIS (herdModel.ts derivedWeideEntries).

import type { Store } from '../db/store'
import { addDaysIso, ANIMAL_CATEGORY_LABEL, todayIso } from './format'
import type { AnimalCategory, Herde, HerdenAufenthalt, UsageEntry } from '../types'

export type Ziel = { ort: 'weide'; parcel_id: string; tagweide?: boolean } | { ort: 'stall'; auslauf: 'L' | '0' }

const tage = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
const gilt = (a: HerdenAufenthalt, d: string) => a.von <= d && (a.bis == null || d <= a.bis)

export function herdenListe(s: Store): Herde[] {
  return s.rows('herden').sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de'))
}

export function aufenthalte(s: Store, herdeId: string): HerdenAufenthalt[] {
  return s
    .rows('herden_aufenthalte')
    .filter((a) => a.herde_id === herdeId)
    .sort((a, b) => (a.von < b.von ? -1 : 1))
}

/** Aufenthalt am Tag (oder null, wenn die Herde an dem Tag nirgends erfasst ist). */
export function aufenthaltAm(s: Store, herdeId: string, datum: string): HerdenAufenthalt | null {
  return aufenthalte(s, herdeId).find((a) => gilt(a, datum)) ?? null
}

export function herdeAnlegen(
  s: Store,
  h: { name: string; kategorie: AnimalCategory; anzahl: number | null; notes?: string | null },
  start: Ziel,
  von: string,
): string {
  const id = crypto.randomUUID()
  s.batch(() => {
    s.put('herden', { id, name: h.name.trim(), kategorie: h.kategorie, anzahl: h.anzahl, notes: h.notes ?? null, sort_order: s.rows('herden').length })
    aufenthaltSetzen(s, id, start, von, null)
  })
  return id
}

function aufenthaltSetzen(s: Store, herdeId: string, z: Ziel, von: string, bis: string | null) {
  s.put('herden_aufenthalte', {
    id: crypto.randomUUID(),
    herde_id: herdeId,
    ort: z.ort,
    parcel_id: z.ort === 'weide' ? z.parcel_id : null,
    auslauf: z.ort === 'stall' ? z.auslauf : null,
    tagweide: z.ort === 'weide' ? !!z.tagweide : false,
    von,
    bis,
  })
}

/**
 * Herde zieht am `datum` um (auch einstallen, austreiben). Der bisherige Aufenthalt endet gestern – oder heute, wenn die
 * Herde heute noch auf beiden ist. Liegt ein späterer Aufenthalt schon vor (Nachtrag), endet der neue davor.
 */
export function umziehen(s: Store, herdeIds: string[], ziel: Ziel, datum: string, heuteAufBeiden = false): void {
  s.batch(() => {
    for (const hid of herdeIds) {
      const liste = aufenthalte(s, hid)
      const alt = liste.find((a) => gilt(a, datum))
      if (alt) {
        const ende = heuteAufBeiden ? datum : addDaysIso(datum, -1)
        if (ende < alt.von) s.softDelete('herden_aufenthalte', alt.id)
        else s.put('herden_aufenthalte', { id: alt.id, bis: ende })
      }
      const naechster = liste.find((a) => a.von > datum && a.id !== alt?.id)
      const bisAlt = alt?.bis != null && alt.bis > datum ? alt.bis : null
      aufenthaltSetzen(s, hid, ziel, datum, naechster ? addDaysIso(naechster.von, -1) : bisAlt)
    }
  })
}

/** Einzelne Tage übersteuern: die Herde war von `a` bis `b` nicht hier. Teilt den Aufenthalt (keine Ausnahme-Tabelle). */
export function nichtHier(s: Store, aufenthaltId: string, a: string, b: string): void {
  const x = s.get('herden_aufenthalte', aufenthaltId)
  if (!x) return
  const [von, bis] = a <= b ? [a, b] : [b, a]
  s.batch(() => {
    const vorher = von > x.von
    const nachher = x.bis == null || bis < x.bis
    if (!vorher && !nachher) return s.softDelete('herden_aufenthalte', x.id)
    if (vorher && nachher) {
      s.put('herden_aufenthalte', { id: x.id, bis: addDaysIso(von, -1) })
      s.put('herden_aufenthalte', { ...x, id: crypto.randomUUID(), von: addDaysIso(bis, 1), bis: x.bis })
    } else if (vorher) s.put('herden_aufenthalte', { id: x.id, bis: addDaysIso(von, -1) })
    else s.put('herden_aufenthalte', { id: x.id, von: addDaysIso(bis, 1) })
  })
}

/** Weide aus den Herden als Nutzungen (nicht gespeichert); offene Aufenthalte zählen bis `bisHeute`, nie in die Zukunft. */
export function weideAusHerden(s: Store, von: string, bis: string, bisHeute = todayIso()): UsageEntry[] {
  const herden = new Map(s.rows('herden').map((h) => [h.id, h]))
  const out: UsageEntry[] = []
  for (const a of s.rows('herden_aufenthalte')) {
    if (a.ort !== 'weide' || !a.parcel_id) continue
    const h = herden.get(a.herde_id)
    if (!h) continue
    const ende = [a.bis ?? bisHeute, bis].sort()[0]
    for (let d = a.von > von ? a.von : von; d <= ende; d = addDaysIso(d, 1))
      out.push({
        id: `herde:${a.id}:${d}`,
        parcel_id: a.parcel_id,
        entry_date: d,
        usage_type: 'weide',
        animal_category: h.kategorie,
        herde_aufenthalt_id: a.id,
        day_only: a.tagweide,
        animal_count: h.anzahl,
        animal_group: h.name,
        label: null,
        value_num: null,
        yield_amount: null,
        yield_unit: null,
        notes: null,
        updated_at: a.updated_at,
        deleted_at: null,
      })
  }
  return out
}

/** Laufhof auto aus Stall-Aufenthalten: je Tag und Kategorie L (mit Laufhof) oder 0 (ohne Auslauf). */
export function stallAuslauf(s: Store, von: string, bis: string, bisHeute = todayIso()): Map<string, Map<AnimalCategory, 'L' | '0'>> {
  const herden = new Map(s.rows('herden').map((h) => [h.id, h]))
  const m = new Map<string, Map<AnimalCategory, 'L' | '0'>>()
  for (const a of s.rows('herden_aufenthalte')) {
    if (a.ort !== 'stall' || !a.auslauf) continue
    const h = herden.get(a.herde_id)
    if (!h) continue
    const ende = [a.bis ?? bisHeute, bis].sort()[0]
    for (let d = a.von > von ? a.von : von; d <= ende; d = addDaysIso(d, 1)) {
      const t = m.get(d) ?? new Map<AnimalCategory, 'L' | '0'>()
      // mehrere Herden derselben Kategorie: L geht vor 0 (mindestens ein Teil hat Auslauf)
      if (t.get(h.kategorie) !== 'L') t.set(h.kategorie, a.auslauf)
      m.set(d, t)
    }
  }
  return m
}

/** Gespeicherte Nutzungen plus Weide aus Herden; eine von Hand erfasste Weide gleicher Parzelle, Tag und Kategorie geht vor. */
export function nutzungen(s: Store, von: string, bis: string): UsageEntry[] {
  const gespeichert = s.rows('usage_entries').filter((u) => u.entry_date >= von && u.entry_date <= bis)
  const hand = new Set(gespeichert.filter((u) => u.usage_type === 'weide').map((u) => `${u.parcel_id}|${u.entry_date}|${u.animal_category}`))
  return [...gespeichert, ...weideAusHerden(s, von, bis).filter((u) => !hand.has(`${u.parcel_id}|${u.entry_date}|${u.animal_category}`))]
}

/** «Rain · seit 6.5. (4. Tag)» / «Stall mit Laufhof · seit 12.11.» */
export function ortText(s: Store, a: HerdenAufenthalt | null, datum: string): string {
  if (!a) return 'nicht erfasst'
  const wo = a.ort === 'stall' ? (a.auslauf === '0' ? 'Stall, ohne Auslauf' : 'Stall mit Laufhof') : (s.get('parcels', a.parcel_id ?? '')?.name ?? 'Parzelle?')
  const n = tage(a.von, datum) + 1
  const dm = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.`
  return `${wo} · seit ${dm(a.von)}${n > 1 ? ` (${n}. Tag)` : ''}${a.bis && a.bis < datum ? ` bis ${dm(a.bis)}` : ''}`
}

export const herdeText = (h: Herde) => `${h.name} · ${h.anzahl ? `${h.anzahl} ` : ''}${ANIMAL_CATEGORY_LABEL[h.kategorie]}`

/** Stand der Aufenthalte einer oder mehrerer Herden – für «Rückgängig». */
export function herdenStand(s: Store, herdeIds: string[]): HerdenAufenthalt[] {
  return s.rows('herden_aufenthalte').filter((a) => herdeIds.includes(a.herde_id))
}

/** Aufenthalte auf einen früheren Stand zurücksetzen (neue löschen, alte wiederherstellen). */
export function herdenZuruecksetzen(s: Store, herdeIds: string[], stand: HerdenAufenthalt[]): void {
  const alt = new Set(stand.map((a) => a.id))
  s.batch(() => {
    for (const a of s.rows('herden_aufenthalte')) if (herdeIds.includes(a.herde_id) && !alt.has(a.id)) s.softDelete('herden_aufenthalte', a.id)
    for (const a of stand) s.put('herden_aufenthalte', { ...a, deleted_at: null })
  })
}

/** Herde samt Aufenthalten löschen (weich); die abgeleitete Weide verschwindet damit aus dem Journal. */
export function herdeLoeschen(s: Store, herdeId: string): void {
  s.batch(() => {
    for (const a of s.rows('herden_aufenthalte')) if (a.herde_id === herdeId) s.softDelete('herden_aufenthalte', a.id)
    s.softDelete('herden', herdeId)
  })
}
