import { describe, expect, it } from 'vitest'
import { addFormula, formulaActive, formulaParts, removeFormula } from './presets'

describe('Formeln im Suchfeld', () => {
  it('zerlegt an und, & und ;', () => {
    expect(formulaParts('ZZ > 200 und leer; Alter > 6 J & trocken')).toEqual(['ZZ > 200', 'leer', 'Alter > 6 J', 'trocken'])
  })
  it('erkennt eine Formel, egal wo sie steht und wie die Leerzeichen sind', () => {
    expect(formulaActive('leer und ZZ>200', 'ZZ > 200')).toBe(true)
    expect(formulaActive('LEER', 'leer')).toBe(true)
    expect(formulaActive('ZZ > 100', 'ZZ > 200')).toBe(false)
    expect(formulaActive('', 'leer')).toBe(false)
  })
  it('Formeln mit mehreren Teilen: alle müssen da sein', () => {
    expect(formulaActive('Alter > 6 J und leer', 'leer und Alter > 6 J')).toBe(true)
    expect(formulaActive('leer', 'leer und Alter > 6 J')).toBe(false)
  })
  it('hinzufügen ohne Doppel, entfernen lässt den Rest', () => {
    expect(addFormula('', 'leer')).toBe('leer')
    expect(addFormula('ZZ > 200', 'leer')).toBe('ZZ > 200 und leer')
    expect(addFormula('leer', 'leer')).toBe('leer')
    expect(removeFormula('ZZ > 200 und leer', 'leer')).toBe('ZZ > 200')
    expect(removeFormula('leer', 'leer')).toBe('')
  })
})
