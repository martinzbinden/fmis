// Formeln im Suchfeld der Mast-Tierliste (pages/Animals.tsx): Felder der Tierzeilen (core/frontend/src/query/engine.ts).

import type { QueryField } from '@fmis/core/query/engine'

export interface MastRow {
  id: string
  ear_tag: string
  status: string
  birth_date: string | null
  last_weight: unknown
  group_name: string | null
}
export interface MastQueryContext {
  today: string
}

const DAY = 86_400_000
const weight = (r: MastRow) => (r.last_weight == null || r.last_weight === '' ? null : Number(r.last_weight))

export const MAST_QUERY_FIELDS: QueryField<MastRow, MastQueryContext>[] = [
  {
    kind: 'num',
    key: 'alter',
    label: 'Alter',
    unit: 'Monate',
    aliases: ['alter'],
    example: 'Alter > 8 Mt',
    get: (r, c) => (r.birth_date ? (Date.parse(`${c.today}T00:00:00Z`) - Date.parse(`${r.birth_date.slice(0, 10)}T00:00:00Z`)) / DAY / 30.4375 : null),
    units: { j: 12, jahr: 12, jahre: 12, m: 1, mt: 1, monat: 1, monate: 1, t: 1 / 30.4375, tag: 1 / 30.4375, tage: 1 / 30.4375 },
    defaultUnit: 'mt',
  },
  { kind: 'num', key: 'gewicht', label: 'Letztes Gewicht', unit: 'kg', aliases: ['gewicht', 'kg'], example: 'Gewicht > 35', get: (r) => weight(r) },
  { kind: 'flag', key: 'aktiv', label: 'aktiv', aliases: ['aktiv'], test: (r) => r.status === 'aktiv' },
  { kind: 'flag', key: 'geschlachtet', label: 'geschlachtet', aliases: ['geschlachtet'], test: (r) => r.status === 'geschlachtet' },
  { kind: 'flag', key: 'verkauft', label: 'verkauft', aliases: ['verkauft'], test: (r) => r.status === 'verkauft' },
  { kind: 'flag', key: 'verendet', label: 'verendet', aliases: ['verendet'], test: (r) => r.status === 'verendet' },
  { kind: 'flag', key: 'ohnegruppe', label: 'ohne Gruppe', aliases: ['ohnegruppe'], test: (r) => !r.group_name },
  { kind: 'choice', key: 'gruppe', label: 'Gruppe', aliases: ['gruppe'], options: (r) => [r.group_name ?? ''] },
]

export const MAST_EXAMPLES = [
  { q: 'Gewicht > 35', text: 'letztes Gewicht über 35 kg' },
  { q: 'Alter > 8 Mt und aktiv', text: 'über 8 Monate alt und im Bestand' },
  { q: 'Gruppe = Mast', text: 'Tiere einer Gruppe (der Anfang des Namens genügt)' },
  { q: 'ohne Gruppe', text: 'Tiere ohne Gruppe' },
  { q: '456', text: 'Ohrmarke enthält «456»' },
]

export const MAST_SORTS = [
  { key: 'tag', label: 'Ohrmarke' },
  { key: 'alter', label: 'Alter (älteste zuerst)' },
  { key: 'gewicht', label: 'Gewicht (schwerste zuerst)' },
]

export function sortMast<T extends MastRow>(rows: T[], key: string): T[] {
  const out = [...rows]
  if (key === 'alter') return out.sort((a, b) => (a.birth_date ?? '9999').localeCompare(b.birth_date ?? '9999'))
  if (key === 'gewicht') return out.sort((a, b) => (weight(b) ?? -1) - (weight(a) ?? -1))
  return out.sort((a, b) => a.ear_tag.localeCompare(b.ear_tag))
}
