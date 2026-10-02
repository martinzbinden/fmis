import { describe, expect, it } from 'vitest'
import { keepExisting, sameValue } from './importMerge'

describe('keepExisting (Importe löschen nichts)', () => {
  const prev = {
    id: '1',
    name: 'BELLA',
    birth_date: new Date('2021-03-26T00:00:00Z'),
    notes: 'von Hand',
    lauf_nr: '12',
    exit_date: null,
    updated_at: 'x',
    deleted_at: null,
  }

  it('behält vorhandene Werte, wo die Datei nichts liefert', () => {
    expect(keepExisting({ id: '1', name: null, birth_date: null, exit_date: null }, prev)).toEqual({
      id: '1',
      name: 'BELLA',
      birth_date: '2021-03-26',
      exit_date: null,
      notes: 'von Hand',
      lauf_nr: '12',
    })
  })

  it('übernimmt echte neue Werte', () => {
    expect(keepExisting({ id: '1', name: 'BELLA II', lauf_nr: '' }, prev)).toMatchObject({ name: 'BELLA II', lauf_nr: '12' })
  })

  it('ohne Bestand bleibt die Zeile, wie sie ist', () => {
    expect(keepExisting({ id: '2', name: null }, undefined)).toEqual({ id: '2', name: null })
  })
})

describe('sameValue', () => {
  it('vergleicht Datum, Zahl und leer tolerant', () => {
    expect(sameValue(new Date('2021-03-26T00:00:00Z'), '2021-03-26')).toBe(true)
    expect(sameValue('7.50', 7.5)).toBe(true)
    expect(sameValue(null, '')).toBe(true)
    expect(sameValue('A', null)).toBe(false)
  })
})
