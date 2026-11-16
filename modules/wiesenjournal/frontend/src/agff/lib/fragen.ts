// Suchen und Fragen (Etappe 6, Skizze B5; Go des Betriebs 16.11.2026): vorbereitete Fragen statt Filterformular. Jede Frage
// ergibt eine Liste mit Sprung zum Steckbrief, als CSV und gedruckt; einige gibt es auch als Chip im Finder (alle Ansichten).
// Nur lesend, aus den Einträgen abgeleitet (mit der Weide aus den Herden).

import type { Store } from '../db/store'
import { num, todayIso, USAGE_TYPE_LABEL, UNIT_LABEL } from './format'
import { nutzungen } from './herden'
import type { Parcel, UsageType } from '../types'
import { fmtRegen, regenAusStore, REGEN_QUELLE, REGENTAG_MM, regenKennzahlen } from './regen'

export type FrageKey = 'duengung' | 'guelle' | 'ungeschnitten' | 'weidetage' | 'ertrag' | 'regen'

export interface Frage {
  key: FrageKey
  titel: string
  text: string
  /** Frage braucht ein Datum «seit …» */
  seit?: boolean
  /** gibt es als Chip im Finder */
  chip?: 'n30' | 'ungeschnitten'
}

export const FRAGEN: Frage[] = [
  { key: 'duengung', titel: 'Wann wurde zuletzt gedüngt?', text: 'Letzte Düngung je Parzelle, die älteste zuerst.', chip: 'n30' },
  { key: 'guelle', titel: 'Alle Güllegaben seit …', text: 'Jede Gabe Gülle mit Menge und m³/ha, die neueste zuerst.', seit: true },
  { key: 'ungeschnitten', titel: 'Was ist noch nicht geschnitten?', text: 'Futterflächen ohne Schnitt im Jahr (Eingrasen, Silage, Dürrfutter).', chip: 'ungeschnitten' },
  { key: 'weidetage', titel: 'Weidetage je Parzelle', text: 'Wie viele Tage jede Parzelle im Jahr beweidet wurde, auch durch Herden.' },
  { key: 'ertrag', titel: 'Wo fehlt der Ertrag?', text: 'Silage und Dürrfutter ohne erfassten Ertrag.' },
  {
    key: 'regen',
    titel: 'Wie viel hat es geregnet seit …?',
    text: 'Summe, Regentage, letzter Regen und längste Trockenzeit am Standort des Betriebs.',
    seit: true,
  },
]

export interface Antwort {
  spalten: string[]
  zeilen: { parcel: Parcel | null; werte: (string | number | null)[]; /** Tage seit (für Farbe und «vor N Tagen») */ alter?: number | null }[]
}

