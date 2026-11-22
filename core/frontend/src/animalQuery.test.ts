import { describe, expect, it } from 'vitest'
import { birthMatches, nameAndBirthMatch, parseAnimalQuery, parseBirthQuery } from './animalQuery'

describe('Tier über Name und Geburtsdatum', () => {
  it('liest Datumsangaben', () => {
    expect(parseBirthQuery('12.3.2021')).toEqual({ day: 12, month: 3, year: 2021 })
    expect(parseBirthQuery('12.03.21')).toEqual({ day: 12, month: 3, year: 2021 })
    expect(parseBirthQuery('12.3.')).toEqual({ day: 12, month: 3 })
    expect(parseBirthQuery('3.2021')).toEqual({ month: 3, year: 2021 })
    expect(parseBirthQuery('3.21')).toEqual({ month: 3, year: 2021 })
    expect(parseBirthQuery('2021-03-12')).toEqual({ year: 2021, month: 3, day: 12 })
    expect(parseBirthQuery('12,3,2021')).toEqual({ day: 12, month: 3, year: 2021 })
    expect(parseBirthQuery('1012')).toBeNull()
    expect(parseBirthQuery('9999.4321')).toBeNull()
    expect(parseBirthQuery('40.3.2021')).toBeNull()
  })

  it('prüft Geburtsdatum und Namen', () => {
    expect(birthMatches({ day: 12, month: 3 }, '2019-03-12')).toBe(true)
    expect(birthMatches({ month: 3, year: 2021 }, '2021-04-01')).toBe(false)
    const a = { name: 'Testlinde Möhre', birth_date: '2021-03-12' }
    expect(nameAndBirthMatch(parseAnimalQuery('mohre'), a)).toBe(true)
    expect(nameAndBirthMatch(parseAnimalQuery('test 12.3.'), a)).toBe(true)
    expect(nameAndBirthMatch(parseAnimalQuery('test 13.3.'), a)).toBe(false)
    expect(parseAnimalQuery('Testlinde 101').number).toBe('101')
    expect(parseAnimalQuery('CH12345678').number).toBe('12345678')
  })
})
