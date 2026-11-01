import { describe, expect, it } from 'vitest'
import { animalKey, animalLabel, earTagProblem, shortEarTag } from './earTag'

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

describe('animalKey / earTagProblem (Eingabe von Hand)', () => {
  it('ergänzt «CH» bei 8 Ziffern (Schaf) und bei 120 + 9 Ziffern (Rind)', () => {
    expect(animalKey('2004.1511')).toBe('CH20041511')
    expect(animalKey('2004 1511')).toBe('CH20041511')
    expect(animalKey('120136152533')).toBe('CH120136152533')
    expect(animalKey('CH113200415115')).toBe('CH20041511')
  })
  it('lehnt Bruchstücke und Buchstaben ab', () => {
    expect(earTagProblem('abc')).toContain('unvollständig')
    expect(earTagProblem('1511')).toContain('unvollständig')
    expect(earTagProblem('')).toBe('Ohrmarke fehlt.')
    expect(earTagProblem('2004.1511')).toBeNull()
    expect(earTagProblem('FR009999901520')).toBeNull()
  })
})
