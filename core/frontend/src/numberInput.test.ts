import { describe, expect, it } from 'vitest'
import { cleanNumber } from './NumberInput'

describe('cleanNumber', () => {
  it('Komma wird Punkt', () => expect(cleanNumber('3,5')).toBe('3.5'))
  it('Buchstaben und Leerzeichen fliegen raus', () => expect(cleanNumber('1 2a3')).toBe('123'))
  it('nur ein Dezimalpunkt', () => expect(cleanNumber('1.2.3')).toBe('1.23'))
  it('Minus nur am Anfang', () => {
    expect(cleanNumber('-5')).toBe('-5')
    expect(cleanNumber('5-3')).toBe('53')
  })
  it('«12.» bleibt beim Tippen stehen', () => expect(cleanNumber('12.')).toBe('12.'))
  it('leer bleibt leer', () => expect(cleanNumber('')).toBe(''))
})
