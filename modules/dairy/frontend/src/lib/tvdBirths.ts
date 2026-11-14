// Geburtsmeldung an die TVD (pages/TvdBirths.tsx). FMIS meldet nicht selbst: die Seite bereitet je Nachkomme
// die Angaben vor, die das Agate-Portal verlangt (Ereignisdatum, Ohrmarke, Geschlecht, Rasse, Mutter, Vater,
// Totgeburt, Wurfgrösse), und hält fest, was schon gemeldet ist (birth_offspring.tvd_reported_on, schema/0031).

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import { isoDate } from './format'
import { MARKING_DAYS } from './earTagPending'
import type { Species } from './fertility'
import { loadSireDoubts } from './sireCheck'

export interface TvdLamb {
  id: string
  ear_tag: string | null
  sex: 'w' | 'm' | null
  stillborn: boolean
  /** vor der Ohrmarke verendet (tot geboren oder < 24 h): meist keine Meldung nötig */
  diedUntagged: boolean
  breed: string | null
  reportedOn: string | null
}

export interface TvdBirth {
  id: string
  birth_date: string
  dam_ear_tag: string | null
  dam_lauf_nr: string | null
  dam_name: string | null
  sire: string | null
  /** Vater unklar: keine passende Belegung zur Tragzeit erfasst (lib/sireCheck.ts); wird nicht gemeldet */
  sireDoubt?: boolean
  litter: number
  offspring: TvdLamb[]
}

/** Was mit dem Nachkommen zu tun ist. */
export type LambState = 'offen' | 'gemeldet' | 'ohne_marke' | 'nicht_noetig'

export function lambState(l: TvdLamb): LambState {
  if (l.reportedOn) return 'gemeldet'
  if (!l.ear_tag) return l.diedUntagged ? 'nicht_noetig' : 'ohne_marke'
  return 'offen'
}

/** Meldefrist in Tagen (wie die Markierfrist: Schafe 30, Rinder 20). */
export function deadlineDays(species: 'sheep' | 'cattle'): number {
  return MARKING_DAYS[species]
}

/** Geburten, die per FMIS erfasst wurden (nicht aus dem Herdebuch-Import: die kennt die TVD schon), ab `sinceIso`
 * oder noch mit offenen Nachkommen. Neueste zuerst. */
export async function loadTvdBirths(pg: PGlite, sinceIso: string, species: Species = 'sheep'): Promise<TvdBirth[]> {
  const doubts = await loadSireDoubts(pg, species)
  const { rows } = await pg.query<Record<string, unknown>>(
    `select b.id as birth_id, b.birth_date, b.sire_ear_tag, b.sire_name,
            d.ear_tag as dam_ear_tag, d.lauf_nr as dam_lauf_nr, d.name as dam_name, d.breed_code as dam_breed,
            o.id, o.ear_tag, o.sex, o.stillborn, o.died_24h, o.died_on, o.tvd_reported_on, o.import_key,
            la.breed_code as lamb_breed
     from births b
     join birth_offspring o on o.birth_id = b.id and o.deleted_at is null
     left join animals d on d.id = b.dam_id
     left join animals la on la.ear_tag = o.ear_tag and la.deleted_at is null
     where b.deleted_at is null and b.source = 'manual'
       and (b.birth_date >= $1 or o.tvd_reported_on is null)
     order by b.birth_date desc, b.id, o.import_key`,
    [sinceIso],
  )
  const byBirth = new Map<string, TvdBirth>()
  for (const r of rows) {
    const id = String(r.birth_id)
    let b = byBirth.get(id)
    if (!b) {
      b = {
        id,
        birth_date: isoDate(r.birth_date)!,
        dam_ear_tag: (r.dam_ear_tag as string | null) ?? null,
        dam_lauf_nr: (r.dam_lauf_nr as string | null) ?? null,
        dam_name: (r.dam_name as string | null) ?? null,
        sire: ((r.sire_ear_tag as string | null) || (r.sire_name as string | null)) ?? null,
        sireDoubt: doubts.has(id),
        litter: 0,
        offspring: [],
      }
      byBirth.set(id, b)
    }
    b.offspring.push({
      id: String(r.id),
      ear_tag: (r.ear_tag as string | null) ?? null,
      sex: (r.sex as 'w' | 'm' | null) ?? null,
      stillborn: !!r.stillborn,
      diedUntagged: !r.ear_tag && !!(r.stillborn || r.died_24h || r.died_on),
      breed: ((r.lamb_breed as string | null) || (r.dam_breed as string | null)) ?? null,
      reportedOn: isoDate(r.tvd_reported_on),
    })
    b.litter = b.offspring.length
  }
  // Geburten, deren Nachkommen alle erledigt sind und die vor `sinceIso` liegen, fallen weg
  return [...byBirth.values()].filter((b) => b.birth_date >= sinceIso || b.offspring.some((o) => lambState(o) !== 'gemeldet' && lambState(o) !== 'nicht_noetig'))
}

