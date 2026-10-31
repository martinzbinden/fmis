import { describe, expect, it } from 'vitest'
import { matchRead, readDigits } from './tagReader'
import { animalKey } from './earTag'

const read = (earTag: string) => ({ earTag, key: animalKey(earTag) })

describe('matchRead', () => {
  const animals = [
    { id: 'a', ear_tag: 'CH113217280631' }, // Schaf in Langform
    { id: 'b', ear_tag: 'CH21728064' }, // Schaf in Kurzform
    { id: 'c', ear_tag: 'CH120.1234.5678.9' }, // Rind
  ]
  it('findet Schafe in Lang- und Kurzform', () => {
    expect(matchRead(read('CH21728063'), animals)?.id).toBe('a')
    expect(matchRead(read('CH21728064'), animals)?.id).toBe('b')
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
    expect(readDigits({ earTag: 'CH21728063' })).toBe('21728063')
    expect(readDigits({ earTag: 'CH120123456789' })).toBe('123456789')
  })
})
