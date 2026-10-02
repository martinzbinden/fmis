import { describe, expect, it } from 'vitest'
import { animalLabel, shortEarTag } from './earTag'

describe('shortEarTag', () => {
  it('Schafe: 8 Ziffern der TVD-Nummer, aus Lang- und Kurzform', () => {
    expect(shortEarTag('CH113200415115')).toBe('2004.1511')
    expect(shortEarTag('CH2004.1511')).toBe('2004.1511')
    expect(shortEarTag('CH20041511')).toBe('2004.1511')
  })
  it('Rinder: 9 Ziffern nach CH120', () => {
    expect(shortEarTag('CH120136152533')).toBe('1361.5253.3')
  })
  it('lässt fremde IDs unverändert', () => {
    expect(shortEarTag('FR009999901520')).toBe('FR009999901520')
    expect(shortEarTag(null)).toBe('')
  })
})

describe('animalLabel', () => {
  it('hängt den Namen an, wenn vorhanden', () => {
    expect(animalLabel({ ear_tag: 'CH120136152533', name: 'ALMA' })).toBe('1361.5253.3 ALMA')
    expect(animalLabel({ ear_tag: 'CH113200415115', name: null })).toBe('2004.1511')
  })
})
