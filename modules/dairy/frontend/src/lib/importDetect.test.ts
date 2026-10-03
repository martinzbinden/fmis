import { describe, expect, it } from 'vitest'
import { herdbookSpecies, tvdSpecies } from './importDetect'

// Satz mit Tiernummer ab Stelle 23 (Spec RindviehCH 4.35), Rest gekürzt.
const rec = (type: string, id: string) => `${type} 300121099391345285${id}LAC   `

describe('herdbookSpecies', () => {
  it('erkennt Rinder an CH120…', () => {
    expect(herdbookSpecies([[rec('K04', 'CH120136152533'), rec('K01', 'CH120115806778')].join('\r\n')])).toBe('cattle')
  })
  it('erkennt Schafe an anderen CH-Nummern', () => {
    expect(herdbookSpecies([rec('K04', 'CH113197110291'), rec('K11', 'CH113200065914')])).toBe('sheep')
  })
  it('ohne Tiernummern unentschieden', () => {
    expect(herdbookSpecies(['B01 300121099391345285 Zbinden', ''])).toBeNull()
  })
})

describe('tvdSpecies', () => {
  it('nach Spaltennamen', () => {
    expect(tvdSpecies(['Ohrmarkennummer', 'Erstablammung'], [])).toBe('sheep')
    expect(tvdSpecies(['Ohrmarkennummer', 'Erstabkalbung'], [])).toBe('cattle')
  })
  it('nach Ohrmarken', () => {
    expect(tvdSpecies(['Ohrmarkennummer'], ['CH19756317', 'CH20041511'])).toBe('sheep')
    expect(tvdSpecies(['Ohrmarkennummer'], ['CH 120.1361.5253.3', 'CH120115806778'])).toBe('cattle')
    expect(tvdSpecies(['Ohrmarkennummer'], ['DE0123'])).toBeNull()
  })
})
