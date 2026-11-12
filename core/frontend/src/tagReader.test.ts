import { describe, expect, it } from 'vitest'
import { matchRead, readDigits, readerTagToEarTag } from './tagReader'
import { animalKey } from './earTag'

const read = (earTag: string) => ({ earTag, key: animalKey(earTag) })

describe('matchRead', () => {
  const animals = [
    { id: 'a', ear_tag: 'CH113900002101' }, // Schaf in Langform
    { id: 'b', ear_tag: 'CH90000220' }, // Schaf in Kurzform
    { id: 'c', ear_tag: 'CH120.1234.5678.9' }, // Rind
  ]
  it('findet Schafe in Lang- und Kurzform', () => {
    expect(matchRead(read('CH90000210'), animals)?.id).toBe('a')
    expect(matchRead(read('CH90000220'), animals)?.id).toBe('b')
  })
  it('findet Rinder', () => {
    expect(matchRead(read('CH120123456789'), animals)?.id).toBe('c')
  })
  it('unbekannte Marke', () => {
    expect(matchRead(read('CH99999999'), animals)).toBeUndefined()
  })
})

describe('readDigits', () => {
  it('Schaf: 8 Ziffern, Rind: 9 Ziffern nach CH120', () => {
    expect(readDigits({ earTag: 'CH90000210' })).toBe('90000210')
    expect(readDigits({ earTag: 'CH120123456789' })).toBe('123456789')
  })
})

describe('readerTagToEarTag', () => {
  it('Schaf mit vier Nullen und Langform werden zur Kurzform, der Rest bleibt', () => {
    expect(readerTagToEarTag('CH000090000010')).toBe('CH90000010')
    expect(readerTagToEarTag('CH113900002101')).toBe('CH90000210')
    expect(readerTagToEarTag('CH120900000203')).toBe('CH120900000203')
  })
  it('trifft dasselbe Tier wie eine Live-Lesung', () => {
    const animals = [{ id: 'a', ear_tag: 'CH113900001035' }]
    const fromPool = readerTagToEarTag('CH000090000103')
    expect(matchRead({ key: animalKey(fromPool) }, animals)?.id).toBe('a')
  })
})
