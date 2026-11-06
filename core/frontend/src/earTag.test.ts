import { describe, expect, it } from 'vitest'
import { animalKey, animalLabel, earTagProblem, shortEarTag } from './earTag'

describe('shortEarTag', () => {
  it('Schafe: 8 Ziffern der TVD-Nummer, aus Lang- und Kurzform', () => {
    expect(shortEarTag('CH113900001305')).toBe('9000.0130')
    expect(shortEarTag('CH9000.0130')).toBe('9000.0130')
    expect(shortEarTag('CH90000130')).toBe('9000.0130')
  })
  it('Rinder: 9 Ziffern nach CH120', () => {
    expect(shortEarTag('CH120900000203')).toBe('9000.0020.3')
  })
  it('lässt fremde IDs unverändert', () => {
    expect(shortEarTag('FR009999901520')).toBe('FR009999901520')
    expect(shortEarTag(null)).toBe('')
  })
})

describe('animalLabel', () => {
  it('hängt den Namen an, wenn vorhanden', () => {
    expect(animalLabel({ ear_tag: 'CH120900000203', name: 'ALMA' })).toBe('9000.0020.3 ALMA')
    expect(animalLabel({ ear_tag: 'CH113900001305', name: null })).toBe('9000.0130')
  })
})

describe('animalKey / earTagProblem (Eingabe von Hand)', () => {
  it('ergänzt «CH» bei 8 Ziffern (Schaf) und bei 120 + 9 Ziffern (Rind)', () => {
    expect(animalKey('9000.0130')).toBe('CH90000130')
    expect(animalKey('9000 0130')).toBe('CH90000130')
    expect(animalKey('120900000203')).toBe('CH120900000203')
    expect(animalKey('CH113900001305')).toBe('CH90000130')
  })
  it('lehnt Bruchstücke und Buchstaben ab', () => {
    expect(earTagProblem('abc')).toContain('unvollständig')
    expect(earTagProblem('1511')).toContain('unvollständig')
    expect(earTagProblem('')).toBe('Ohrmarke fehlt.')
    expect(earTagProblem('9000.0130')).toBeNull()
    expect(earTagProblem('FR009999901520')).toBeNull()
  })
})
