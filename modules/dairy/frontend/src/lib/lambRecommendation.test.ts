import { describe, expect, it } from 'vitest'
import { preselectionLabel, recommendLamb, type RecommendationInput } from './lambRecommendation'

const base: RecommendationInput = { sex: 'w', damIndex: 100, damValue: 100, sireValue: 100, inbreeding: 0 }
const choice = (p: Partial<RecommendationInput>) => recommendLamb({ ...base, ...p }).choice

describe('Empfehlung Zucht oder Mast', () => {
  it('stuft weibliche Tiere nach dem Mittel aus Mutter-Index und erwartetem Zuchtwert ein', () => {
    expect(choice({ damIndex: 110, damValue: 110, sireValue: 110 })).toBe('zucht')
    expect(choice({})).toBe('eher_ja')
    expect(choice({ damIndex: 96, damValue: 98, sireValue: 98 })).toBe('eher_nein')
    expect(choice({ damIndex: 85, damValue: 90, sireValue: 90 })).toBe('mast')
  })

  it('rechnet den Schnitt aus beiden Grössen', () => {
    const r = recommendLamb({ ...base, damIndex: 110, damValue: 100, sireValue: 110 })
    expect(r.score).toBe(107.5)
    expect(r.choice).toBe('zucht')
    expect(r.reasons).toEqual(['Mutter Index 110', 'erwarteter Zuchtwert 105'])
  })

  it('zählt einen unbekannten Elternteil als 100', () => {
    expect(recommendLamb({ ...base, damIndex: 100, damValue: null, sireValue: 120 }).score).toBe(105)
  })

  it('ohne Daten: später', () => {
    const r = recommendLamb({ sex: 'w', damIndex: null, damValue: null, sireValue: null, inbreeding: 0 })
    expect(r).toMatchObject({ choice: 'spaeter', score: null })
  })

  it('ist männlich zurückhaltend und nie sicher Zucht', () => {
    expect(choice({ sex: 'm', damIndex: 120, damValue: 120, sireValue: 120 })).toBe('eher_ja')
    expect(choice({ sex: 'm', damIndex: 105, damValue: 105, sireValue: 105 })).toBe('eher_nein')
    expect(choice({ sex: 'm', damIndex: 90, damValue: 90, sireValue: 90 })).toBe('mast')
  })

  it('bleibt bei einer einzigen Datenquelle oder dünnen Daten vorsichtig', () => {
    expect(choice({ damIndex: 120, damValue: null, sireValue: null })).toBe('eher_ja')
    expect(choice({ damIndex: 80, damValue: null, sireValue: null })).toBe('eher_nein')
    expect(choice({ damIndex: 115, damValue: 115, sireValue: 115, damBasis: 'duenn' })).toBe('eher_ja')
    expect(choice({ damIndex: 115, damValue: 115, sireValue: 115, damBasis: 'gut' })).toBe('zucht')
  })

  it('begrenzt bei hoher Inzucht, senkt aber nicht weiter', () => {
    const r = recommendLamb({ ...base, damIndex: 120, damValue: 120, sireValue: 120, inbreeding: 0.125 })
    expect(r.choice).toBe('eher_nein')
    expect(r.reasons.at(-1)).toBe('Inzucht 12,5 %: höchstens «eher nein»'.replace('12,5', (12.5).toLocaleString('de-CH')))
    expect(choice({ damIndex: 80, damValue: 80, sireValue: 80, inbreeding: 0.125 })).toBe('mast')
  })

  it('kennt die Bezeichnungen', () => {
    expect(preselectionLabel('eher_nein')).toBe('eher nein')
    expect(preselectionLabel(null)).toBeNull()
  })
})
