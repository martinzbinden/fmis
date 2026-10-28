import { describe, expect, it } from 'vitest'
import { matchAnimals, summarize, uniqueMatch } from './pregnancy'
import type { Animal } from '../types'

const a = (id: string, ear_tag: string, lauf_nr: string | null = null): Animal => ({
  id, ear_tag, lauf_nr, name: null, breed_code: null, birth_date: null, sex: 'w', status: 'aktiv', entry_date: null, exit_date: null, notes: null, updated_at: '', deleted_at: null,
})
const herd = [a('1', 'CH21728023', '7'), a('2', 'CH21718023', '12'), a('3', 'CH21725501', '23'), a('4', 'CH113196787890', '40')]

describe('Tier über die Ohrmarke finden', () => {
  it('findet nach den letzten Ziffern, auch bei Langform', () => {
    expect(matchAnimals(herd, '8023').map((x) => x.id)).toEqual(['1', '2'])
    expect(matchAnimals(herd, '28023').map((x) => x.id)).toEqual(['1'])
    expect(uniqueMatch(herd, '5501')?.id).toBe('3')
    expect(uniqueMatch(herd, '8023')).toBeNull()
  })
  it('nimmt bei wenigen Ziffern auch die Laufnummer, wählt aber nicht automatisch', () => {
    expect(matchAnimals(herd, '12').map((x) => x.id)).toContain('2')
    expect(uniqueMatch(herd, '01')).toBeNull()
  })
  it('zählt je Tier den letzten Eintrag', () => {
    expect(summarize([
      { animal_id: '1', result: 'unsicher', recorded_at: '2026-10-28T08:00:00Z' },
      { animal_id: '1', result: 'ja', recorded_at: '2026-10-28T08:05:00Z' },
      { animal_id: '2', result: 'nein', recorded_at: '2026-10-28T08:01:00Z' },
    ])).toEqual({ ja: 1, nein: 1, unsicher: 0 })
  })
})