/** TT.MM.JJJJ aus einem ISO-Datum (das Portal verlangt dieses Format). */
export function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export const COLUMNS = ['Ereignisdatum', 'Ohrmarke', 'Geschlecht', 'Rasse', 'Mutter', 'Vater', 'Totgeburt', 'Wurfgrösse'] as const

/** Die Werte einer Meldungszeile für ein Lamm, in der Reihenfolge von COLUMNS. */
export function lambFields(b: TvdBirth, l: TvdLamb): string[] {
  return [
    ddmmyyyy(b.birth_date),
    l.ear_tag ? (animalKey(l.ear_tag) ?? l.ear_tag) : '',
    l.sex === 'w' ? 'weiblich' : l.sex === 'm' ? 'männlich' : '',
    l.breed ?? '',
    b.dam_ear_tag ? (animalKey(b.dam_ear_tag) ?? b.dam_ear_tag) : '',
    b.sire && !b.sireDoubt ? (animalKey(b.sire) ?? b.sire) : 'unbekannt',
    l.stillborn ? 'ja' : 'nein',
    String(b.litter),
  ]
}

/** Offene Nachkommen mit Ohrmarke einer Geburt: das, was jetzt gemeldet werden kann. */
export function reportable(b: TvdBirth): TvdLamb[] {
  return b.offspring.filter((l) => lambState(l) === 'offen')
}

/** Zum Einfügen (Tabulator getrennt): je Lamm eine Zeile, mit Kopfzeile. */
export function toTabText(births: TvdBirth[]): string {
  const lines = births.flatMap((b) => reportable(b).map((l) => lambFields(b, l).join('\t')))
  return lines.length ? [COLUMNS.join('\t'), ...lines].join('\n') : ''
}

/** CSV für Excel (Semikolon, UTF-8 mit BOM wie die anderen Exporte). */
export function toCsv(births: TvdBirth[]): string {
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = births.flatMap((b) => reportable(b).map((l) => lambFields(b, l).map(cell).join(';')))
  return '﻿' + [COLUMNS.join(';'), ...lines].join('\r\n')
}

/** Tage seit der Geburt; negativ, falls das Datum in der Zukunft liegt. */
export function ageDays(birthIso: string, todayIso: string): number {
  return Math.round((Date.parse(todayIso) - Date.parse(birthIso)) / 86_400_000)
}

/** Frist-Ampel: überfällig, bald (noch ≤ 7 Tage) oder in Ordnung. */
export function deadlineTone(age: number, deadline: number): 'over' | 'soon' | 'ok' {
  return age > deadline ? 'over' : age > deadline - 7 ? 'soon' : 'ok'
}

/** Nachkommen als gemeldet abhaken (date) oder die Markierung zurücknehmen (null). */
export async function markReported(pg: PGlite, offspringIds: string[], date: string | null): Promise<void> {
  for (const id of offspringIds) {
    const { rows } = await pg.query<Record<string, unknown>>('select * from birth_offspring where id = $1', [id])
    if (!rows[0]) continue
    await upsertRow(pg, 'birth_offspring', { ...rows[0], id, tvd_reported_on: date } as never)
  }
}