const SCHNITTE: UsageType[] = ['eingrasen', 'silage', 'duerrfutter_bel', 'duerrfutter_unbel']
const ERNTE: UsageType[] = ['silage', 'duerrfutter_bel', 'duerrfutter_unbel']
const tage = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
const datum = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}`
const aren = (p: Parcel) => num(p.area_a) ?? 0
/** Letzte Düngung je Parzelle (auch über Anteile einer Gabe auf mehreren Parzellen) bis heute. */
export function letzteDuengung(s: Store, heute = todayIso()): Map<string, { datum: string; text: string }> {
  const gaben = new Map(s.rows('fertilization_entries').filter((f) => f.entry_date <= heute).map((f) => [f.id, f]))
  const out = new Map<string, { datum: string; text: string }>()
  for (const x of s.rows('fertilization_shares')) {
    const f = gaben.get(x.entry_id)
    if (!f) continue
    const alt = out.get(x.parcel_id)
    if (!alt || f.entry_date > alt.datum) out.set(x.parcel_id, { datum: f.entry_date, text: `${f.code}${f.amount != null ? ` ${Number(f.amount)} ${UNIT_LABEL[f.unit] ?? f.unit}` : ''}` })
  }
  return out
}

/** Parzellen mit einem Schnitt im Jahr bis heute. */
export function geschnitten(s: Store, jahr: number, heute = todayIso()): Set<string> {
  return new Set(s.rows('usage_entries').filter((u) => SCHNITTE.includes(u.usage_type) && u.entry_date.startsWith(String(jahr)) && u.entry_date <= heute).map((u) => u.parcel_id))
}

export function beantworten(s: Store, key: FrageKey, jahr: number, opts: { seit?: string; heute?: string } = {}): Antwort {
  const heute = opts.heute ?? todayIso()
  const parcels = s.rows('parcels').filter((p) => p.season_year === jahr)
  const byId = new Map(parcels.map((p) => [p.id, p]))
  const regen = regenAusStore(s)
  if (key === 'duengung') {
    const l = letzteDuengung(s, heute)
    const zeilen = parcels
      .filter((p) => p.category !== 'andere')
      .map((p) => {
        const d = l.get(p.id)
        const werte: (string | number | null)[] = [p.name, d ? datum(d.datum) : 'noch nie', d ? `vor ${tage(d.datum, heute)} Tagen` : '', d?.text ?? '']
        if (regen) werte.push(d ? regen.nach(d.datum, heute) : '')
        return { parcel: p, werte, alter: d ? tage(d.datum, heute) : null }
      })
      // älteste zuerst; nie gedüngte ganz oben
      .sort((a, b) => (a.alter == null ? -1 : b.alter == null ? 1 : b.alter - a.alter) || a.parcel.name.localeCompare(b.parcel.name, 'de'))
    return { spalten: ['Parzelle', 'zuletzt gedüngt', 'seit', 'was', ...(regen ? ['Regen seither'] : [])], zeilen }
  }
  if (key === 'guelle') {
    const seit = opts.seit ?? `${jahr}-01-01`
    const typen = new Map(s.rows('fertilizer_types').map((t) => [t.id, t]))
    const zeilen: Antwort['zeilen'] = []
    const gaben = s.rows('fertilization_entries').filter((f) => f.entry_date >= seit && f.entry_date <= heute && (typen.get(f.fertilizer_type_id ?? '')?.unit ?? f.unit) === 'm3')
    for (const f of gaben.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))) {
      const anteile = s.rows('fertilization_shares').filter((x) => x.entry_id === f.id)
      const ps = anteile.map((x) => byId.get(x.parcel_id)).filter(Boolean) as Parcel[]
      const ha = anteile.reduce((a, x) => a + (num(x.area_a) ?? 0), 0) / 100
      const menge = f.amount != null ? Number(f.amount) : null
      zeilen.push({
        parcel: ps[0] ?? (f.parcel_id ? (byId.get(f.parcel_id) ?? null) : null),
        werte: [
          datum(f.entry_date),
          ps.map((p) => p.name).join(', ') || '–',
          f.code,
          menge,
          menge != null && ha > 0 ? Math.round((menge / ha) * 10) / 10 : null,
          // Regen am Tag der Gabe und in den 3 Tagen danach (eingewaschen oder abgeschwemmt?)
          ...(regen ? [regen.am(f.entry_date), regen.nach(f.entry_date, regen.plus(f.entry_date, 3))] : []),
        ],
        alter: tage(f.entry_date, heute),
      })
    }
    return { spalten: ['Datum', 'Parzellen', 'Gülle', 'm³', 'm³/ha', ...(regen ? ['Regen mm am Tag', 'Regen 3 Tage danach'] : [])], zeilen }
  }
  if (key === 'ungeschnitten') {
    const g = geschnitten(s, jahr, heute)
    const letzte = new Map<string, string>()
    for (const u of nutzungen(s, `${jahr}-01-01`, heute)) if ((letzte.get(u.parcel_id) ?? '') < u.entry_date) letzte.set(u.parcel_id, `${u.entry_date}|${u.usage_type}`)
    const zeilen = parcels
      .filter((p) => p.category === 'futter' && !g.has(p.id))
      .map((p) => {
        const l = letzte.get(p.id)
        const [d, art] = l ? l.split('|') : [null, null]
        return { parcel: p, werte: [p.name, Math.round(aren(p)), d ? `${USAGE_TYPE_LABEL[art!] ?? art} ${datum(d)}` : 'noch nichts'], alter: d ? tage(d, heute) : null }
      })
      .sort((a, b) => aren(b.parcel!) - aren(a.parcel!))
    return { spalten: ['Parzelle', 'Aren', 'zuletzt im Jahr'], zeilen }
  }
  if (key === 'weidetage') {
    const je = new Map<string, Set<string>>()
    const letzte = new Map<string, string>()
    for (const u of nutzungen(s, `${jahr}-01-01`, heute))
      if (u.usage_type === 'weide') {
        je.set(u.parcel_id, (je.get(u.parcel_id) ?? new Set()).add(u.entry_date))
        if ((letzte.get(u.parcel_id) ?? '') < u.entry_date) letzte.set(u.parcel_id, u.entry_date)
      }
    const zeilen = parcels
      .filter((p) => je.has(p.id))
      .map((p) => ({ parcel: p, werte: [p.name, je.get(p.id)!.size, datum(letzte.get(p.id)!)], alter: tage(letzte.get(p.id)!, heute) }))
      .sort((a, b) => (b.werte[1] as number) - (a.werte[1] as number))
    return { spalten: ['Parzelle', 'Weidetage', 'zuletzt'], zeilen }
  }
  if (key === 'regen') {
    const seit = opts.seit ?? `${jahr}-01-01`
    if (!regen || seit > heute) return { spalten: ['Kennzahl', 'Wert'], zeilen: [] }
    const k = regenKennzahlen(regen.speicher, seit, heute, regen.vonHand)
    if (!k.mitWert) return { spalten: ['Kennzahl', 'Wert'], zeilen: [] }
    const z = (a: string, b: string, alter: number | null = null) => ({ parcel: null, werte: [a, b], alter })
    const kurz = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`
    return {
      spalten: ['Kennzahl', 'Wert'],
      zeilen: [
        z('Niederschlag', `${fmtRegen(k.mm)} mm${k.letzter && k.letzter < heute ? ` (Werte bis ${datum(k.letzter)})` : ''}`),
        z(`Regentage (ab ${REGENTAG_MM} mm)`, `${k.regentage} von ${k.mitWert} Tagen mit Wert`),
        k.letzterRegen
          ? z('Letzter Regen', `vor ${tage(k.letzterRegen.datum, heute)} Tagen, ${datum(k.letzterRegen.datum)} (${fmtRegen(k.letzterRegen.mm)} mm)`, tage(k.letzterRegen.datum, heute))
          : z('Letzter Regen', 'keiner im Zeitraum'),
        z('Längste Trockenzeit', k.trocken ? `${k.trocken.tage} ${k.trocken.tage === 1 ? 'Tag' : 'Tage'}, ${kurz(k.trocken.von)}–${datum(k.trocken.bis)}` : 'keine'),
        z('Grösster Tageswert', k.groesster ? `${fmtRegen(k.groesster.mm)} mm am ${datum(k.groesster.datum)}` : '–'),
        z('Quelle', `${REGEN_QUELLE}${k.vonHand ? `; ${k.vonHand} ${k.vonHand === 1 ? 'Tag' : 'Tage'} von Hand` : ''}`),
      ],
    }
  }
  // ertrag
  const zeilen = s
    .rows('usage_entries')
    .filter((u) => ERNTE.includes(u.usage_type) && u.yield_amount == null && u.entry_date.startsWith(String(jahr)) && u.entry_date <= heute && byId.has(u.parcel_id))
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))
    .map((u) => ({ parcel: byId.get(u.parcel_id)!, werte: [datum(u.entry_date), byId.get(u.parcel_id)!.name, USAGE_TYPE_LABEL[u.usage_type] ?? u.usage_type], alter: tage(u.entry_date, heute) }))
  return { spalten: ['Datum', 'Parzelle', 'Schnitt'], zeilen }
}
