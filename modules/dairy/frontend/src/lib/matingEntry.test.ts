import { describe, expect, it } from 'vitest'
import { recentMating, type MatingSpan } from './matingEntry'

const m = (service_date: string, service_to: string | null = null, animal_id = 'a'): MatingSpan => ({ animal_id, service_date, service_to })

describe('recentMating', () => {
  it('findet eine Meldung der letzten 7 Tage', () => {
    expect(recentMating([m('2026-11-01')], 'a', '2026-11-06', null)).not.toBeNull()
    expect(recentMating([m('2026-10-30')], 'a', '2026-11-06', null)).not.toBeNull()
  })

  it('lässt ältere Meldungen und andere Tiere zu', () => {
    expect(recentMating([m('2026-10-29')], 'a', '2026-11-06', null)).toBeNull()
    expect(recentMating([m('2026-11-05', null, 'b')], 'a', '2026-11-06', null)).toBeNull()
  })

  it('zählt das Ende eines Zeitraums', () => {
    expect(recentMating([m('2026-09-01', '2026-11-02')], 'a', '2026-11-06', null)).not.toBeNull()
  })

  it('erkennt auch nachträgliche Meldungen vor einer vorhandenen', () => {
    expect(recentMating([m('2026-11-06')], 'a', '2026-11-03', null)).not.toBeNull()
    expect(recentMating([m('2026-11-06')], 'a', '2026-10-20', '2026-11-01')).not.toBeNull()
  })

  it('nennt die jüngste von mehreren', () => {
    expect(recentMating([m('2026-11-01'), m('2026-11-04'), m('2026-11-02')], 'a', '2026-11-06', null)?.service_date).toBe('2026-11-04')
  })
})
