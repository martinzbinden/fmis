import { describe, expect, it } from 'vitest'
import { buildTimeline, filterTimeline, type TimelineInput } from './animalTimeline'

const empty: TimelineInput = {
  animal: { id: 'a', birth_date: '2020-03-01', exit_date: null, status: 'aktiv' },
  births: [],
  matings: [],
  checks: [],
  journal: [],
  claws: [],
  tests: [],
  weighings: [],
  lists: [],
  reminders: [],
}
const journal = (id: string, entry_date: string, category: TimelineInput['journal'][number]['category'], extra: Partial<TimelineInput['journal'][number]> = {}) => ({
  id,
  entry_date,
  category,
  text: '',
  diagnosis: null,
  medication: null,
  dose: null,
  withdrawal_milk_days: null,
  withdrawal_meat_days: null,
  corrects_id: null,
  ...extra,
})

describe('Tier-Verlauf', () => {
  const input: TimelineInput = {
    ...empty,
    births: [{ id: 'b1', birth_date: '2024-02-10', sire_name: 'Bock', sire_ear_tag: null, ease: null, notes: null, offspring: [{ sex: 'w', stillborn: false, died_24h: false }, { sex: 'm', stillborn: true, died_24h: false }] }],
    matings: [{ id: 'm1', service_date: '2023-09-15', service_to: '2023-10-20', kind: 'natursprung', sire_name: 'Bock', sire_ear_tag: null, notes: null }],
    checks: [{ id: 'c1', check_date: '2023-11-20', result: 'ja', method: 'ultraschall', examiner: null, weeks: 6, duration_unit: 'wochen', notes: null }],
    journal: [
      journal('j1', '2024-03-01', 'behandlung', { diagnosis: 'Mastitis', medication: 'Mamyzin', withdrawal_milk_days: 5 }),
      journal('j2', '2024-03-01', 'behandlung', { diagnosis: 'Mastitis', medication: 'Mamyzin', withdrawal_milk_days: 6, corrects_id: 'j1' }),
      journal('j3', '2023-09-10', 'brunst', { text: 'stark' }),
      journal('j4', '2024-05-01', 'notiz', { text: 'Ohrmarke ersetzt' }),
    ],
    tests: [{ id: 't1', test_date: '2024-04-01', milk_kg: 2.4, fat_pct: 6.1, protein_pct: 5.2, cell_count: 120 }],
    lists: [{ id: 'l1', name: 'Ausmerzen prüfen', reason: 'Euter', added_at: '2024-06-01', done_at: '2024-07-01' }],
  }
  const items = buildTimeline(input, 'sheep')

  it('nimmt alle Erfassungsarten auf, korrigierte Journaleinträge nicht', () => {
    expect(items.map((i) => i.id).sort()).toEqual(
      ['tier:geboren', 'geburt:b1', 'belegung:m1', 'traechtigkeit:c1', 'journal:j2', 'journal:j3', 'journal:j4', 'milch:t1', 'liste:l1', 'liste-erledigt:l1'].sort(),
    )
  })

  it('ordnet Themen zu: Brunst zur Belegung, Behandlung zur Gesundheit', () => {
    const topic = (id: string) => items.find((i) => i.id === id)?.topic
    expect(topic('journal:j3')).toBe('belegung')
    expect(topic('journal:j2')).toBe('gesundheit')
    expect(topic('journal:j4')).toBe('beobachtung')
  })

  it('beschreibt Würfe mit Totgeburten und Behandlungen mit Absetzfrist', () => {
    const birth = items.find((i) => i.id === 'geburt:b1')!
    expect(birth.title).toBe('Ablammung · Wurf 2')
    expect(birth.detail).toContain('1 lebend')
    expect(birth.tone).toBe('bad')
    const treat = items.find((i) => i.id === 'journal:j2')!
    expect(treat.title).toBe('Behandlung: Mastitis – Mamyzin')
    expect(treat.detail).toContain('Milch bis')
  })

  it('sortiert nach Datum in beide Richtungen und schränkt nach Thema ein', () => {
    const neu = filterTimeline(items, 'alle', 'neu').map((i) => i.date)
    expect(neu).toEqual([...neu].sort().reverse())
    const alt = filterTimeline(items, 'alle', 'alt')
    expect(alt[0].id).toBe('tier:geboren')
    expect(filterTimeline(items, 'belegung', 'alt').map((i) => i.id)).toEqual(['journal:j3', 'belegung:m1'])
  })
})
