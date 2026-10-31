import { describe, expect, it } from 'vitest'
import { animalWarnings, CULL_LIST, type AnimalEvents } from './animalWarnings'

const ev = (p: Partial<AnimalEvents>): AnimalEvents => ({ checks: [], births: [], matings: [], lists: [], ...p })
const check = (check_date: string, result: 'ja' | 'nein' | 'unsicher', round_id = 'r1') => ({ id: check_date, check_date, result, method: 'ultraschall' as const, examiner: null, round_id })

describe('animalWarnings', () => {
  it('Belegung eines als trächtig gemeldeten Tiers → Ausmerzen prüfen', () => {
    const w = animalWarnings('x', ev({ births: [{ birth_date: '2026-01-10', litter: 2, alive: 2 }], checks: [check('2026-09-01', 'ja')] }), { kind: 'mating', date: '2026-10-20' }, 'sheep')
    expect(w).toHaveLength(1)
    expect(w[0].suggestList).toBe(CULL_LIST)
    expect(w[0].text).toContain('trächtig gemeldet am 1.9.2026')
  })
  it('keine Warnung, wenn die Trächtigkeit vor der letzten Geburt war oder zuletzt leer', () => {
    const before = ev({ births: [{ birth_date: '2026-01-10', litter: 1, alive: 1 }], checks: [check('2025-10-01', 'ja')] })
    expect(animalWarnings('x', before, { kind: 'mating', date: '2026-10-20' }, 'sheep')).toEqual([])
    const empty = ev({ checks: [check('2026-10-01', 'nein'), check('2026-09-01', 'ja')] })
    expect(animalWarnings('x', empty, { kind: 'mating', date: '2026-10-20' }, 'sheep')).toEqual([])
  })
  it('Trächtigkeit: in den letzten 7 Tagen schon trächtig → Entfernen empfehlen (anderer Durchgang)', () => {
    const e = ev({ checks: [check('2026-10-27', 'ja', 'alt')] })
    const w = animalWarnings('x', e, { kind: 'pregnancy', date: '2026-10-31', roundId: 'neu' }, 'sheep')
    expect(w[0].suggestRemove).toBe(true)
    expect(w[0].text).toContain('Vor 4 Tagen')
    // gleicher Durchgang zählt nicht, älter als 7 Tage auch nicht
    expect(animalWarnings('x', e, { kind: 'pregnancy', date: '2026-10-31', roundId: 'alt' }, 'sheep')).toEqual([])
    expect(animalWarnings('x', e, { kind: 'pregnancy', date: '2026-11-04', roundId: 'neu' }, 'sheep').some((x) => x.suggestRemove)).toBe(false)
  })
  it('leer nach trächtig → Ausmerzen prüfen', () => {
    const e = ev({ checks: [check('2026-08-01', 'ja', 'alt')] })
    const w = animalWarnings('x', e, { kind: 'pregnancy', date: '2026-10-31', result: 'nein', roundId: 'neu' }, 'sheep')
    expect(w.map((x) => x.suggestList)).toContain(CULL_LIST)
  })
  it('Geburt nach Leer-Meldung und zu kurzer Abstand', () => {
    const e = ev({ births: [{ birth_date: '2026-06-01', litter: 1, alive: 1 }], checks: [check('2026-09-01', 'nein')] })
    const w = animalWarnings('x', e, { kind: 'birth', date: '2026-10-01' }, 'sheep')
    expect(w.map((x) => x.text).join(' ')).toContain('leer gemeldet')
    expect(w.map((x) => x.text).join(' ')).toContain('Datum oder Tier prüfen')
  })
  it('Merklisten erscheinen als Hinweis', () => {
    const w = animalWarnings('x', ev({ lists: [{ entryId: 'e', listId: 'l', name: 'Klauen', reason: null }] }), { kind: 'mating', date: '2026-10-20' }, 'sheep')
    expect(w[0].text).toBe('Auf Merkliste «Klauen»')
  })
})
