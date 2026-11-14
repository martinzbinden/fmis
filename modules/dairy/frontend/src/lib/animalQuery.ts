// Formeln im Suchfeld der Tierliste (pages/Animals.tsx): Felder der Tierzeilen, siehe core/frontend/src/query/engine.ts.

import type { QueryField } from '@fmis/core/query/engine'
import type { AnimalRow } from '../components/AnimalTable'
import type { AnimalFacts } from './animalSort'

export interface AnimalQueryContext {
  today: string
  facts: Map<string, AnimalFacts> | undefined
  /** Mutter-ID → Anzahl saugende Junge */
  nursing: ReadonlyMap<string, number>
}

const DAY = 86_400_000
const daysSince = (iso: string | null | undefined, today: string) => (iso ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)) / DAY) : null)

export const ANIMAL_QUERY_FIELDS: QueryField<AnimalRow, AnimalQueryContext>[] = [
  {
    kind: 'num',
    key: 'alter',
    label: 'Alter',
    unit: 'Jahre',
    aliases: ['alter'],
    example: 'Alter > 6 J',
    get: (a, c) => {
      const d = daysSince(a.birth_date, c.today)
      return d == null ? null : d / 365.25
    },
    units: { j: 1, jahr: 1, jahre: 1, m: 1 / 12, mt: 1 / 12, monat: 1 / 12, monate: 1 / 12, t: 1 / 365.25, tag: 1 / 365.25, tage: 1 / 365.25 },
    defaultUnit: 'j',
  },
  { kind: 'num', key: 'inzucht', label: 'Inzuchtkoeffizient', unit: '%', aliases: ['inzucht', 'inzuchtkoeffizient'], example: 'Inzucht > 6', get: (a) => (a.inbreeding == null ? null : a.inbreeding * 100) },
  { kind: 'num', key: 'tests', label: 'Anzahl Milchproben', unit: '', aliases: ['milchproben', 'proben', 'tests'], example: 'Proben >= 5', get: (a) => a.milk_test_count },
  { kind: 'num', key: 'journal', label: 'Anzahl Journal-Einträge', unit: '', aliases: ['journal', 'eintraege', 'journaleintraege'], example: 'Journal > 0', get: (a) => a.journal_count },
  { kind: 'num', key: 'tagegeburt', label: 'Tage seit der letzten Geburt', unit: 'Tage', aliases: ['tageseitgeburt', 'tageseitablammung', 'tageseitabkalbung', 'tsg'], example: 'Tage seit Geburt > 60', get: (a, c) => daysSince(c.facts?.get(a.id)?.last_birth, c.today) },
  { kind: 'num', key: 'tagebehandlung', label: 'Tage seit der letzten Behandlung', unit: 'Tage', aliases: ['tageseitbehandlung', 'tsb'], example: 'Tage seit Behandlung < 14', get: (a, c) => daysSince(c.facts?.get(a.id)?.last_treatment, c.today) },
  { kind: 'num', key: 'saugend', label: 'Saugende Junge', unit: 'Anzahl', aliases: ['saugend', 'saugende', 'laemmer', 'kaelber'], example: 'Lämmer >= 2', get: (a, c) => c.nursing.get(a.id) ?? 0 },
  { kind: 'flag', key: 'trocken', label: 'trocken', aliases: ['trocken', 'galt'], test: (a) => !!a.dry },
  { kind: 'flag', key: 'weiblich', label: 'weiblich', aliases: ['weiblich'], test: (a) => a.sex === 'w' },
  { kind: 'flag', key: 'maennlich', label: 'männlich', aliases: ['maennlich', 'widder', 'stier'], test: (a) => a.sex === 'm' },
  { kind: 'flag', key: 'aktiv', label: 'aktiv (im Bestand)', aliases: ['aktiv'], test: (a) => a.status === 'aktiv' },
  { kind: 'flag', key: 'abgegangen', label: 'abgegangen', aliases: ['abgegangen'], test: (a) => a.status === 'abgegangen' },
  { kind: 'choice', key: 'rasse', label: 'Rasse', aliases: ['rasse'], options: (a) => [a.breed_code ?? ''] },
]

export const ANIMAL_EXAMPLES = [
  { q: 'Alter > 6 J', text: 'älter als 6 Jahre' },
  { q: 'Tage seit Geburt > 60', text: 'seit über 60 Tagen abgelammt/abgekalbt' },
  { q: 'aktiv und Journal > 3', text: 'im Bestand, mehr als 3 Journal-Einträge' },
  { q: 'Tage seit Behandlung < 14', text: 'in den letzten 14 Tagen behandelt' },
  { q: 'Inzucht > 6', text: 'Inzuchtkoeffizient über 6 %' },
  { q: 'abgegangen', text: 'nicht mehr im Bestand' },
  { q: '101', text: 'Nummer, Name oder Ohrmarke enthält «101»' },
]

export const animalTexts = (a: AnimalRow) => [a.lauf_nr, a.name, a.ear_tag, a.breed_code, a.status, a.last_journal]
