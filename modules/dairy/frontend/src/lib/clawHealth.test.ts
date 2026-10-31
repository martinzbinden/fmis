import { describe, expect, it } from 'vitest'
import { clawStatusByAnimal, clawWarnings, examSummary, isLame, worstMh, type ClawExam } from './clawHealth'

const exam = (id: string, date: string, mh: Partial<Record<'VL' | 'VR' | 'HL' | 'HR', number>>, extra: Partial<ClawExam> = {}): ClawExam => ({
  id,
  animal_id: 'a',
  exam_date: date,
  round_id: null,
  examiner: null,
  locomotion: null,
  trimmed: false,
  treatment: null,
  notes: null,
  source: 'manual',
  recorded_at: `${date}T10:00:00Z`,
  created_by: null,
  findings: Object.entries(mh).map(([foot, g], i) => ({ id: `${id}${i}`, exam_id: id, animal_id: 'a', foot: foot as 'VL', claw: null, code: 'MH', grade: String(g), zone: null })),
  ...extra,
})

describe('Klauen', () => {
  it('schwerster Fuss zählt, Zusammenfassung', () => {
    const e = exam('1', '2026-10-01', { VL: 3, VR: 0, HL: 1, HR: 0 }, { locomotion: 1, trimmed: true })
    expect(worstMh(e)).toBe(3)
    expect(isLame(e, 'sheep')).toBe(true)
    expect(examSummary(e, 'sheep')).toBe('MH 3 (VL 3, HL 1) · lahm · geschnitten')
    expect(examSummary(exam('2', '2026-10-01', { VL: 0, VR: 0, HL: 0, HR: 0 }), 'sheep')).toBe('MH 0')
  })
  it('Rinder: lahm ab Score 3', () => {
    expect(isLame({ locomotion: 2 }, 'cattle')).toBe(false)
    expect(isLame({ locomotion: 3 }, 'cattle')).toBe(true)
  })
  it('Stand je Tier: letzte Untersuchung, Befunde in 12 Monaten', () => {
    const s = clawStatusByAnimal([exam('2', '2026-10-01', { VL: 0 }), exam('1', '2026-03-01', { VL: 2 }), exam('0', '2025-01-01', { VL: 4 })], 'sheep', '2026-10-31').get('a')!
    expect(s.mh).toBe(0)
    expect(s.affected12m).toBe(1)
  })
  it('wiederholte Moderhinke und schwerer Score warnen', () => {
    const history = [exam('1', '2026-05-01', { HL: 2 })]
    const w = clawWarnings('a', { date: '2026-10-31', mh: 3, codes: [] }, history, 'Ausmerzen prüfen')
    expect(w.map((x) => x.suggestList)).toEqual(['Ausmerzen prüfen', 'Klauen nachkontrollieren'])
    expect(clawWarnings('a', { date: '2026-10-31', mh: 0, codes: [] }, history, 'X')).toEqual([])
  })
})
